/**
 * 이메일 발송 서비스
 * 저평가주식 스크리닝 결과 알림용
 */

const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
  }

  /**
   * SMTP 트랜스포터 초기화
   */
  initialize() {
    if (this.initialized) return;

    const smtpConfig = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    };

    if (!smtpConfig.auth.user || !smtpConfig.auth.pass) {
      console.log('⚠️ SMTP 설정 없음 - 이메일 발송 비활성화');
      return;
    }

    this.transporter = nodemailer.createTransport(smtpConfig);
    this.initialized = true;
    console.log('✅ 이메일 서비스 초기화 완료');
  }

  /**
   * 저평가주식 스크리닝 결과 이메일 발송
   */
  async sendScreeningReport(results) {
    try {
      this.initialize();

      if (!this.transporter) {
        console.log('⚠️ 이메일 트랜스포터 없음 - 발송 스킵');
        return false;
      }

      const recipientEmail = process.env.ALERT_EMAIL || process.env.SMTP_USER;

      if (!recipientEmail) {
        console.log('⚠️ 수신자 이메일 없음 - 발송 스킵');
        return false;
      }

      const { undervalued, summary, analyzedAt } = results;
      const quarterName = this.getQuarterName();

      // HTML 이메일 본문 생성
      const htmlContent = this.generateReportHtml(undervalued, summary, quarterName, analyzedAt);
      const textContent = this.generateReportText(undervalued, summary, quarterName, analyzedAt);

      const mailOptions = {
        from: `저평가주식 분석기 <${process.env.SMTP_USER}>`,
        to: recipientEmail,
        subject: `[저평가주식] ${quarterName} 스크리닝 결과 - ${undervalued.length}개 종목 발견`,
        text: textContent,
        html: htmlContent
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ 스크리닝 결과 이메일 발송 완료: ${info.messageId}`);

      return true;

    } catch (error) {
      console.error('❌ 이메일 발송 실패:', error.message);
      return false;
    }
  }

  /**
   * 현재 분기 이름 반환
   */
  getQuarterName() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    if (month <= 3) return `${year}년 1분기`;
    if (month <= 6) return `${year}년 2분기`;
    if (month <= 9) return `${year}년 3분기`;
    return `${year}년 4분기`;
  }

  /**
   * HTML 이메일 본문 생성
   */
  generateReportHtml(undervalued, summary, quarterName, analyzedAt) {
    const stockRows = undervalued.map((stock, idx) => `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 12px; text-align: center;">${idx + 1}</td>
        <td style="padding: 12px;"><strong>${stock.name}</strong><br><small style="color: #666;">${stock.stockCode}</small></td>
        <td style="padding: 12px; text-align: right;">${stock.currentPrice?.toLocaleString()}원</td>
        <td style="padding: 12px; text-align: right; color: ${stock.PSR <= 0.5 ? '#e74c3c' : '#333'};">${stock.PSR?.toFixed(2) || '-'}</td>
        <td style="padding: 12px; text-align: right;">${stock.PBR?.toFixed(2) || '-'}</td>
        <td style="padding: 12px; text-align: right;">${stock.grahamNumber?.toFixed(2) || '-'}</td>
        <td style="padding: 12px; font-size: 12px;">${stock.undervaluedReasons?.join('<br>') || '-'}</td>
      </tr>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Malgun Gothic', Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 900px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #2c3e50, #3498db); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
    .content { background: #fff; padding: 30px; border: 1px solid #ddd; }
    .summary { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
    .summary-grid { display: flex; gap: 20px; flex-wrap: wrap; }
    .summary-item { flex: 1; min-width: 120px; text-align: center; }
    .summary-value { font-size: 28px; font-weight: bold; color: #2c3e50; }
    .summary-label { font-size: 12px; color: #666; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th { background: #34495e; color: white; padding: 12px; text-align: left; }
    .criteria { background: #fff3cd; padding: 15px; border-radius: 8px; margin-top: 30px; border-left: 4px solid #ffc107; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">📊 저평가주식 스크리닝 결과</h1>
      <p style="margin: 10px 0 0 0; opacity: 0.9;">${quarterName} 분석 리포트</p>
    </div>

    <div class="content">
      <div class="summary">
        <div class="summary-grid">
          <div class="summary-item">
            <div class="summary-value">${summary.analyzed}</div>
            <div class="summary-label">분석 종목</div>
          </div>
          <div class="summary-item">
            <div class="summary-value" style="color: #e74c3c;">${summary.undervalued}</div>
            <div class="summary-label">저평가 발견</div>
          </div>
          <div class="summary-item">
            <div class="summary-value">${((summary.undervalued / summary.analyzed) * 100).toFixed(1)}%</div>
            <div class="summary-label">저평가 비율</div>
          </div>
        </div>
      </div>

      <h2>🎯 저평가 종목 리스트</h2>

      ${undervalued.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>종목명</th>
            <th style="text-align: right;">현재가</th>
            <th style="text-align: right;">PSR</th>
            <th style="text-align: right;">PBR</th>
            <th style="text-align: right;">PER×PBR</th>
            <th>저평가 근거</th>
          </tr>
        </thead>
        <tbody>
          ${stockRows}
        </tbody>
      </table>
      ` : '<p style="text-align: center; color: #666; padding: 40px;">이번 분기에는 저평가 종목이 발견되지 않았습니다.</p>'}

      <div class="criteria">
        <strong>📋 저평가 판정 기준</strong>
        <ul style="margin: 10px 0 0 0; padding-left: 20px;">
          <li><strong>PSR ≤ 0.5</strong>: 시가총액이 연간 매출의 절반 이하</li>
          <li><strong>PER × PBR ≤ 22.5</strong>: 벤저민 그레이엄의 가치투자 공식</li>
          <li><strong>비유동자산</strong>: 토지/건물 등 10년 이상 장기보유 자산</li>
        </ul>
      </div>
    </div>

    <div class="footer">
      분석 시각: ${new Date(analyzedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}<br>
      이 리포트는 참고용이며, 최종 투자 판단은 직접 분석 후 결정하세요.
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * 텍스트 이메일 본문 생성 (HTML 미지원 클라이언트용)
   */
  generateReportText(undervalued, summary, quarterName, analyzedAt) {
    let text = `
📊 저평가주식 스크리닝 결과
${quarterName} 분석 리포트
================================

[요약]
- 분석 종목: ${summary.analyzed}개
- 저평가 발견: ${summary.undervalued}개
- 저평가 비율: ${((summary.undervalued / summary.analyzed) * 100).toFixed(1)}%

[저평가 종목 리스트]
`;

    if (undervalued.length > 0) {
      undervalued.forEach((stock, idx) => {
        text += `
${idx + 1}. ${stock.name} (${stock.stockCode})
   현재가: ${stock.currentPrice?.toLocaleString()}원
   PSR: ${stock.PSR?.toFixed(2) || '-'} | PBR: ${stock.PBR?.toFixed(2) || '-'}
   근거: ${stock.undervaluedReasons?.join(', ') || '-'}
`;
      });
    } else {
      text += '\n이번 분기에는 저평가 종목이 발견되지 않았습니다.\n';
    }

    text += `
================================
[저평가 판정 기준]
- PSR ≤ 0.5: 시가총액이 연간 매출의 절반 이하
- PER × PBR ≤ 22.5: 벤저민 그레이엄의 가치투자 공식
- 비유동자산: 토지/건물 등 10년 이상 장기보유 자산

분석 시각: ${new Date(analyzedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
이 리포트는 참고용이며, 최종 투자 판단은 직접 분석 후 결정하세요.
`;

    return text;
  }
}

module.exports = new EmailService();
