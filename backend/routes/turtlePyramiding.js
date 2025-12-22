/**
 * 터틀 피라미딩 API 라우터
 * Make.com에서 호출할 엔드포인트들
 */

const express = require('express');
const router = express.Router();
const TurtleNotification = require('../services/turtleNotification');

/**
 * 일일 터틀 피라미딩 분석 - Make.com에서 호출
 * GET /api/turtle-pyramiding/analyze (기존 호환성)
 * POST /api/turtle-pyramiding/analyze (계좌잔고 포함)
 */
router.get('/analyze', async (req, res) => {
  return handleAnalyze(req, res, null);
});

router.post('/analyze', async (req, res) => {
  const { accountBalance, totalEquity } = req.body;
  return handleAnalyze(req, res, { accountBalance, totalEquity });
});

async function handleAnalyze(req, res, customBalance) {
  try {
    console.log('🔔 Make.com에서 터틀 피라미딩 분석 요청...');
    if (customBalance?.accountBalance) {
      console.log(`💰 계좌잔고 입력: ${(customBalance.accountBalance/10000).toFixed(0)}만원`);
    }
    
    const turtleNotification = new TurtleNotification();
    const results = await turtleNotification.analyzeDailySignals(customBalance);
    
    // Make.com이 이해할 수 있는 형태로 응답
    const response = {
      success: true,
      timestamp: results.timestamp,
      accountInfo: results.accountInfo, // 계좌 정보 추가
      summary: {
        newEntrySignals: results.newEntrySignals.length,
        addPositionSignals: results.addPositionSignals.length,
        stopLossSignals: results.stopLossSignals.length,
        portfolioPositions: results.portfolioStatus?.turtlePositions?.length || 0,
        accountBalance: results.accountInfo?.balance ? `${(results.accountInfo.balance/10000).toFixed(0)}만원` : 'N/A'
      },
      
      // 각 신호별 상세 정보 (Make.com에서 활용 가능)
      signals: {
        newEntries: results.newEntrySignals.map(signal => ({
          symbol: signal.symbol,
          name: signal.name,
          currentPrice: signal.currentPrice,
          breakoutPrice: signal.breakoutPrice,
          recommendedAmount: signal.recommendedAction?.investment?.actualAmount,
          stopLoss: signal.recommendedAction?.risk?.stopLossPrice
        })),
        
        addPositions: results.addPositionSignals.map(signal => ({
          symbol: signal.symbol,
          name: signal.name,
          currentPrice: signal.currentPrice,
          addLevel: signal.addLevel,
          addAmount: signal.investment.addAmount,
          newAveragePrice: signal.afterAdd.newAveragePrice,
          newStopLoss: signal.afterAdd.newStopLoss
        })),
        
        stopLoss: results.stopLossSignals.map(signal => ({
          symbol: signal.symbol,
          name: signal.name,
          currentPrice: signal.currentPrice,
          stopLossPrice: signal.stopLossPrice,
          lossAmount: signal.lossAmount,
          urgency: signal.urgency
        }))
      },
      
      // 알림 메시지들 (Make.com에서 바로 전송 가능)
      notifications: results.notifications.map(notification => ({
        type: notification.type,
        priority: notification.priority,
        title: notification.title,
        message: notification.message,
        urgency: notification.urgency
      }))
    };
    
    console.log(`✅ 분석 완료: 신규진입 ${response.summary.newEntrySignals}개, 추가매수 ${response.summary.addPositionSignals}개, 손절 ${response.summary.stopLossSignals}개`);
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ 터틀 피라미딩 분석 실패:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * 포트폴리오 상태 조회 - 간단한 현황 확인용
 * GET /api/turtle-pyramiding/portfolio
 */
router.get('/portfolio', async (req, res) => {
  try {
    const TurtleNotification = require('../services/turtleNotification');
    const turtleNotification = new TurtleNotification();
    
    // 키움 잔고 동기화만 수행
    const syncResults = await turtleNotification.portfolioTracker.syncWithKiwoomAccount();
    const riskSummary = turtleNotification.portfolioTracker.getPortfolioRiskSummary();
    
    res.json({
      success: true,
      portfolio: {
        totalPositions: riskSummary.totalPositions,
        totalRiskAmount: riskSummary.totalRiskAmount,
        averageRiskPercent: riskSummary.averageRiskPercent,
        lastSyncTime: riskSummary.lastSyncTime,
        positions: riskSummary.positions
      },
      kiwoomData: {
        totalPositions: syncResults.kiwoomPositions?.length || 0,
        syncedPositions: syncResults.syncedPositions?.length || 0,
        unmatchedPositions: syncResults.unmatchedPositions?.length || 0
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 포트폴리오 조회 실패:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 테스트용 엔드포인트 - 시뮬레이션 데이터로 테스트
 * GET /api/turtle-pyramiding/test
 */
router.get('/test', async (req, res) => {
  try {
    console.log('🧪 터틀 피라미딩 테스트 모드...');
    
    const TurtlePyramiding = require('../services/turtlePyramiding');
    const PortfolioTracker = require('../services/portfolioTracker');
    
    // 시뮬레이션 테스트 실행
    const results = {
      pyramidingTest: '터틀 피라미딩 모듈 테스트 완료',
      portfolioTest: '포트폴리오 트래커 테스트 완료'
    };
    
    // 모의 포지션으로 추가매수 신호 테스트
    const mockPosition = TurtlePyramiding.createMockPosition('005930', 70000, 2000);
    const addSignal = TurtlePyramiding.checkAddSignal(mockPosition, 71000);
    
    res.json({
      success: true,
      testResults: results,
      mockSignal: addSignal ? {
        symbol: addSignal.symbol,
        addLevel: addSignal.addLevel,
        currentPrice: addSignal.currentPrice,
        targetPrice: addSignal.targetPrice,
        addAmount: addSignal.investment.addAmount
      } : null,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;