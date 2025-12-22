const express = require('express');
const Trade = require('../models/Trade');
const KiwoomService = require('../services/kiwoomService');
const router = express.Router();

// 거래 기록 조회
router.get('/', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    const limit = parseInt(req.query.limit) || 50;
    
    // MongoDB에서 거래 기록 조회
    const trades = await Trade.find({ userId })
      .sort({ executedAt: -1 })
      .limit(limit);
    
    // 통계 계산
    const stats = {
      totalTrades: trades.length,
      winningTrades: trades.filter(t => t.realizedPL > 0).length,
      totalProfit: trades.filter(t => t.realizedPL > 0).reduce((sum, t) => sum + t.realizedPL, 0),
      totalLoss: Math.abs(trades.filter(t => t.realizedPL < 0).reduce((sum, t) => sum + t.realizedPL, 0)),
      largestWin: trades.length > 0 ? Math.max(...trades.map(t => t.realizedPL)) : 0,
      largestLoss: trades.length > 0 ? Math.abs(Math.min(...trades.map(t => t.realizedPL))) : 0
    };
    
    stats.winRate = stats.totalTrades > 0 ? (stats.winningTrades / stats.totalTrades * 100) : 0;
    stats.profitFactor = stats.totalLoss > 0 ? (stats.totalProfit / stats.totalLoss) : 0;
    
    res.json({
      success: true,
      trades: trades,
      stats: stats,
      kiwoomConnected: KiwoomService.isConnectedToKiwoom(),
      message: trades.length > 0 ? `${trades.length}개 거래기록 조회` : '거래기록이 없습니다'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 거래 기록 추가
router.post('/', async (req, res) => {
  try {
    const tradeData = req.body;
    const trade = new Trade(tradeData);
    await trade.save();
    
    res.json({
      success: true,
      trade: trade,
      message: '거래 기록이 저장되었습니다'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 수동 매매 기록 추가 API (Make.com HTTP 모듈용)
router.post('/manual', async (req, res) => {
  try {
    const { apiKey, symbol, name, action, quantity, price, signal, executedAt } = req.body;
    
    // API 키 검증
    const validApiKey = process.env.MAKE_API_KEY || 'TtL_9K2m8X7nQ4pE6wR3vY5uI8oP1aSdF7gH9jK2mN5vB8xC3zE6rT9yU4iO7pL0';
    if (!apiKey || apiKey !== validApiKey) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Invalid API key'
      });
    }
    
    // 필수 필드 검증
    if (!symbol || !name || !action || !quantity || !price) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: '필수 필드가 누락되었습니다: symbol, name, action, quantity, price'
      });
    }
    
    // 액션 타입 검증
    if (!['BUY', 'SELL'].includes(action.toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_ACTION',
        message: 'action은 BUY 또는 SELL이어야 합니다'
      });
    }
    
    console.log(`📝 수동 매매 기록 추가: ${action} ${symbol} ${quantity}주 @ ${price.toLocaleString()}원`);
    
    // 실현손익 계산 (매도일 경우)
    let realizedPL = 0;
    let entryPrice = null;
    
    if (action.toUpperCase() === 'SELL') {
      // 매도 시 실현손익 계산 (avgPrice가 제공된 경우)
      entryPrice = req.body.avgPrice || req.body.entryPrice;
      if (entryPrice) {
        realizedPL = (price - entryPrice) * quantity;
        console.log(`💰 실현손익 계산: (${price} - ${entryPrice}) × ${quantity} = ${realizedPL.toLocaleString()}원`);
      } else {
        console.log('⚠️ 평균단가 정보 없음, 실현손익 0으로 설정');
      }
    }
    
    // Trade 모델에 맞는 완전한 데이터로 저장
    const totalAmount = quantity * price;
    const commission = Math.round(totalAmount * 0.00015); // 0.015% 수수료
    const tax = action.toUpperCase() === 'SELL' ? Math.round(totalAmount * 0.0023) : 0;
    const netAmount = action.toUpperCase() === 'BUY' ? 
      totalAmount + commission : totalAmount - commission - tax;
    
    const newTrade = new Trade({
      userId: 'default',
      symbol: symbol,
      name: name,
      action: action.toUpperCase(),
      quantity: parseInt(quantity),
      price: parseFloat(price),
      totalAmount: totalAmount,
      commission: commission,
      tax: tax,
      netAmount: netAmount,
      tradeDate: executedAt ? new Date(executedAt) : new Date(),
      signal: signal && ['20day_breakout', '10day_breakdown', '55day_breakout', '20day_breakdown', 'stop_loss'].includes(signal) 
        ? signal : '20day_breakout', // 유효한 enum 값 사용
      atr: 3000, // 기본 ATR 값 (3000원)
      nValue: 3000, // 기본 N값 (20일 ATR)
      riskAmount: Math.round(totalAmount * 0.02), // 2% 리스크 추정
      realizedPL: realizedPL,
      notes: `수동 기록: Make.com HTTP 모듈을 통한 ${action} 거래`,
      recordedAt: new Date()
    });
    
    await newTrade.save();
    
    console.log(`✅ 매매 기록 저장 완료: ${symbol} ${action}`);
    
    res.json({
      success: true,
      trade: {
        id: newTrade._id,
        symbol: newTrade.symbol,
        name: newTrade.name,
        action: newTrade.action,
        quantity: newTrade.quantity,
        price: newTrade.price,
        executedAt: newTrade.executedAt,
        signal: newTrade.signal,
        realizedPL: newTrade.realizedPL
      },
      message: '매매 기록이 성공적으로 추가되었습니다',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('수동 매매 기록 실패:', error);
    res.status(500).json({
      success: false,
      error: 'MANUAL_TRADE_RECORD_FAILED',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 키움 API 거래내역 조회 및 선택적 기록 API
router.get('/kiwoom-history', async (req, res) => {
  try {
    console.log('📊 키움 거래내역 조회 시작...');
    
    // 키움 API 인증 확인
    if (!KiwoomService.isConnectedToKiwoom()) {
      await KiwoomService.authenticate(process.env.KIWOOM_APP_KEY, process.env.KIWOOM_SECRET_KEY);
    }
    
    if (!KiwoomService.isConnectedToKiwoom()) {
      return res.status(503).json({
        success: false,
        error: 'KIWOOM_NOT_CONNECTED',
        message: '키움 API 연결이 필요합니다'
      });
    }
    
    // 키움 당일 거래내역 조회 (체결요청 등)
    let kiwoomTrades = [];
    
    try {
      // 현재 키움 계좌의 당일 매수 내역 확인
      const accountData = await KiwoomService.getAccountBalance();
      if (accountData && accountData.positions) {
        // 당일 매수 종목들을 거래내역으로 변환
        kiwoomTrades = accountData.positions
          .filter(pos => pos.entryDate === new Date().toISOString().split('T')[0]) // 오늘 진입
          .map(pos => ({
            symbol: pos.symbol,
            name: pos.name,
            action: 'BUY',
            quantity: pos.quantity,
            price: pos.avgPrice,
            executedAt: pos.entryDate,
            signal: 'KIWOOM_DETECTED',
            isRecorded: false // 시스템에 미기록
          }));
      }
    } catch (error) {
      console.log('⚠️ 키움 거래내역 조회 실패:', error.message);
    }
    
    // 기존 시스템 거래기록과 비교
    const Trade = require('../models/Trade');
    const systemTrades = await Trade.find({ userId: 'default' })
      .sort({ executedAt: -1 })
      .limit(20);
    
    // 키움 거래 중 시스템에 미기록된 것들 찾기
    const unrecordedTrades = kiwoomTrades.filter(kTrade => 
      !systemTrades.some(sTrade => 
        sTrade.symbol === kTrade.symbol && 
        sTrade.executedAt.toISOString().split('T')[0] === kTrade.executedAt
      )
    );
    
    res.json({
      success: true,
      data: {
        kiwoomTrades: kiwoomTrades,
        systemTrades: systemTrades.map(trade => ({
          id: trade._id,
          symbol: trade.symbol,
          name: trade.name,
          action: trade.action,
          quantity: trade.quantity,
          price: trade.price,
          executedAt: trade.executedAt,
          signal: trade.signal,
          realizedPL: trade.realizedPL,
          source: trade.metadata?.source || 'system'
        })),
        unrecordedTrades: unrecordedTrades,
        summary: {
          kiwoomTotal: kiwoomTrades.length,
          systemTotal: systemTrades.length,
          unrecorded: unrecordedTrades.length
        }
      },
      message: `키움 거래내역 ${kiwoomTrades.length}개, 시스템 기록 ${systemTrades.length}개`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('거래내역 조회 실패:', error);
    res.status(500).json({
      success: false,
      error: 'TRADE_HISTORY_FAILED',
      message: error.message
    });
  }
});

// 키움 거래내역을 시스템에 일괄 등록 API
router.post('/import-kiwoom', async (req, res) => {
  try {
    const { trades } = req.body; // 선택된 거래내역들
    
    if (!trades || !Array.isArray(trades)) {
      return res.status(400).json({
        success: false,
        message: '거래내역 배열이 필요합니다'
      });
    }
    
    console.log(`📝 키움 거래내역 ${trades.length}개 일괄 등록 시작...`);
    
    const savedTrades = [];
    
    for (const tradeData of trades) {
      try {
        const newTrade = new Trade({
          userId: 'default',
          symbol: tradeData.symbol,
          name: tradeData.name,
          action: tradeData.action,
          quantity: tradeData.quantity,
          price: tradeData.price,
          executedAt: new Date(tradeData.executedAt),
          realizedPL: tradeData.realizedPL || 0,
          signal: tradeData.signal || 'KIWOOM_IMPORT',
          metadata: {
            recordedBy: 'kiwoom_import',
            recordedAt: new Date().toISOString(),
            source: 'kiwoom_api'
          }
        });
        
        await newTrade.save();
        savedTrades.push(newTrade);
        
      } catch (saveError) {
        console.error(`거래 저장 실패 (${tradeData.symbol}):`, saveError.message);
      }
    }
    
    console.log(`✅ 키움 거래내역 ${savedTrades.length}개 등록 완료`);
    
    res.json({
      success: true,
      imported: savedTrades.length,
      total: trades.length,
      trades: savedTrades.map(trade => ({
        id: trade._id,
        symbol: trade.symbol,
        name: trade.name,
        action: trade.action,
        quantity: trade.quantity,
        price: trade.price,
        executedAt: trade.executedAt
      })),
      message: `${savedTrades.length}개 거래내역이 시스템에 등록되었습니다`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('거래내역 일괄 등록 실패:', error);
    res.status(500).json({
      success: false,
      error: 'IMPORT_TRADES_FAILED',
      message: error.message
    });
  }
});

// 거래 기록 삭제 API (Make.com용)
router.delete('/manual/:id', async (req, res) => {
  try {
    const { apiKey } = req.body;
    const tradeId = req.params.id;
    
    // API 키 검증
    const validApiKey = process.env.MAKE_API_KEY || 'TtL_9K2m8X7nQ4pE6wR3vY5uI8oP1aSdF7gH9jK2mN5vB8xC3zE6rT9yU4iO7pL0';
    if (!apiKey || apiKey !== validApiKey) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Invalid API key'
      });
    }
    
    console.log(`🗑️ 매매 기록 삭제 요청: ${tradeId}`);
    
    // 삭제할 거래 기록 조회
    const trade = await Trade.findById(tradeId);
    if (!trade) {
      return res.status(404).json({
        success: false,
        error: 'TRADE_NOT_FOUND',
        message: '삭제할 거래 기록을 찾을 수 없습니다'
      });
    }
    
    console.log(`📝 삭제할 거래: ${trade.action} ${trade.symbol} ${trade.quantity}주`);
    
    // 거래 기록 삭제
    await Trade.findByIdAndDelete(tradeId);
    
    console.log(`✅ 매매 기록 삭제 완료: ${trade.symbol}`);
    
    res.json({
      success: true,
      deletedTrade: {
        id: trade._id,
        symbol: trade.symbol,
        name: trade.name,
        action: trade.action,
        quantity: trade.quantity,
        price: trade.price
      },
      message: '매매 기록이 성공적으로 삭제되었습니다',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('매매 기록 삭제 실패:', error);
    res.status(500).json({
      success: false,
      error: 'DELETE_TRADE_FAILED',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 매도 전용 API (실현손익 자동 계산)
router.post('/sell', async (req, res) => {
  try {
    const { apiKey, symbol, name, quantity, price, avgPrice, signal, executedAt } = req.body;
    
    // API 키 검증
    const validApiKey = process.env.MAKE_API_KEY || 'TtL_9K2m8X7nQ4pE6wR3vY5uI8oP1aSdF7gH9jK2mN5vB8xC3zE6rT9yU4iO7pL0';
    if (!apiKey || apiKey !== validApiKey) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Invalid API key'
      });
    }
    
    // 필수 필드 검증
    if (!symbol || !name || !quantity || !price || !avgPrice) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: '매도 기록 필수 필드: symbol, name, quantity, price, avgPrice'
      });
    }
    
    console.log(`📝 매도 기록 추가: SELL ${symbol} ${quantity}주 @ ${price.toLocaleString()}원 (평균단가: ${avgPrice.toLocaleString()}원)`);
    
    // 실현손익 정확히 계산
    const realizedPL = (price - avgPrice) * quantity;
    const totalAmount = quantity * price;
    const commission = Math.round(totalAmount * 0.00015);
    const tax = Math.round(totalAmount * 0.0023);
    const netAmount = totalAmount - commission - tax;
    
    console.log(`💰 실현손익: (${price.toLocaleString()} - ${avgPrice.toLocaleString()}) × ${quantity} = ${realizedPL.toLocaleString()}원`);
    
    const newTrade = new Trade({
      userId: 'default',
      symbol: symbol,
      name: name,
      action: 'SELL',
      quantity: parseInt(quantity),
      price: parseFloat(price),
      totalAmount: totalAmount,
      commission: commission,
      tax: tax,
      netAmount: netAmount,
      tradeDate: executedAt ? new Date(executedAt) : new Date(),
      signal: signal && ['20day_breakout', '10day_breakdown', '55day_breakout', '20day_breakdown', 'stop_loss'].includes(signal) 
        ? signal : '10day_breakdown', // 매도 기본값
      atr: 3000,
      nValue: 3000,
      riskAmount: Math.round(totalAmount * 0.02),
      entryPrice: parseFloat(avgPrice),
      realizedPL: realizedPL,
      notes: `수동 매도 기록: Make.com HTTP 모듈을 통한 매도 거래`,
      recordedAt: new Date()
    });
    
    await newTrade.save();
    
    console.log(`✅ 매도 기록 저장 완료: ${symbol} 실현손익 ${realizedPL.toLocaleString()}원`);
    
    res.json({
      success: true,
      trade: {
        id: newTrade._id,
        symbol: newTrade.symbol,
        name: newTrade.name,
        action: newTrade.action,
        quantity: newTrade.quantity,
        price: newTrade.price,
        avgPrice: newTrade.entryPrice,
        realizedPL: newTrade.realizedPL,
        netAmount: newTrade.netAmount,
        executedAt: newTrade.tradeDate,
        signal: newTrade.signal
      },
      message: `매도 기록 완료: 실현손익 ${realizedPL.toLocaleString()}원`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('매도 기록 실패:', error);
    res.status(500).json({
      success: false,
      error: 'SELL_TRADE_RECORD_FAILED',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;