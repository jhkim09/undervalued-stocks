/**
 * 분기별 저평가주식 스크리닝 API
 * 자동 스크리닝 및 이메일 알림
 */

const express = require('express');
const router = express.Router();
const screeningService = require('../services/screeningService');
const emailService = require('../services/emailService');

/**
 * POST /api/screening/run
 * 수동 스크리닝 실행
 * Body: { market: 'ALL'|'KOSPI'|'KOSDAQ', limit: 0, sendEmail: true }
 */
router.post('/run', async (req, res) => {
  try {
    const { market = 'ALL', limit = 0, sendEmail = true, batchSize = 10 } = req.body;

    console.log(`📊 수동 스크리닝 요청: market=${market}, limit=${limit}, sendEmail=${sendEmail}`);

    // 스크리닝 진행 중 체크
    const status = screeningService.getStatus();
    if (status.isRunning) {
      return res.status(409).json({
        success: false,
        error: '스크리닝이 이미 진행 중입니다.',
        status
      });
    }

    // 비동기로 스크리닝 실행 (응답은 먼저 반환)
    res.json({
      success: true,
      message: '스크리닝이 시작되었습니다. 완료 시 이메일로 알림됩니다.',
      options: { market, limit, sendEmail }
    });

    // 스크리닝 실행 (응답 후 진행)
    screeningService.runFullScreening({ market, limit, sendEmail, batchSize })
      .then(result => {
        console.log(`✅ 스크리닝 완료: ${result?.summary?.undervalued || 0}개 저평가 종목 발견`);
      })
      .catch(error => {
        console.error('❌ 스크리닝 실패:', error.message);
      });

  } catch (error) {
    console.error('스크리닝 API 오류:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/screening/run-sync
 * 동기 스크리닝 실행 (결과 대기)
 * 소규모 테스트용
 */
router.post('/run-sync', async (req, res) => {
  try {
    const { market = 'ALL', limit = 50, sendEmail = false, batchSize = 5 } = req.body;

    console.log(`📊 동기 스크리닝 요청: market=${market}, limit=${limit}`);

    const status = screeningService.getStatus();
    if (status.isRunning) {
      return res.status(409).json({
        success: false,
        error: '스크리닝이 이미 진행 중입니다.',
        status
      });
    }

    const result = await screeningService.runFullScreening({
      market,
      limit,
      sendEmail,
      batchSize
    });

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('동기 스크리닝 API 오류:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/screening/status
 * 스크리닝 상태 조회
 */
router.get('/status', (req, res) => {
  const status = screeningService.getStatus();
  res.json({
    success: true,
    ...status
  });
});

/**
 * GET /api/screening/last-result
 * 마지막 스크리닝 결과 조회
 */
router.get('/last-result', (req, res) => {
  const result = screeningService.getLastResult();

  if (!result) {
    return res.json({
      success: true,
      message: '아직 스크리닝 결과가 없습니다.',
      data: null
    });
  }

  res.json({
    success: true,
    data: result
  });
});

/**
 * POST /api/screening/test-email
 * 테스트 이메일 발송
 */
router.post('/test-email', async (req, res) => {
  try {
    // 테스트용 더미 데이터
    const testResults = {
      undervalued: [
        {
          stockCode: '003550',
          name: 'LG',
          currentPrice: 75000,
          PSR: 0.39,
          PBR: 0.85,
          grahamNumber: 12.5,
          undervaluedReasons: ['PSR 0.5 이하 (0.39)', 'PER×PBR 22.5 이하 (12.5)']
        },
        {
          stockCode: '000660',
          name: 'SK하이닉스',
          currentPrice: 180000,
          PSR: 0.45,
          PBR: 1.2,
          grahamNumber: 18.0,
          undervaluedReasons: ['PSR 0.5 이하 (0.45)', 'PER×PBR 22.5 이하 (18.0)']
        }
      ],
      summary: {
        total: 100,
        analyzed: 95,
        failed: 5,
        undervalued: 2
      },
      analyzedAt: new Date().toISOString()
    };

    console.log('📧 테스트 이메일 발송 중...');
    const sent = await emailService.sendScreeningReport(testResults);

    if (sent) {
      res.json({
        success: true,
        message: '테스트 이메일이 발송되었습니다.',
        recipient: process.env.ALERT_EMAIL || process.env.SMTP_USER
      });
    } else {
      res.status(400).json({
        success: false,
        error: '이메일 발송 실패. SMTP 설정을 확인하세요.',
        hint: 'SMTP_HOST, SMTP_USER, SMTP_PASS 환경변수 필요'
      });
    }

  } catch (error) {
    console.error('테스트 이메일 API 오류:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/screening/reset
 * 스크리닝 상태 리셋 (비상용)
 */
router.post('/reset', (req, res) => {
  console.log('⚠️ 스크리닝 상태 리셋 요청');
  const result = screeningService.reset();
  res.json({
    success: true,
    message: '스크리닝 상태가 리셋되었습니다.',
    ...result
  });
});

/**
 * GET /api/screening/schedule
 * 스크리닝 스케줄 정보
 */
router.get('/schedule', (req, res) => {
  res.json({
    success: true,
    schedule: [
      {
        month: 4,
        day: 15,
        time: '07:00',
        description: '연간 사업보고서 반영 스크리닝',
        trigger: '사업보고서 (3월 말 공시)'
      },
      {
        month: 5,
        day: 20,
        time: '07:00',
        description: '1분기보고서 반영 스크리닝',
        trigger: '1분기보고서 (5월 중순 공시)'
      },
      {
        month: 8,
        day: 20,
        time: '07:00',
        description: '반기보고서 반영 스크리닝',
        trigger: '반기보고서 (8월 중순 공시)'
      },
      {
        month: 11,
        day: 20,
        time: '07:00',
        description: '3분기보고서 반영 스크리닝',
        trigger: '3분기보고서 (11월 중순 공시)'
      }
    ],
    timezone: 'Asia/Seoul',
    note: '분기보고서 공시 후 재무데이터 갱신 완료를 감안하여 스케줄 설정'
  });
});

module.exports = router;
