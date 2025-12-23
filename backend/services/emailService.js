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

      const {
        undervalued,
        undervaluedWithLongTermAssets = [],
        undervaluedWithoutLongTermAssets = [],
        summary,
        analyzedAt
      } = results;
      const quarterName = this.getQuarterName();

      // HTML 이메일 본문 생성
      const htmlContent = this.generateReportHtml(
        undervalued, summary, quarterName, analyzedAt,
        undervaluedWithLongTermAssets, undervaluedWithoutLongTermAssets
      );
      const textContent = this.generateReportText(
        undervalued, summary, quarterName, analyzedAt,
        undervaluedWithLongTermAssets, undervaluedWithoutLongTermAssets
      );

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
  generateReportHtml(undervalued, summary, quarterName, analyzedAt, withAssets = [], withoutAssets = []) {
    // 장기 보유 자산 보유 종목 테이블 생성
    const assetStockRows = withAssets.map((stock, idx) => `
      <tr style="border-bottom: 2px solid #f5e6d3; background: ${idx % 2 === 0 ? '#fffbf0' : '#fff8e8'};">
        <td style="padding: 15px 10px; text-align: center; font-weight: bold; font-size: 16px;">${idx + 1}</td>
        <td style="padding: 15px 10px;">
          <div style="font-size: 16px; font-weight: bold; color: #333;">${stock.name}</div>
          <div style="font-size: 13px; color: #888; margin-top: 3px;">${stock.stockCode}</div>
        </td>
        <td style="padding: 15px 10px; text-align: right; font-size: 15px; font-weight: bold;">${stock.currentPrice?.toLocaleString()}<span style="font-size: 12px; color: #666;">원</span></td>
        <td style="padding: 15px 10px; text-align: center;">
          <span style="background: ${stock.PSR <= 0.5 ? '#e74c3c' : '#95a5a6'}; color: white; padding: 5px 10px; border-radius: 15px; font-size: 14px; font-weight: bold;">${stock.PSR?.toFixed(2) || '-'}</span>
        </td>
        <td style="padding: 15px 10px; text-align: center;">
          <span style="background: ${stock.grahamNumber <= 22.5 ? '#27ae60' : '#95a5a6'}; color: white; padding: 5px 10px; border-radius: 15px; font-size: 14px; font-weight: bold;">${stock.grahamNumber?.toFixed(1) || '-'}</span>
        </td>
        <td style="padding: 15px 10px; font-size: 13px; color: #8b4513; line-height: 1.5;">${stock.assetAnalysis?.reason || '-'}</td>
      </tr>
    `).join('');

    // 일반 저평가 종목 테이블 생성
    const otherStockRows = withoutAssets.map((stock, idx) => `
      <tr style="border-bottom: 1px solid #eee; background: ${idx % 2 === 0 ? '#fff' : '#f9f9f9'};">
        <td style="padding: 12px 10px; text-align: center; font-weight: bold;">${idx + 1}</td>
        <td style="padding: 12px 10px;">
          <div style="font-size: 15px; font-weight: bold;">${stock.name}</div>
          <div style="font-size: 12px; color: #888;">${stock.stockCode}</div>
        </td>
        <td style="padding: 12px 10px; text-align: right; font-size: 14px; font-weight: bold;">${stock.currentPrice?.toLocaleString()}<span style="font-size: 11px; color: #666;">원</span></td>
        <td style="padding: 12px 10px; text-align: center;">
          <span style="background: ${stock.PSR <= 0.5 ? '#e74c3c' : '#bdc3c7'}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 13px;">${stock.PSR?.toFixed(2) || '-'}</span>
        </td>
        <td style="padding: 12px 10px; text-align: center; font-size: 13px;">${stock.PBR?.toFixed(2) || '-'}</td>
        <td style="padding: 12px 10px; text-align: center;">
          <span style="background: ${stock.grahamNumber <= 22.5 ? '#27ae60' : '#bdc3c7'}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 13px;">${stock.grahamNumber?.toFixed(1) || '-'}</span>
        </td>
      </tr>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f0f2f5; }
    .container { max-width: 900px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #1a1a2e, #16213e, #0f3460); color: white; padding: 40px 30px; border-radius: 15px 15px 0 0; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; letter-spacing: 1px; }
    .header p { margin: 15px 0 0 0; opacity: 0.85; font-size: 16px; }
    .content { background: #fff; padding: 35px; border: none; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
    .summary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 15px; margin-bottom: 35px; color: white; }
    .summary-grid { display: flex; gap: 15px; flex-wrap: wrap; justify-content: center; }
    .summary-item { flex: 1; min-width: 140px; text-align: center; background: rgba(255,255,255,0.15); padding: 20px 15px; border-radius: 12px; }
    .summary-value { font-size: 36px; font-weight: bold; color: #fff; text-shadow: 0 2px 4px rgba(0,0,0,0.2); }
    .summary-label { font-size: 13px; color: rgba(255,255,255,0.9); margin-top: 8px; font-weight: 500; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); border-radius: 10px; overflow: hidden; }
    th { background: #34495e; color: white; padding: 15px 12px; text-align: left; font-size: 14px; font-weight: 600; }
    .criteria { background: linear-gradient(135deg, #fff9e6, #fff3cd); padding: 20px; border-radius: 12px; margin-top: 35px; border-left: 5px solid #f39c12; }
    .criteria strong { font-size: 16px; color: #856404; }
    .criteria ul { margin: 12px 0 0 0; padding-left: 22px; }
    .criteria li { margin: 8px 0; color: #856404; font-size: 14px; }
    .footer { text-align: center; padding: 25px; color: #666; font-size: 12px; background: #f8f9fa; border-radius: 0 0 15px 15px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 저평가주식 스크리닝 결과</h1>
      <p>${quarterName} 분석 리포트</p>
    </div>

    <div class="content">
      <div class="summary">
        <div class="summary-grid">
          <div class="summary-item">
            <div class="summary-value">${summary.analyzed}</div>
            <div class="summary-label">분석 종목</div>
          </div>
          <div class="summary-item">
            <div class="summary-value">${summary.undervalued}</div>
            <div class="summary-label">저평가 발견</div>
          </div>
          <div class="summary-item">
            <div class="summary-value">${summary.withLongTermAssets || withAssets.length}</div>
            <div class="summary-label">🏭 장기자산 보유</div>
          </div>
          <div class="summary-item">
            <div class="summary-value">${((summary.undervalued / summary.analyzed) * 100).toFixed(1)}%</div>
            <div class="summary-label">저평가 비율</div>
          </div>
        </div>
      </div>

      ${withAssets.length > 0 ? `
      <div style="background: linear-gradient(135deg, #d4a574, #c49a6c); padding: 20px; border-radius: 12px; margin-bottom: 15px;">
        <h2 style="color: white; margin: 0; font-size: 20px;">🏭 장기보유자산 보유 저평가 종목</h2>
        <p style="color: rgba(255,255,255,0.9); font-size: 13px; margin: 8px 0 0 0;">토지/건물 10년+ 보유 확인 - 실질 자산가치 높음</p>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 50px; background: #8b4513; text-align: center;">#</th>
            <th style="background: #8b4513; min-width: 120px;">종목명</th>
            <th style="text-align: right; background: #8b4513; min-width: 100px;">현재가</th>
            <th style="text-align: center; background: #8b4513; width: 80px;">PSR</th>
            <th style="text-align: center; background: #8b4513; width: 90px;">PER×PBR</th>
            <th style="background: #8b4513;">보유자산 상세</th>
          </tr>
        </thead>
        <tbody>
          ${assetStockRows}
        </tbody>
      </table>
      ` : ''}

      ${withoutAssets.length > 0 ? `
      <div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 18px; border-radius: 12px; margin: 40px 0 15px 0;">
        <h2 style="color: white; margin: 0; font-size: 18px;">🎯 기타 저평가 종목</h2>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 50px; text-align: center;">#</th>
            <th style="min-width: 120px;">종목명</th>
            <th style="text-align: right; min-width: 100px;">현재가</th>
            <th style="text-align: center; width: 80px;">PSR</th>
            <th style="text-align: center; width: 70px;">PBR</th>
            <th style="text-align: center; width: 90px;">PER×PBR</th>
          </tr>
        </thead>
        <tbody>
          ${otherStockRows}
        </tbody>
      </table>
      ` : ''}

      ${undervalued.length === 0 ? '<p style="text-align: center; color: #666; padding: 40px;">이번 분기에는 저평가 종목이 발견되지 않았습니다.</p>' : ''}

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
  generateReportText(undervalued, summary, quarterName, analyzedAt, withAssets = [], withoutAssets = []) {
    let text = `
📊 저평가주식 스크리닝 결과
${quarterName} 분석 리포트
================================

[요약]
- 분석 종목: ${summary.analyzed}개
- 저평가 발견: ${summary.undervalued}개
  ├─ 장기보유자산 보유: ${summary.withLongTermAssets || withAssets.length}개
  └─ 기타: ${summary.undervalued - (summary.withLongTermAssets || withAssets.length)}개
- 저평가 비율: ${((summary.undervalued / summary.analyzed) * 100).toFixed(1)}%
`;

    // 장기 보유 자산 종목
    if (withAssets.length > 0) {
      text += `
================================
🏭 장기보유자산(토지/건물 10년+) 보유 저평가 종목
================================
`;
      withAssets.forEach((stock, idx) => {
        text += `
${idx + 1}. ${stock.name} (${stock.stockCode})
   현재가: ${stock.currentPrice?.toLocaleString()}원
   PSR: ${stock.PSR?.toFixed(2) || '-'} | PER×PBR: ${stock.grahamNumber?.toFixed(2) || '-'}
   보유자산: ${stock.assetAnalysis?.reason || '-'}
`;
      });
    }

    // 일반 저평가 종목
    if (withoutAssets.length > 0) {
      text += `
================================
🎯 기타 저평가 종목
================================
`;
      withoutAssets.forEach((stock, idx) => {
        text += `
${idx + 1}. ${stock.name} (${stock.stockCode})
   현재가: ${stock.currentPrice?.toLocaleString()}원
   PSR: ${stock.PSR?.toFixed(2) || '-'} | PBR: ${stock.PBR?.toFixed(2) || '-'}
`;
      });
    }

    if (undervalued.length === 0) {
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
