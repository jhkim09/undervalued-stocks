/**
 * 터틀 포지션 수동 등록 및 관리 API
 */

const express = require('express');
const router = express.Router();
const Trade = require('../models/Trade');
const Signal = require('../models/Signal');
const KiwoomService = require('../services/kiwoomService');
const PortfolioTracker = require('../services/portfolioTracker');

/**
 * Tally 폼에서 터틀 매수 기록 받기 (웹훅)
 */
router.post('/register-from-tally', async (req, res) => {
  try {
    console.log('📝 Tally 터틀 매수 기록 수신:', JSON.stringify(req.body, null, 2));
    
    // Tally 데이터 구조 파싱
    const fields = req.body.data?.fields || [];
    console.log('📊 Tally fields:', JSON.stringify(fields, null, 2));
    
    // 필드 데이터 추출 함수
    const getFieldValue = (fields, key) => {
      const field = fields.find(f => f.key === key || f.label?.includes(key));
      return field?.value || null;
    };
    
    // Multiple Choice 값을 텍스트로 변환하는 함수
    const getMultipleChoiceText = (fields, key) => {
      const field = fields.find(f => f.key === key || f.label?.includes(key));
      if (!field || !field.value || !Array.isArray(field.value)) return null;
      
      const selectedId = field.value[0]; // 첫 번째 선택값
      const option = field.options?.find(opt => opt.id === selectedId);
      return option?.text || null;
    };
    
    const symbol_or_name = getFieldValue(fields, '종목코드') || getFieldValue(fields, '종목명');
    const signal_type = getMultipleChoiceText(fields, '신호');
    const buy_date = getFieldValue(fields, '매수 일자') || getFieldValue(fields, '일자');
    const buy_price = getFieldValue(fields, '가격');
    const quantity = getFieldValue(fields, '수량');
    const turtle_stage = getMultipleChoiceText(fields, '단계');
    const initial_n_value = getFieldValue(fields, 'N값') || getFieldValue(fields, 'ATR');
    const memo = getFieldValue(fields, '메모');
    
    console.log('🔍 추출된 데이터:', {
      symbol_or_name,
      signal_type,
      buy_date,
      buy_price,
      quantity,
      turtle_stage,
      initial_n_value,
      memo
    });
    
    // 필수 데이터 검증
    if (!symbol_or_name || !signal_type || !buy_date || !buy_price || !quantity || !turtle_stage) {
      return res.status(400).json({
        success: false,
        error: '필수 입력값이 누락되었습니다.',
        missing: {
          종목: !symbol_or_name,
          신호유형: !signal_type,
          매수일자: !buy_date,
          매수가격: !buy_price,
          매수수량: !quantity,
          터틀단계: !turtle_stage
        }
      });
    }
    
    // 종목코드 정규화 (삼성전자 → 005930)
    let symbol = symbol_or_name;
    if (!/^\d{6}$/.test(symbol)) {
      // 종목명으로 입력된 경우 종목코드 변환 시도
      const stockInfo = await findStockByName(symbol);
      if (stockInfo) {
        symbol = stockInfo.code;
      } else {
        return res.status(400).json({
          success: false,
          error: `종목 "${symbol_or_name}" 를 찾을 수 없습니다. 정확한 종목코드(6자리) 또는 종목명을 입력해주세요.`
        });
      }
    }
    
    // 신호 유형 변환
    const signalMap = {
      '20일 돌파 신호': '20day_breakout',
      '55일 돌파 신호': '55day_breakout'
    };
    const convertedSignal = signalMap[signal_type];
    
    // 터틀 단계 변환
    const stageMap = {
      '1단계 (최초 매수)': 1,
      '2단계 (1차 추가매수)': 2,
      '3단계 (2차 추가매수)': 3,
      '4단계 (3차 추가매수)': 4
    };
    const currentUnits = stageMap[turtle_stage];
    
    // N값 계산 (입력값이 없으면 자동 계산)
    let nValue = initial_n_value;
    if (!nValue) {
      const priceData = await KiwoomService.getDailyData(symbol, 25);
      if (priceData.length >= 20) {
        const portfolioTracker = new PortfolioTracker();
        nValue = Math.round(portfolioTracker.calculateATR(priceData, 20));
        console.log(`📊 ${symbol} N값 자동 계산: ${nValue}원`);
      } else {
        nValue = Math.round(buy_price * 0.02); // 임시값: 매수가의 2%
        console.log(`⚠️ ${symbol} N값 임시 설정: ${nValue}원 (가격데이터 부족)`);
      }
    }
    
    // Trade 기록 생성
    const totalAmount = parseInt(buy_price) * parseInt(quantity);
    const tradeRecord = new Trade({
      userId: 'manual_turtle_user',
      symbol: symbol,
      name: await getStockName(symbol),
      action: 'BUY',
      quantity: parseInt(quantity),
      price: parseInt(buy_price),
      totalAmount: totalAmount,
      
      // 수수료 관련 (pre-save 미들웨어에서 자동 계산되지만 초기값 설정)
      commission: Math.round(totalAmount * 0.00015),
      tax: 0,
      netAmount: totalAmount + Math.round(totalAmount * 0.00015),
      
      // 터틀 트레이딩 정보
      signal: convertedSignal,
      atr: nValue,
      nValue: nValue,
      riskAmount: parseInt(quantity) * (nValue * 2),
      
      // 포지션 정보
      stopLossPrice: Math.round(buy_price - (nValue * 2)),
      
      // 메타 정보
      tradeDate: new Date(buy_date),
      notes: `[Tally 수동등록] 터틀 ${currentUnits}단계, ${memo || '메모 없음'}`
    });
    
    await tradeRecord.save();
    
    // Signal 기록도 생성 (일관성을 위해)
    const signalRecord = new Signal({
      symbol: symbol,
      name: await getStockName(symbol),
      date: new Date(buy_date),
      signalType: convertedSignal === '20day_breakout' ? 'BUY_20' : 'BUY_55',
      
      // 가격 정보 (필수)
      currentPrice: parseInt(buy_price),
      breakoutPrice: parseInt(buy_price), // 매수가를 돌파가로 사용
      
      // 기술적 지표 (필수) - 임시값으로 설정
      high20: Math.round(parseInt(buy_price) * 1.1), // 매수가의 110%
      low10: Math.round(parseInt(buy_price) * 0.9),  // 매수가의 90%
      
      // ATR 정보 (필수)
      atr: nValue,
      nValue: nValue,
      
      // 볼륨 정보 (필수) - 수동 등록이므로 임시값
      volume: 100000, // 임시 거래량
      avgVolume20: 80000, // 임시 평균 거래량
      volumeRatio: 1.25, // 임시 거래량 비율
      
      // 신호 강도 (필수)
      signalStrength: 'medium',
      
      // 처리 상태
      status: 'executed', // 이미 실행된 신호로 기록
      
      // 수동 등록 메타데이터
      isPrimarySignal: true,
      filterApplied: false,
      
      // 추천 액션
      recommendedAction: {
        action: 'BUY',
        quantity: parseInt(quantity),
        riskAmount: parseInt(quantity) * (nValue * 2),
        stopLossPrice: Math.round(buy_price - (nValue * 2)),
        reasoning: `[Tally 수동등록] 터틀 ${currentUnits}단계 매수`
      }
    });
    
    await signalRecord.save();
    
    console.log(`✅ 터틀 매수 기록 등록 완료: ${symbol} ${currentUnits}단계`);
    
    // 성공 응답
    res.json({
      success: true,
      message: '터틀 매수 기록이 성공적으로 등록되었습니다.',
      data: {
        symbol: symbol,
        name: await getStockName(symbol),
        stage: currentUnits,
        nValue: nValue,
        stopLoss: tradeRecord.stopLossPrice,
        tradeId: tradeRecord._id,
        signalId: signalRecord._id
      }
    });
    
  } catch (error) {
    console.error('❌ 터틀 매수 기록 등록 실패:', error);
    res.status(500).json({
      success: false,
      error: '터틀 매수 기록 등록 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 터틀 포지션 목록 조회
 */
router.get('/list', async (req, res) => {
  try {
    const portfolioTracker = new PortfolioTracker();
    const syncResult = await portfolioTracker.syncWithKiwoomAccount();
    
    res.json({
      success: true,
      data: {
        turtlePositions: syncResult.turtlePositions,
        syncedCount: syncResult.syncedPositions.length,
        unmatchedCount: syncResult.unmatchedPositions.length,
        lastSyncTime: syncResult.lastSyncTime || new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ 터틀 포지션 조회 실패:', error);
    res.status(500).json({
      success: false,
      error: '터틀 포지션 조회 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 특정 종목의 터틀 상세 정보 조회
 */
router.get('/detail/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    // 터틀 매수 히스토리
    const turtleHistory = await Trade.find({
      symbol: symbol,
      action: 'BUY',
      signal: { $in: ['20day_breakout', '55day_breakout'] }
    }).sort({ tradeDate: -1 });
    
    // 키움 현재 상태
    const portfolioTracker = new PortfolioTracker();
    await portfolioTracker.syncWithKiwoomAccount();
    const currentPosition = portfolioTracker.getTurtlePosition(symbol);
    
    res.json({
      success: true,
      data: {
        symbol: symbol,
        currentPosition: currentPosition,
        buyHistory: turtleHistory,
        hasHistory: turtleHistory.length > 0,
        totalBuys: turtleHistory.length
      }
    });
    
  } catch (error) {
    console.error(`❌ 터틀 상세 정보 조회 실패 (${req.params.symbol}):`, error);
    res.status(500).json({
      success: false,
      error: '터틀 상세 정보 조회 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 터틀 포지션 수동 삭제
 */
router.delete('/remove/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    // Trade 기록 삭제 (선택적)
    const deleteTradesResult = await Trade.deleteMany({
      symbol: symbol,
      notes: { $regex: '\\[Tally 수동등록\\]' }
    });
    
    // Signal 기록 삭제 (선택적)
    const deleteSignalsResult = await Signal.deleteMany({
      symbol: symbol,
      isManualEntry: true
    });
    
    console.log(`🗑️ ${symbol} 터틀 기록 삭제: Trade ${deleteTradesResult.deletedCount}개, Signal ${deleteSignalsResult.deletedCount}개`);
    
    res.json({
      success: true,
      message: `${symbol} 터틀 포지션 기록이 삭제되었습니다.`,
      data: {
        deletedTrades: deleteTradesResult.deletedCount,
        deletedSignals: deleteSignalsResult.deletedCount
      }
    });
    
  } catch (error) {
    console.error(`❌ 터틀 포지션 삭제 실패 (${req.params.symbol}):`, error);
    res.status(500).json({
      success: false,
      error: '터틀 포지션 삭제 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

// 헬퍼 함수들
async function findStockByName(stockName) {
  // StockName 모델에서 종목명으로 검색
  try {
    const StockName = require('../models/StockName');
    const stock = await StockName.findOne({
      name: { $regex: stockName, $options: 'i' }
    });
    return stock ? { code: stock.code, name: stock.name } : null;
  } catch (error) {
    console.log('종목명 검색 실패:', error.message);
    return null;
  }
}

async function getStockName(symbol) {
  try {
    const StockName = require('../models/StockName');
    const stock = await StockName.findOne({ code: symbol });
    return stock ? stock.name : `종목_${symbol}`;
  } catch (error) {
    return `종목_${symbol}`;
  }
}

module.exports = router;