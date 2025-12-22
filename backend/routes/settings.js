const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const Portfolio = require('../models/Portfolio');

// 초기 설정 - 최초 잔고 및 기본 설정
router.post('/initialize', async (req, res) => {
  try {
    const { userId, initialBalance, accountNumber, watchlist } = req.body;
    
    // 기존 설정 확인
    let settings = await Settings.findOne({ userId });
    let portfolio = await Portfolio.findOne({ userId });
    
    if (!settings) {
      // 새 설정 생성
      settings = new Settings({
        userId,
        kiwoom: {
          accountNumber: accountNumber || '',
          isLive: false,
          isConnected: false
        },
        watchlist: watchlist || [
          { symbol: '005930', name: '삼성전자', priority: 'high' },
          { symbol: '000660', name: 'SK하이닉스', priority: 'high' },
          { symbol: '035420', name: 'NAVER', priority: 'medium' }
        ]
      });
      await settings.save();
    }
    
    if (!portfolio && initialBalance) {
      // 새 포트폴리오 생성
      portfolio = new Portfolio({
        userId,
        initialBalance: initialBalance,
        currentCash: initialBalance,
        totalEquity: initialBalance,
        positions: []
      });
      await portfolio.save();
    } else if (portfolio && initialBalance) {
      // 기존 포트폴리오 업데이트
      portfolio.initialBalance = initialBalance;
      portfolio.currentCash = initialBalance;
      portfolio.totalEquity = initialBalance;
      await portfolio.save();
    }
    
    res.json({
      success: true,
      message: '초기 설정이 완료되었습니다.',
      settings: settings,
      portfolio: portfolio
    });
    
  } catch (error) {
    console.error('초기 설정 실패:', error);
    res.status(500).json({ success: false, message: '설정 저장에 실패했습니다.' });
  }
});

// 설정 조회
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const settings = await Settings.findOne({ userId });
    
    if (!settings) {
      return res.status(404).json({ message: '설정을 찾을 수 없습니다.' });
    }
    
    res.json({
      success: true,
      settings: settings
    });
  } catch (error) {
    console.error('설정 조회 실패:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 관심종목 추가
router.post('/:userId/watchlist', async (req, res) => {
  try {
    const { userId } = req.params;
    const { symbol, name, priority = 'medium' } = req.body;
    
    const settings = await Settings.findOne({ userId });
    if (!settings) {
      return res.status(404).json({ message: '설정을 찾을 수 없습니다.' });
    }
    
    // 중복 체크
    const exists = settings.watchlist.find(item => item.symbol === symbol);
    if (exists) {
      return res.status(400).json({ message: '이미 등록된 종목입니다.' });
    }
    
    settings.watchlist.push({
      symbol,
      name,
      priority,
      addedDate: new Date(),
      isActive: true
    });
    
    await settings.save();
    
    res.json({
      success: true,
      message: '관심종목이 추가되었습니다.',
      watchlist: settings.watchlist
    });
    
  } catch (error) {
    console.error('관심종목 추가 실패:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// Make.com webhook URL 설정
router.post('/:userId/webhook', async (req, res) => {
  try {
    const { userId } = req.params;
    const { webhookUrl } = req.body;
    
    const settings = await Settings.findOne({ userId });
    if (!settings) {
      return res.status(404).json({ message: '설정을 찾을 수 없습니다.' });
    }
    
    settings.notifications.makeWebhookUrl = webhookUrl;
    await settings.save();
    
    res.json({
      success: true,
      message: 'Webhook URL이 설정되었습니다.'
    });
    
  } catch (error) {
    console.error('Webhook 설정 실패:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;