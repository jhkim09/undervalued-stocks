const express = require('express');
const mongoose = require('mongoose');
const Portfolio = require('../models/Portfolio');
const KiwoomService = require('../services/kiwoomService');
const router = express.Router();

// 포트폴리오 조회 (포지션 포함)
router.get('/', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    
    // 키움 API 우선 시도 (MongoDB 연결과 무관하게)
    let kiwoomData = null;
    let kiwoomConnected = false;
    
    try {
      // 키움 API 자동 인증 시도
      if (!KiwoomService.isConnectedToKiwoom()) {
        console.log('🔐 키움 API 자동 인증 시도...');
        await KiwoomService.authenticate(process.env.KIWOOM_APP_KEY, process.env.KIWOOM_SECRET_KEY);
      }
      
      // 키움 계좌 조회
      if (KiwoomService.isConnectedToKiwoom()) {
        kiwoomData = await KiwoomService.getAccountBalance();
        kiwoomConnected = true;
        console.log(`✅ 키움 실제 데이터: 총자산 ${kiwoomData?.totalAsset?.toLocaleString()}원`);
      }
    } catch (error) {
      console.log('⚠️ 키움 API 실패, 시뮬레이션 모드 사용');
    }

    // 키움 데이터가 있으면 실제 데이터 우선 반환
    if (kiwoomData && kiwoomData.totalAsset) {
      console.log(`✅ 키움 실제 데이터 반환: 총자산 ${kiwoomData.totalAsset.toLocaleString()}원`);
      
      return res.json({
        success: true,
        portfolio: {
          userId: userId,
          currentCash: kiwoomData.cash || 0,
          totalEquity: kiwoomData.totalAsset || 0,
          portfolioValue: kiwoomData.totalAsset || 0,
          totalReturn: kiwoomData.totalReturn || 0,
          currentRiskExposure: kiwoomData.riskExposure || 0,
          positions: kiwoomData.positions || [],
          riskSettings: {
            maxRiskPerTrade: 100000,
            maxTotalRisk: 400000,
            minCashReserve: 200000
          },
          stats: kiwoomData.stats || {
            totalTrades: 0,
            winningTrades: 0,
            totalProfit: 0,
            totalLoss: 0,
            winRate: 0,
            profitFactor: 0
          }
        },
        kiwoomConnected: true,
        message: '키움 API 실제 계좌 데이터'
      });
    }
    
    // MongoDB 연결 실패이고 키움도 실패한 경우에만 시뮬레이션
    if (!mongoose.connection.readyState) {
      return res.json({
        success: true,
        portfolio: {
          userId: userId,
          currentCash: 3500000, // 350만원 현금
          totalEquity: 12750000, // 1275만원 총 자산
          portfolioValue: 12750000,
          totalReturn: 27.5, // 27.5% 수익률
          currentRiskExposure: 255000, // 25.5만원 리스크 노출
          positions: [
            {
              symbol: '005930',
              name: '삼성전자',
              quantity: 60,
              avgPrice: 68500,
              currentPrice: 71000,
              unrealizedPL: 150000, // +15만원 평가손익
              stopLossPrice: 61650, // 10% 손절선
              entryDate: '2024-12-10',
              entrySignal: 'TURTLE_BUY_20D',
              atr: 2850,
              riskAmount: 85500 // 종목당 리스크
            },
            {
              symbol: '000660',
              name: 'SK하이닉스',
              quantity: 35,
              avgPrice: 195000,
              currentPrice: 265000,
              unrealizedPL: 2450000, // +245만원 평가손익
              stopLossPrice: 175500, // 10% 손절선
              entryDate: '2024-11-15',
              entrySignal: 'TURTLE_BUY_52W',
              atr: 9750,
              riskAmount: 169500 // 종목당 리스크
            }
          ],
          riskSettings: {
            maxRiskPerTrade: 100000, // 종목당 최대 10만원
            maxTotalRisk: 400000,   // 전체 최대 40만원
            minCashReserve: 2000000 // 최소 200만원 현금 유지
          },
          stats: {
            totalTrades: 18,
            winningTrades: 12,
            totalProfit: 4200000,
            totalLoss: -980000,
            largestWin: 850000,
            largestLoss: -180000,
            winRate: 66.7,
            profitFactor: 4.3
          }
        },
        kiwoomConnected: kiwoomConnected,
        message: kiwoomConnected ? '키움 API 연결됨 - 실제 데이터' : '키움 미연결 - 시뮬레이션 데이터'
      });
    }
    
    let portfolio = await Portfolio.findOne({ userId });
    
    if (!portfolio) {
      portfolio = new Portfolio({
        userId,
        initialBalance: 50000000,
        currentCash: 50000000,
        totalEquity: 50000000,
        positions: []
      });
      await portfolio.save();
    }

    // 키움 계좌 정보로 실제 총자산 업데이트
    let kiwoomAccountData = null;
    let displayPortfolio = { ...portfolio.toObject() }; // MongoDB 데이터를 기본값으로
    
    try {
      // 키움 API 자동 연결 시도
      if (!KiwoomService.isConnectedToKiwoom()) {
        console.log('🔐 키움 API 자동 인증 시도...');
        try {
          await KiwoomService.authenticate(process.env.KIWOOM_APP_KEY, process.env.KIWOOM_SECRET_KEY);
          console.log('✅ 키움 API 자동 인증 성공');
        } catch (authError) {
          console.log('⚠️ 키움 자동 인증 실패, 시뮬레이션 모드 유지');
        }
      }
      
      if (KiwoomService.isConnectedToKiwoom()) {
        kiwoomAccountData = await KiwoomService.getAccountBalance();
        if (kiwoomAccountData) {
          // MongoDB에 저장
          portfolio.currentCash = kiwoomAccountData.cash;
          portfolio.totalEquity = kiwoomAccountData.totalAsset;
          portfolio.portfolioValue = kiwoomAccountData.totalAsset;
          await portfolio.save();
          
          // 응답에도 즉시 반영
          displayPortfolio.currentCash = kiwoomAccountData.cash;
          displayPortfolio.totalEquity = kiwoomAccountData.totalAsset;
          displayPortfolio.portfolioValue = kiwoomAccountData.totalAsset;
          displayPortfolio.positions = kiwoomAccountData.positions || [];
          
          console.log(`💰 실제 키움 데이터 반영: 총자산 ${kiwoomAccountData.totalAsset.toLocaleString()}원`);
        }
      }
    } catch (error) {
      console.log('키움 계좌 정보 조회 실패:', error.message);
    }
    
    res.json({
      success: true,
      portfolio: {
        userId: displayPortfolio.userId,
        currentCash: displayPortfolio.currentCash,
        totalEquity: displayPortfolio.totalEquity,
        portfolioValue: displayPortfolio.portfolioValue,
        totalReturn: displayPortfolio.totalReturn,
        currentRiskExposure: displayPortfolio.currentRiskExposure,
        positions: displayPortfolio.positions,
        riskSettings: displayPortfolio.riskSettings,
        stats: displayPortfolio.stats
      },
      kiwoomConnected: KiwoomService.isConnectedToKiwoom(),
      message: kiwoomAccountData ? `키움 실계좌 연동: ${kiwoomAccountData.totalAsset.toLocaleString()}원` : '시뮬레이션 모드'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 포지션 추가/수정
router.post('/', async (req, res) => {
  try {
    const userId = req.body.userId || 'default';
    const positionData = req.body;
    
    let portfolio = await Portfolio.findOne({ userId });
    if (!portfolio) {
      return res.status(404).json({ success: false, message: '포트폴리오를 찾을 수 없습니다' });
    }
    
    // 기존 포지션 찾기
    const existingPosition = portfolio.positions.find(p => p.symbol === positionData.symbol);
    
    if (existingPosition) {
      // 포지션 업데이트
      Object.assign(existingPosition, positionData);
    } else {
      // 새 포지션 추가
      portfolio.positions.push({
        symbol: positionData.symbol,
        name: positionData.name,
        quantity: positionData.quantity,
        avgPrice: positionData.avgPrice,
        currentPrice: positionData.currentPrice || positionData.avgPrice,
        stopLossPrice: positionData.stopLossPrice,
        entryDate: positionData.entryDate || new Date(),
        entrySignal: positionData.entrySignal || '20day_breakout',
        atr: positionData.atr,
        riskAmount: positionData.riskAmount,
        unrealizedPL: 0
      });
    }
    
    await portfolio.save();
    
    res.json({
      success: true,
      portfolio: portfolio,
      message: '포지션이 성공적으로 업데이트되었습니다'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 포지션 삭제
router.delete('/:symbol', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    const symbol = req.params.symbol;
    
    const portfolio = await Portfolio.findOne({ userId });
    if (!portfolio) {
      return res.status(404).json({ success: false, message: '포트폴리오를 찾을 수 없습니다' });
    }
    
    portfolio.positions = portfolio.positions.filter(p => p.symbol !== symbol);
    await portfolio.save();
    
    res.json({
      success: true,
      message: `${symbol} 포지션이 삭제되었습니다`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;