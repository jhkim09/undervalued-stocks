const express = require('express');
const router = express.Router();
const KiwoomService = require('../services/kiwoomService');

// 터틀 신호 계산 테스트
router.get('/turtle/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { days = 20 } = req.query;
    
    console.log(`🐢 ${symbol} 터틀 분석 시작...`);
    
    // 1. 일봉 데이터 가져오기
    const priceData = await KiwoomService.getDailyData(symbol, parseInt(days) + 1);
    
    if (priceData.length < 20) {
      return res.json({
        success: false,
        message: '데이터 부족 (최소 20일 필요)',
        dataLength: priceData.length
      });
    }
    
    const latest = priceData[priceData.length - 1]; // 최신 데이터
    const currentPrice = latest.close;
    
    // 2. 20일/10일 고저점 계산
    const highs = priceData.slice(-20).map(d => d.high); // 최근 20일
    const lows = priceData.slice(-10).map(d => d.low);   // 최근 10일
    
    const high20 = Math.max(...highs.slice(0, -1)); // 전일까지 19일 최고가
    const low10 = Math.min(...lows.slice(0, -1));   // 전일까지 9일 최저가
    
    // 3. ATR 계산 (간단 버전)
    const recentData = priceData.slice(-20);
    let atrSum = 0;
    for (let i = 1; i < recentData.length; i++) {
      const current = recentData[i];
      const previous = recentData[i-1];
      
      const tr1 = current.high - current.low;
      const tr2 = Math.abs(current.high - previous.close);
      const tr3 = Math.abs(current.low - previous.close);
      
      atrSum += Math.max(tr1, tr2, tr3);
    }
    const atr = atrSum / 19; // 19일 평균
    
    // 4. 신호 판단
    let signal = null;
    let signalType = 'NONE';
    
    if (currentPrice > high20) {
      signal = 'BUY';
      signalType = '20일 고점 돌파 - 매수 신호';
    } else if (currentPrice < low10) {
      signal = 'SELL';
      signalType = '10일 저점 하향돌파 - 매도 신호';
    }
    
    // 5. 리스크 계산 (5천만원 기준)
    const totalEquity = 50000000;
    const riskPerTrade = totalEquity * 0.02; // 100만원
    const dollarsPerPoint = riskPerTrade / (2 * atr); // 2N 손절
    const recommendedQuantity = signal === 'BUY' ? Math.floor(dollarsPerPoint / currentPrice) : 0;
    const stopLossPrice = signal === 'BUY' ? currentPrice - (2 * atr) : 0;
    
    const analysis = {
      symbol: symbol,
      currentPrice: currentPrice,
      high20: high20,
      low10: low10,
      atr: Math.round(atr),
      signal: signal,
      signalType: signalType,
      analysis: {
        priceVsHigh20: ((currentPrice - high20) / high20 * 100).toFixed(2) + '%',
        priceVsLow10: ((currentPrice - low10) / low10 * 100).toFixed(2) + '%',
        volatility: (atr / currentPrice * 100).toFixed(2) + '%'
      },
      recommendation: signal === 'BUY' ? {
        action: 'BUY',
        quantity: recommendedQuantity,
        investAmount: recommendedQuantity * currentPrice,
        riskAmount: riskPerTrade,
        stopLossPrice: Math.round(stopLossPrice),
        riskReward: '2N 손절 기준'
      } : signal === 'SELL' ? {
        action: 'SELL',
        message: '보유 포지션 전량 매도 권장'
      } : {
        action: 'HOLD',
        message: '신호 없음 - 대기'
      },
      rawData: {
        days: priceData.length,
        latest: latest
      }
    };
    
    res.json({
      success: true,
      analysis: analysis
    });
    
  } catch (error) {
    console.error('터틀 분석 실패:', error);
    res.status(500).json({ 
      success: false, 
      message: '분석 실패',
      error: error.message 
    });
  }
});

module.exports = router;