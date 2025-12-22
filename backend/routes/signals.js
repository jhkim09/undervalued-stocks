const express = require('express');
const router = express.Router();
const Signal = require('../models/Signal');
const TurtleAnalyzer = require('../services/turtleAnalyzer');
const SuperstocksAnalyzer = require('../services/superstocksAnalyzer');
const SlackMessageFormatter = require('../services/slackMessageFormatter');
const FinancialData = require('../models/FinancialData');

// ETF 종목 식별 함수
function isETFStock(symbol, name) {
  // 이름 패턴으로만 ETF 식별 (코드 패턴은 너무 광범위함)
  const etfNamePatterns = [
    'TIGER', 'KODEX', 'ARIRANG', 'KBSTAR', 'HANARO', 
    'SMART', 'ACE', 'TREX', 'TIMEFOLIO',
    '미국나스닥', '나스닥', 'S&P', 'QQQ',
    'ETF', 'ETN', '인덱스', '추적',
    '레버리지', '인버스'
  ];
  
  // 이름 패턴 체크만 사용
  if (name) {
    const upperName = name.toUpperCase();
    for (const pattern of etfNamePatterns) {
      if (upperName.includes(pattern.toUpperCase())) {
        console.log(`🔍 ETF 감지: ${symbol} (${name}) - 패턴: ${pattern}`);
        return true;
      }
    }
  }
  
  console.log(`📊 일반 주식: ${symbol} (${name}) - ETF 아님`);
  return false;
}

// API 헬스체크 및 상태 확인
router.get('/health', async (req, res) => {
  try {
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '3.0',
      services: {
        server: 'running',
        database: 'connected', // TODO: 실제 DB 연결 상태 확인
        dartApi: process.env.DART_API_KEY ? 'configured' : 'missing',
        makeApi: process.env.MAKE_API_KEY ? 'configured' : 'missing'
      },
      endpoints: {
        superstocksSearch: '/api/signals/superstocks-search',
        turtleAnalysis: '/api/signals/analyze',
        buySignals: '/api/signals/make-analysis/buy',
        sellSignals: '/api/signals/make-analysis/sell',
        portfolioNValues: '/api/signals/portfolio-n-values',
        legacyAnalysis: '/api/signals/make-analysis (deprecated)'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 최신 신호 조회
router.get('/latest', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const signals = await Signal.find()
      .sort({ date: -1 })
      .limit(limit);
    
    res.json({
      success: true,
      signals: signals,
      count: signals.length,
      message: '최신 신호 조회 완료'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 수동 분석 실행 (기존 - 순수 기술적 분석)
router.post('/analyze', async (req, res) => {
  try {
    console.log('🔍 수동 터틀 분석 시작...');
    
    // 실제 터틀 분석 실행
    const signals = await TurtleAnalyzer.analyzeMarket();
    
    res.json({
      success: true,
      message: '터틀 분석 완료',
      signals: signals,
      count: signals.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('분석 실패:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message,
      error: '터틀 분석 중 오류가 발생했습니다'
    });
  }
});

// 재무건전성 필터링이 있는 터틀 분석
router.post('/analyze-with-financial-filter', async (req, res) => {
  try {
    console.log('🔍 재무 필터링 터틀 분석 시작...');
    
    const { 
      minRevenueGrowth = 10,
      maxPSR = 3.0
    } = req.body;
    
    // 재무건전성 필터가 있는 터틀 분석 실행
    const signals = await TurtleAnalyzer.analyzeMarket({
      useFinancialFilter: true,
      minRevenueGrowth: minRevenueGrowth,
      maxPSR: maxPSR
    });
    
    const financialSignals = signals.filter(s => s.hasFinancialData);
    
    res.json({
      success: true,
      message: '재무 필터링 터틀 분석 완료',
      signals: signals,
      financialSignals: financialSignals,
      count: signals.length,
      financialCount: financialSignals.length,
      filterSettings: {
        minRevenueGrowth: minRevenueGrowth,
        maxPSR: maxPSR
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('재무 필터링 분석 실패:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message,
      error: '재무 필터링 터틀 분석 중 오류가 발생했습니다'
    });
  }
});

// 특정 종목 분석
router.post('/analyze/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { name } = req.body;
    
    console.log(`🔍 ${symbol} 개별 분석 시작...`);
    
    const signal = await TurtleAnalyzer.analyzeStock(symbol, name || symbol);
    
    res.json({
      success: true,
      signal: signal,
      message: `${symbol} 분석 완료`
    });
    
  } catch (error) {
    console.error('개별 분석 실패:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 리스크 분석
router.get('/risk', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    const riskAnalysis = await TurtleAnalyzer.calculateRisk(userId);
    
    res.json({
      success: true,
      riskAnalysis: riskAnalysis,
      message: '리스크 분석 완료'
    });
    
  } catch (error) {
    console.error('리스크 분석 실패:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 고속 슈퍼스톡스 검색 API (Bulk DART API 활용)
router.post('/superstocks-search', async (req, res) => {
  try {
    console.log('📨 슈퍼스톡스 검색 API 요청 수신:', {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      bodyType: typeof req.body
    });

    // 요청 본문 검증
    if (!req.body) {
      console.error('❌ 요청 본문이 비어있음');
      return res.status(400).json({
        success: false,
        error: 'MISSING_BODY',
        message: 'Request body is required'
      });
    }

    const { 
      apiKey, 
      symbols,
      conditions = {},
      includeCharts = false
    } = req.body;

    console.log('🔍 파싱된 요청 데이터:', {
      apiKey: apiKey ? `${apiKey.substring(0, 8)}...` : 'undefined',
      symbols: symbols ? symbols.length : 'default',
      conditions,
      includeCharts
    });
    
    // API 키 검증
    const validApiKey = process.env.MAKE_API_KEY || 'TtL_9K2m8X7nQ4pE6wR3vY5uI8oP1aSdF7gH9jK2mN5vB8xC3zE6rT9yU4iO7pL0';
    if (!apiKey || apiKey !== validApiKey) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Invalid API key'
      });
    }
    
    // 검색 조건 설정
    const searchConditions = {
      minRevenueGrowth: conditions.minRevenueGrowth || 15,
      minNetIncomeGrowth: conditions.minNetIncomeGrowth || 15,
      maxPSR: conditions.maxPSR || 0.75,
      minPrice: conditions.minPrice || 0,
      maxPrice: conditions.maxPrice || 1000000
    };
    
    const stockList = symbols || SuperstocksAnalyzer.getDefaultStockList();
    
    console.log(`⚡ 고속 슈퍼스톡스 검색 시작: ${stockList.length}개 종목 (조건: 매출성장률 ≥${searchConditions.minRevenueGrowth}%, PSR ≤${searchConditions.maxPSR})`);
    
    const startTime = Date.now();
    
    // 1. 고속 재무데이터 조회 (캐시 + Bulk API)
    const FinancialDataCacheService = require('../services/financialDataCacheService');
    const financialDataMap = await FinancialDataCacheService.getSuperstocksFinancialData(stockList);
    
    console.log(`📊 재무데이터 수집 완료: ${financialDataMap.size}개 종목 (소요시간: ${((Date.now() - startTime)/1000).toFixed(1)}초)`);
    
    // 2. 현재가 조회 (병렬 처리)
    const pricePromises = Array.from(financialDataMap.keys()).map(async (stockCode) => {
      try {
        const KiwoomService = require('../services/kiwoomService');
        let currentPrice = await KiwoomService.getCurrentPrice(stockCode);
        
        if (!currentPrice) {
          // 키움 실패시 Yahoo Finance 백업
          const YahooFinanceService = require('../services/yahooFinanceService');
          currentPrice = await YahooFinanceService.getCurrentPrice(stockCode);
        }
        
        return { stockCode, currentPrice, error: null };
      } catch (error) {
        return { stockCode, currentPrice: null, error: error.message };
      }
    });
    
    const priceResults = await Promise.all(pricePromises);
    const priceMap = new Map();
    priceResults.forEach(result => {
      if (result.currentPrice) {
        priceMap.set(result.stockCode, result.currentPrice);
      }
    });
    
    console.log(`💰 현재가 수집 완료: ${priceMap.size}개 종목 (소요시간: ${((Date.now() - startTime)/1000).toFixed(1)}초)`);
    
    // 3. PSR 계산 및 조건 필터링
    const results = [];
    
    financialDataMap.forEach((financialData, stockCode) => {
      const currentPrice = priceMap.get(stockCode);
      if (!currentPrice || !financialData.revenue || financialData.revenue <= 0) return;
      
      // PSR 계산을 위한 상장주식수 (추정값 사용)
      const estimatedShares = SuperstocksAnalyzer.estimateSharesOutstanding(
        stockCode, 
        currentPrice, 
        financialData.revenue
      );
      
      const marketCap = currentPrice * estimatedShares;
      const revenueInWon = financialData.revenue * 100000000;
      const psr = revenueInWon > 0 ? marketCap / revenueInWon : 999;
      
      // 조건 확인
      const meetsConditions = (
        financialData.revenueGrowth3Y >= searchConditions.minRevenueGrowth &&
        financialData.netIncomeGrowth3Y >= searchConditions.minNetIncomeGrowth &&
        psr <= searchConditions.maxPSR &&
        currentPrice >= searchConditions.minPrice &&
        currentPrice <= searchConditions.maxPrice
      );
      
      // 점수 계산
      let score = 0;
      if (financialData.revenueGrowth3Y >= 20) score += 40;
      else if (financialData.revenueGrowth3Y >= 15) score += 30;
      
      if (financialData.netIncomeGrowth3Y >= 20) score += 40;
      else if (financialData.netIncomeGrowth3Y >= 15) score += 30;
      
      if (psr <= 0.5) score += 20;
      else if (psr <= 0.75) score += 10;
      
      const grade = score >= 80 ? 'EXCELLENT' : score >= 60 ? 'GOOD' : score >= 40 ? 'FAIR' : 'POOR';
      
      results.push({
        symbol: stockCode,
        name: financialData.name,
        currentPrice: currentPrice,
        revenue: financialData.revenue,
        netIncome: financialData.netIncome,
        revenueGrowth3Y: financialData.revenueGrowth3Y,
        netIncomeGrowth3Y: financialData.netIncomeGrowth3Y,
        psr: Math.round(psr * 1000) / 1000,
        marketCap: marketCap,
        score: grade,
        numericScore: score,
        meetsConditions: meetsConditions,
        dataSource: financialData.dataSource,
        lastUpdated: financialData.lastUpdated
      });
    });
    
    // 4. 결과 정렬 및 필터링
    const qualifiedStocks = results.filter(stock => stock.meetsConditions)
      .sort((a, b) => b.numericScore - a.numericScore);
    
    const allResults = results.sort((a, b) => b.numericScore - a.numericScore);
    
    const endTime = Date.now();
    const processingTime = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log(`⚡ 고속 검색 완료: ${qualifiedStocks.length}개 조건 만족 (총 ${results.length}개 분석, 소요시간: ${processingTime}초)`);
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      processingTime: `${processingTime}초`,
      searchConditions,
      summary: {
        totalAnalyzed: results.length,
        qualifiedStocks: qualifiedStocks.length,
        excellentStocks: qualifiedStocks.filter(s => s.score === 'EXCELLENT').length,
        goodStocks: qualifiedStocks.filter(s => s.score === 'GOOD').length,
        averagePSR: results.length > 0 ? (results.reduce((sum, s) => sum + s.psr, 0) / results.length).toFixed(3) : 0,
        performance: {
          cacheHitRate: financialDataMap.size > 0 ? 'High' : 'Low',
          priceCollectionRate: `${priceMap.size}/${stockList.length} (${((priceMap.size/stockList.length)*100).toFixed(1)}%)`,
          totalProcessingTime: processingTime + '초'
        }
      },
      qualifiedStocks: qualifiedStocks.slice(0, 50), // 상위 50개만
      excellentStocks: qualifiedStocks.filter(s => s.score === 'EXCELLENT').slice(0, 20),
      goodStocks: qualifiedStocks.filter(s => s.score === 'GOOD').slice(0, 20),
      allResults: allResults.slice(0, 100), // 전체 결과 상위 100개만
      metadata: {
        requestedBy: 'api_client',
        analysisType: 'superstocks_bulk_search',
        market: 'KRX',
        apiVersion: '3.0',
        optimizations: [
          'DART Bulk API',
          'Financial Data Caching',
          'Parallel Price Collection',
          'In-Memory Processing'
        ]
      }
    });
    
  } catch (error) {
    console.error('❌ 고속 슈퍼스톡스 검색 실패:', {
      error: error.message,
      stack: error.stack,
      name: error.name,
      timestamp: new Date().toISOString()
    });

    // 더 구체적인 에러 응답
    const errorResponse = {
      success: false,
      error: 'SUPERSTOCKS_SEARCH_FAILED',
      message: error.message || '알 수 없는 오류가 발생했습니다',
      timestamp: new Date().toISOString(),
      details: {
        errorName: error.name,
        errorType: typeof error
      }
    };

    // 개발 환경에서는 더 자세한 정보 제공
    if (process.env.NODE_ENV !== 'production') {
      errorResponse.stack = error.stack;
      errorResponse.debugInfo = {
        requestReceived: true,
        bodyParsed: !!req.body
      };
    }

    res.status(500).json(errorResponse);
  }
});

// Make.com 통합 분석 API (터틀 + 슈퍼스톡스) - BUY 신호만
router.post('/make-analysis/buy', async (req, res) => {
  try {
    const { apiKey, symbols, investmentBudget } = req.body;
    
    // API 키 검증
    const validApiKey = process.env.MAKE_API_KEY || 'TtL_9K2m8X7nQ4pE6wR3vY5uI8oP1aSdF7gH9jK2mN5vB8xC3zE6rT9yU4iO7pL0';
    if (!apiKey || apiKey !== validApiKey) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Invalid API key'
      });
    }
    
    // 투자 예산 설정 (기본값: 100만원)
    const budget = investmentBudget || 1000000;
    console.log(`🔍 Make.com에서 BUY 신호 분석 요청 | 투자예산: ${(budget/10000).toFixed(0)}만원`);
    
    // 터틀 분석 로그 초기화
    global.turtleAnalysisLogs = [];
    global.investmentBudget = budget; // 전역 변수로 예산 설정
    
    // 터틀 분석 (오류 방어)
    let turtleSignals = [];
    try {
      turtleSignals = await TurtleAnalyzer.analyzeMarket() || [];
      console.log(`✅ 터틀 분석 완료: ${turtleSignals.length}개 신호`);
    } catch (turtleError) {
      console.error('❌ 터틀 분석 실패:', turtleError.message);
      turtleSignals = [];
    }
    
    // 슈퍼스톡스 분석 (하이브리드 방식: 캐시 + 키움 가격)
    let superstocks = [];
    try {
      console.log(`📊 하이브리드 슈퍼스톡스 분석 시작...`);
      
      // 1. 캐시에서 재무조건 만족 종목 조회 (실제 DART 데이터 우선)
      const financialCandidates = await FinancialData.find({
        dataYear: 2025,
        dataSource: { $in: ['DART', 'ESTIMATED'] }, // DART 데이터 우선, 없으면 추정치
        revenueGrowth3Y: { $gte: 15 },
        netIncomeGrowth3Y: { $gte: 15 },
        revenue: { $gt: 100 }
      }).sort({ 
        dataSource: 1, // DART가 먼저 오도록 (알파벳 순)
        revenueGrowth3Y: -1 
      }).limit(30); // 상위 30개

      console.log(`📋 재무조건 만족: ${financialCandidates.length}개 후보`);

      // 2. 키움 API로 가격 조회 (검증된 가격만)
      const StockPriceService = require('../services/stockPriceService');
      const stockCodes = financialCandidates.map(stock => stock.stockCode);
      const priceResult = await StockPriceService.getBulkPrices(stockCodes, false);

      // 3. 실제 가격이 있는 종목만 분석 (캐시된 회사명 사용)
      const StockNameCacheService = require('../services/stockNameCacheService');
      const nameMap = await StockNameCacheService.getBulkStockNames(stockCodes);

      for (const stock of financialCandidates) {
        const currentPrice = priceResult.prices.get(stock.stockCode);
        
        if (currentPrice && currentPrice > 1000) {
          // PSR 계산
          const marketCap = currentPrice * stock.sharesOutstanding;
          const revenueInWon = stock.revenue * 100000000;
          const psr = revenueInWon > 0 ? marketCap / revenueInWon : 999;

          // 캐시된 실제 회사명 사용
          const realStockName = nameMap.get(stock.stockCode) || `ST_${stock.stockCode}`;

          // PSR 조건 확인 (현실적 기준 2.5)
          if (psr <= 2.5) {
            superstocks.push({
              symbol: stock.stockCode,
              name: realStockName, // 실제 회사명 사용
              currentPrice: currentPrice,
              revenueGrowth3Y: stock.revenueGrowth3Y,
              netIncomeGrowth3Y: stock.netIncomeGrowth3Y,
              psr: Math.round(psr * 1000) / 1000,
              marketCap: marketCap,
              revenue: stock.revenue,
              netIncome: stock.netIncome,
              score: stock.revenueGrowth3Y >= 30 ? 'EXCELLENT' : 'GOOD',
              meetsConditions: true,
              dataSource: stock.dataSource === 'DART' ? 'DART_REALTIME' : 'HYBRID_CACHE_KIWOOM',
              timestamp: new Date().toISOString()
            });
          }
        }
      }

      console.log(`✅ 하이브리드 슈퍼스톡스 분석 완료: ${superstocks.length}개 결과`);
    } catch (superstocksError) {
      console.error('❌ 슈퍼스톡스 분석 실패:', superstocksError.message);
      superstocks = [];
    }
    
    // 두 조건 모두 만족하는 주식 찾기 (안전한 처리)
    const overlappingStocks = [];
    
    turtleSignals.forEach(turtle => {
      const superstock = superstocks.find(s => s.symbol === turtle.symbol);
      if (superstock && superstock.meetsConditions) {
        overlappingStocks.push({
          symbol: turtle.symbol,
          name: turtle.name,
          turtleSignal: turtle.signalType,
          superstocksScore: superstock.score,
          currentPrice: turtle.currentPrice,
          turtleAction: turtle.recommendedAction?.action || 'HOLD',
          superstocksData: {
            revenueGrowth3Y: superstock.revenueGrowth3Y,
            netIncomeGrowth3Y: superstock.netIncomeGrowth3Y,
            psr: superstock.psr
          },
          isPremiumOpportunity: true
        });
      }
    });
    
    // BUY 신호만 필터링
    const buySignals = turtleSignals.filter(s => s.signalType?.includes('BUY') || s.recommendedAction?.action === 'BUY');
    const qualifiedSuperstocks = superstocks.filter(s => s && s.meetsConditions) || [];
    
    // BUY 신호와 슈퍼스톡스 겹치는 종목
    const buyOpportunities = [];
    buySignals.forEach(turtle => {
      const superstock = superstocks.find(s => s.symbol === turtle.symbol);
      if (superstock && superstock.meetsConditions) {
        buyOpportunities.push({
          symbol: turtle.symbol,
          name: turtle.name,
          turtleSignal: turtle.signalType,
          superstocksScore: superstock.score,
          currentPrice: turtle.currentPrice,
          turtleAction: turtle.recommendedAction?.action || 'BUY',
          superstocksData: {
            revenueGrowth3Y: superstock.revenueGrowth3Y,
            netIncomeGrowth3Y: superstock.netIncomeGrowth3Y,
            psr: superstock.psr
          },
          isPremiumBuyOpportunity: true
        });
      }
    });
    
    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      signalType: 'BUY',
      summary: {
        turtleBuySignals: buySignals.length || 0,
        qualifiedSuperstocks: qualifiedSuperstocks.length || 0,
        premiumBuyOpportunities: buyOpportunities.length || 0,
        hasBuyOpportunity: buySignals.length > 0 || qualifiedSuperstocks.length > 0
      },
      buySignals: {
        turtle: buySignals.map(signal => ({
          symbol: signal.symbol,
          name: signal.name,
          signalType: signal.signalType,
          currentPrice: signal.currentPrice,
          action: signal.recommendedAction?.action || 'BUY',
          reasoning: signal.recommendedAction?.reasoning || '',
          breakoutPrice: signal.breakoutPrice || null,
          highPrice20D: signal.highPrice20D || null
        })),
        superstocks: qualifiedSuperstocks.map(stock => ({
          symbol: stock.symbol,
          name: stock.name,
          currentPrice: stock.currentPrice,
          revenueGrowth3Y: stock.revenueGrowth3Y,
          netIncomeGrowth3Y: stock.netIncomeGrowth3Y,
          psr: stock.psr,
          score: stock.score
        })),
        premium: buyOpportunities
      },
      investmentSettings: {
        budget: budget,
        budgetDisplay: `${(budget/10000).toFixed(0)}만원`,
        riskPerTrade: budget * 0.02,
        riskDisplay: `${(budget * 0.02 / 10000).toFixed(0)}만원`
      },
      metadata: {
        requestedBy: 'make.com',
        analysisType: 'buy_signals_analysis',
        market: 'KRX',
        apiVersion: '3.0'
      }
    };

    // Add Slack message after result is fully initialized
    result.slackMessage = SlackMessageFormatter.formatBuySignals(result);
    
    // 분리된 카테고리별 응답 추가
    result.separatedCategories = SlackMessageFormatter.formatSeparateCategories(result);
    
    res.json(result);
    
  } catch (error) {
    console.error('BUY 신호 분석 실패:', error);
    
    res.status(200).json({
      success: false,
      error: 'BUY_ANALYSIS_FAILED',
      message: error.message || '알 수 없는 오류',
      timestamp: new Date().toISOString(),
      signalType: 'BUY',
      summary: {
        turtleBuySignals: 0,
        qualifiedSuperstocks: 0,
        premiumBuyOpportunities: 0,
        hasBuyOpportunity: false
      },
      buySignals: {
        turtle: [],
        superstocks: [],
        premium: []
      },
      metadata: {
        analysisType: 'buy_signals_analysis',
        market: 'KRX',
        apiVersion: '3.0',
        errorOccurred: true
      }
    });
  }
});

// Make.com SELL 신호 분석 API
router.post('/make-analysis/sell', async (req, res) => {
  try {
    const { apiKey } = req.body;
    
    // API 키 검증
    const validApiKey = process.env.MAKE_API_KEY || 'TtL_9K2m8X7nQ4pE6wR3vY5uI8oP1aSdF7gH9jK2mN5vB8xC3zE6rT9yU4iO7pL0';
    if (!apiKey || apiKey !== validApiKey) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Invalid API key'
      });
    }
    
    console.log('🔍 Make.com에서 SELL 신호 분석 요청');
    
    // 1. 키움 API에서 보유 종목 조회
    const KiwoomService = require('../services/kiwoomService');
    let accountData = null;
    let sellSignals = [];
    
    try {
      accountData = await KiwoomService.getAccountBalance();
      
      if (accountData && accountData.positions && accountData.positions.length > 0) {
        // 2. 보유 종목 각각에 대해 매도 신호 분석
        for (const position of accountData.positions) {
          try {
            console.log(`📊 매도 신호 분석: ${position.symbol} (${position.name})`);
            
            // 터틀 분석으로 매도 신호 확인
            const signal = await TurtleAnalyzer.analyzeStock(position.symbol, position.name);
            
            if (signal && signal.signalType?.includes('SELL')) {
              sellSignals.push({
                symbol: signal.symbol,
                name: signal.name,
                signalType: signal.signalType,
                currentPrice: signal.currentPrice,
                position: {
                  quantity: position.quantity,
                  avgPrice: position.avgPrice,
                  unrealizedPL: position.unrealizedPL
                },
                action: signal.recommendedAction?.action || 'SELL',
                reasoning: signal.recommendedAction?.reasoning || '',
                breakoutPrice: signal.breakoutPrice || null,
                lowPrice10D: signal.lowPrice10D || null
              });
            }
            
          } catch (error) {
            console.error(`${position.symbol} 매도 분석 실패:`, error);
          }
        }
      }
    } catch (accountError) {
      console.error('계좌 조회 실패:', accountError.message);
      
      // 슬랙 메시지 생성 및 전송
      const slackMessage = SlackMessageFormatter.formatDataFailure('SELL_ANALYSIS', accountError.message);
      
      // Make.com webhook으로 슬랙 전송 시도
      try {
        const axios = require('axios');
        const webhookUrl = process.env.MAKE_WEBHOOK_URL_TURTLE_NOTIFICATION;
        if (webhookUrl) {
          await axios.post(webhookUrl, {
            type: 'ERROR_NOTIFICATION',
            title: '매도 신호 분석 실패',
            message: slackMessage,
            timestamp: new Date().toISOString(),
            error: accountError.message
          });
          console.log('📤 슬랙 알림 전송 완료');
        } else {
          console.log('⚠️ Make.com webhook URL 미설정, 슬랙 전송 생략');
        }
      } catch (slackError) {
        console.error('❌ 슬랙 알림 전송 실패:', slackError.message);
      }
      
      return res.status(500).json({
        success: false,
        error: 'ACCOUNT_DATA_UNAVAILABLE',
        message: '계좌 데이터를 조회할 수 없습니다. 슬랙으로 상세 내용을 전송했습니다.',
        timestamp: new Date().toISOString(),
        details: accountError.message,
        slackMessage: slackMessage
      });
    }
    
    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      signalType: 'SELL',
      summary: {
        totalPositions: accountData?.positions?.length || 0,
        sellSignals: sellSignals.length,
        hasSellSignal: sellSignals.length > 0
      },
      sellSignals: sellSignals,
      accountInfo: accountData ? {
        totalAsset: accountData.totalAsset,
        cash: accountData.cash,
        positionCount: accountData.positions.length
      } : null,
      metadata: {
        requestedBy: 'make.com',
        analysisType: 'sell_signals_analysis',
        market: 'KRX',
        apiVersion: '3.0'
      },
      slackMessage: SlackMessageFormatter.formatSellSignals({
        timestamp: new Date().toISOString(),
        sellSignals: sellSignals,
        accountSummary: accountData ? {
          totalAsset: accountData.totalAsset,
          cash: accountData.cash,
          positionCount: accountData.positions.length
        } : {
          totalAsset: 0,
          cash: 0,
          positionCount: 0
        }
      })
    };
    
    res.json(result);
    
  } catch (error) {
    console.error('SELL 신호 분석 실패:', error);
    
    // 슬랙 메시지 생성 및 전송
    const slackMessage = SlackMessageFormatter.formatDataFailure('SELL_ANALYSIS', error.message);
    
    // Make.com webhook으로 슬랙 전송 시도
    try {
      const axios = require('axios');
      const webhookUrl = process.env.MAKE_WEBHOOK_URL_TURTLE_NOTIFICATION;
      if (webhookUrl) {
        await axios.post(webhookUrl, {
          type: 'ERROR_NOTIFICATION',
          title: '매도 신호 분석 실패',
          message: slackMessage,
          timestamp: new Date().toISOString(),
          error: error.message
        });
        console.log('📤 슬랙 알림 전송 완료');
      } else {
        console.log('⚠️ Make.com webhook URL 미설정, 슬랙 전송 생략');
      }
    } catch (slackError) {
      console.error('❌ 슬랙 알림 전송 실패:', slackError.message);
    }
    
    res.status(500).json({
      success: false,
      error: 'SELL_ANALYSIS_FAILED',
      message: error.message || '데이터 조회에 실패했습니다. 슬랙으로 상세 내용을 전송했습니다.',
      timestamp: new Date().toISOString(),
      signalType: 'SELL',
      details: '실제 계좌 데이터를 조회할 수 없어 분석을 중단했습니다.',
      slackMessage: slackMessage
    });
  }
});

// 기존 통합 API - 완전한 분석 복원
router.post('/make-analysis', async (req, res) => {
  try {
    const { apiKey, symbols, investmentBudget } = req.body;
    
    // API 키 검증
    const validApiKey = process.env.MAKE_API_KEY || 'TtL_9K2m8X7nQ4pE6wR3vY5uI8oP1aSdF7gH9jK2mN5vB8xC3zE6rT9yU4iO7pL0';
    if (!apiKey || apiKey !== validApiKey) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Invalid API key'
      });
    }
    
    // 투자 예산 설정 (기본값: 100만원)
    const budget = investmentBudget || 1000000;
    console.log(`🔍 Make.com에서 통합 분석 요청 (터틀 + 슈퍼스톡스) | 투자예산: ${(budget/10000).toFixed(0)}만원`);
    
    // 터틀 분석 로그 초기화
    global.turtleAnalysisLogs = [];
    global.investmentBudget = budget; // 전역 변수로 예산 설정
    
    // 터틀 분석 (오류 방어)
    let turtleSignals = [];
    try {
      turtleSignals = await TurtleAnalyzer.analyzeMarket() || [];
      console.log(`✅ 터틀 분석 완료: ${turtleSignals.length}개 신호`);
    } catch (turtleError) {
      console.error('❌ 터틀 분석 실패:', turtleError.message);
      turtleSignals = [];
    }
    
    // 슈퍼스톡스 분석 (하이브리드 방식: 캐시 + 키움 가격)
    let superstocks = [];
    try {
      console.log(`📊 하이브리드 슈퍼스톡스 분석 시작...`);
      
      // 1. 캐시에서 재무조건 만족 종목 조회 (실제 DART 데이터 우선)
      const financialCandidates = await FinancialData.find({
        dataYear: 2025,
        dataSource: { $in: ['DART', 'ESTIMATED'] }, // DART 데이터 우선, 없으면 추정치
        revenueGrowth3Y: { $gte: 15 },
        netIncomeGrowth3Y: { $gte: 15 },
        revenue: { $gt: 100 }
      }).sort({ 
        dataSource: 1, // DART가 먼저 오도록 (알파벳 순)
        revenueGrowth3Y: -1 
      }).limit(30); // 상위 30개

      console.log(`📋 재무조건 만족: ${financialCandidates.length}개 후보`);

      // 2. 키움 API로 가격 조회 (검증된 가격만)
      const StockPriceService = require('../services/stockPriceService');
      const stockCodes = financialCandidates.map(stock => stock.stockCode);
      const priceResult = await StockPriceService.getBulkPrices(stockCodes, false);

      // 3. 실제 가격이 있는 종목만 분석 (캐시된 회사명 사용)
      const StockNameCacheService = require('../services/stockNameCacheService');
      const nameMap = await StockNameCacheService.getBulkStockNames(stockCodes);

      for (const stock of financialCandidates) {
        const currentPrice = priceResult.prices.get(stock.stockCode);
        
        if (currentPrice && currentPrice > 1000) {
          // PSR 계산
          const marketCap = currentPrice * stock.sharesOutstanding;
          const revenueInWon = stock.revenue * 100000000;
          const psr = revenueInWon > 0 ? marketCap / revenueInWon : 999;

          // 캐시된 실제 회사명 사용
          const realStockName = nameMap.get(stock.stockCode) || `ST_${stock.stockCode}`;

          // PSR 조건 확인 (현실적 기준 2.5)
          if (psr <= 2.5) {
            superstocks.push({
              symbol: stock.stockCode,
              name: realStockName, // 실제 회사명 사용
              currentPrice: currentPrice,
              revenueGrowth3Y: stock.revenueGrowth3Y,
              netIncomeGrowth3Y: stock.netIncomeGrowth3Y,
              psr: Math.round(psr * 1000) / 1000,
              marketCap: marketCap,
              revenue: stock.revenue,
              netIncome: stock.netIncome,
              score: stock.revenueGrowth3Y >= 30 ? 'EXCELLENT' : 'GOOD',
              meetsConditions: true,
              dataSource: stock.dataSource === 'DART' ? 'DART_REALTIME' : 'HYBRID_CACHE_KIWOOM',
              timestamp: new Date().toISOString()
            });
          }
        }
      }

      console.log(`✅ 하이브리드 슈퍼스톡스 분석 완료: ${superstocks.length}개 결과`);
    } catch (superstocksError) {
      console.error('❌ 슈퍼스톡스 분석 실패:', superstocksError.message);
      superstocks = [];
    }
    
    // 두 조건 모두 만족하는 주식 찾기 (안전한 처리)
    const overlappingStocks = [];
    
    turtleSignals.forEach(turtle => {
      const superstock = superstocks.find(s => s.symbol === turtle.symbol);
      if (superstock && superstock.meetsConditions) {
        overlappingStocks.push({
          symbol: turtle.symbol,
          name: turtle.name,
          turtleSignal: turtle.signalType,
          superstocksScore: superstock.score,
          currentPrice: turtle.currentPrice,
          turtleAction: turtle.recommendedAction?.action || 'HOLD',
          superstocksData: {
            revenueGrowth3Y: superstock.revenueGrowth3Y,
            netIncomeGrowth3Y: superstock.netIncomeGrowth3Y,
            psr: superstock.psr
          },
          isPremiumOpportunity: true
        });
      }
    });
    
    // 안전한 응답 구조 생성
    const qualifiedSuperstocks = superstocks.filter(s => s && s.meetsConditions) || [];
    const totalSuperstocks = superstocks.filter(s => s !== null) || [];
    
    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        turtleSignals: turtleSignals.length || 0,
        qualifiedSuperstocks: qualifiedSuperstocks.length || 0,
        totalSuperstocksAnalyzed: totalSuperstocks.length || 0,
        overlappingStocks: overlappingStocks.length || 0,
        hasOverlap: overlappingStocks.length > 0,
        analysisStatus: {
          turtleSuccess: turtleSignals.length >= 0,
          superstocksSuccess: totalSuperstocks.length >= 0
        }
      },
      turtleTrading: {
        totalSignals: turtleSignals.length,
        buySignals: turtleSignals.filter(s => s.signalType?.includes('BUY')).length,
        sellSignals: turtleSignals.filter(s => s.signalType?.includes('SELL')).length,
        signals: turtleSignals.map(signal => ({
          symbol: signal.symbol,
          name: signal.name,
          signalType: signal.signalType,
          currentPrice: signal.currentPrice,
          action: signal.recommendedAction?.action || 'HOLD',
          reasoning: signal.recommendedAction?.reasoning || '',
          breakoutPrice: signal.breakoutPrice || null,
          highPrice20D: signal.highPrice20D || null,
          lowPrice10D: signal.lowPrice10D || null
        })),
        analysisLogs: (global.turtleAnalysisLogs || []).slice(0, 5) // 처음 5개 종목 분석 로그
      },
      superstocks: {
        analysisMethod: 'HYBRID_CACHE_KIWOOM',
        qualifiedCount: superstocks.length || 0,
        qualifiedStocks: superstocks.map(stock => ({
          symbol: stock.symbol,
          name: stock.name,
          currentPrice: stock.currentPrice,
          revenueGrowth3Y: stock.revenueGrowth3Y,
          netIncomeGrowth3Y: stock.netIncomeGrowth3Y,
          psr: stock.psr,
          score: stock.score,
          dataSource: stock.dataSource
        }))
      },
      premiumOpportunities: overlappingStocks,
      investmentSettings: {
        budget: budget,
        budgetDisplay: `${(budget/10000).toFixed(0)}만원`,
        riskPerTrade: budget * 0.02,
        riskDisplay: `${(budget * 0.02 / 10000).toFixed(0)}만원`
      },
      metadata: {
        requestedBy: 'make.com',
        analysisType: 'integrated_turtle_superstocks',
        market: 'KRX',
        apiVersion: '3.0'
      },
      slackMessage: SlackMessageFormatter.formatIntegratedAnalysis({
        timestamp: new Date().toISOString(),
        summary: {
          turtleSignals: turtleSignals.length,
          qualifiedSuperstocks: superstocks.filter(s => s.meetsConditions).length,
          overlappingStocks: overlappingStocks.length,
          hasOverlap: overlappingStocks.length > 0
        },
        turtleTrading: {
          signals: turtleSignals.map(signal => ({
            symbol: signal.symbol,
            name: signal.name,
            signalType: signal.signalType,
            currentPrice: signal.currentPrice,
            action: signal.recommendedAction?.action || 'HOLD',
            reasoning: signal.recommendedAction?.reasoning || ''
          }))
        },
        superstocks: {
          qualifiedStocks: superstocks.filter(s => s.meetsConditions).map(stock => ({
            symbol: stock.symbol,
            name: stock.name,
            currentPrice: stock.currentPrice,
            revenueGrowth3Y: stock.revenueGrowth3Y,
            netIncomeGrowth3Y: stock.netIncomeGrowth3Y,
            psr: stock.psr
          }))
        },
        premiumOpportunities: overlappingStocks,
        investmentSettings: {
          budget: budget,
          budgetDisplay: `${(budget/10000).toFixed(0)}만원`,
          riskPerTrade: budget * 0.02,
          riskDisplay: `${(budget * 0.02 / 10000).toFixed(0)}만원`
        }
      })
    };
    
    res.json(result);
    
  } catch (error) {
    console.error('통합 분석 실패:', error);
    
    // 안전한 오류 응답 (Make.com이 파싱할 수 있도록)
    res.status(200).json({
      success: false,
      error: 'INTEGRATED_ANALYSIS_FAILED',
      message: error.message || '알 수 없는 오류',
      timestamp: new Date().toISOString(),
      summary: {
        turtleSignals: 0,
        qualifiedSuperstocks: 0,
        totalSuperstocksAnalyzed: 0,
        overlappingStocks: 0,
        hasOverlap: false,
        analysisStatus: {
          turtleSuccess: false,
          superstocksSuccess: false
        }
      },
      turtleTrading: {
        totalSignals: 0,
        buySignals: 0,
        sellSignals: 0,
        signals: [],
        analysisLogs: []
      },
      superstocks: {
        totalAnalyzed: 0,
        successfullyAnalyzed: 0,
        qualifiedCount: 0,
        excellentStocks: 0,
        goodStocks: 0,
        qualifiedStocks: []
      },
      premiumOpportunities: [],
      metadata: {
        analysisType: 'integrated_turtle_superstocks',
        market: 'KRX',
        apiVersion: '3.0',
        errorOccurred: true
      },
      timestamp: new Date().toISOString()
    });
  }
});

// 상세 분석 결과 조회 API (디버깅용)
router.get('/analysis-details', async (req, res) => {
  try {
    console.log('🔍 상세 분석 결과 조회 요청');
    
    // 터틀 분석
    const turtleSignals = await TurtleAnalyzer.analyzeMarket();
    
    // 슈퍼스톡스 분석 (모든 결과 포함)
    const stockList = SuperstocksAnalyzer.getDefaultStockList();
    const allSuperstocks = await SuperstocksAnalyzer.analyzeSuperstocks(stockList);
    
    // 조건별 분류
    const qualifiedStocks = allSuperstocks.filter(s => s && s.meetsConditions);
    const failedAnalysis = stockList.filter(symbol => 
      !allSuperstocks.find(s => s && s.symbol === symbol)
    );
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      analysisDetails: {
        totalStocksToAnalyze: stockList.length,
        successfullyAnalyzed: allSuperstocks.filter(s => s).length,
        failedAnalysis: failedAnalysis.length,
        qualifiedStocks: qualifiedStocks.length,
        dartDataUsed: allSuperstocks.filter(s => s && s.dataSource === 'DART').length,
        simulationDataUsed: allSuperstocks.filter(s => s && s.dataSource === 'SIMULATION').length
      },
      stockResults: allSuperstocks.filter(s => s).map(stock => ({
        symbol: stock.symbol,
        name: stock.name,
        currentPrice: stock.currentPrice,
        revenueGrowth3Y: stock.revenueGrowth3Y,
        netIncomeGrowth3Y: stock.netIncomeGrowth3Y,
        psr: stock.psr,
        score: stock.score,
        meetsConditions: stock.meetsConditions,
        dataSource: stock.dataSource,
        revenue: stock.revenue,
        netIncome: stock.netIncome,
        marketCap: stock.marketCap,
        conditions: {
          revenueGrowthOK: stock.revenueGrowth3Y >= 15,
          netIncomeGrowthOK: stock.netIncomeGrowth3Y >= 15,
          psrOK: stock.psr <= 2.5
        }
      })),
      failedStocks: failedAnalysis,
      turtleSignals: turtleSignals,
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('상세 분석 조회 실패:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// MongoDB 분석 결과 저장
router.post('/save-analysis', async (req, res) => {
  try {
    const { analysisType, results } = req.body;
    
    const Signal = require('../models/Signal');
    
    // 기존 분석 결과 삭제 (최신 상태 유지)
    await Signal.deleteMany({ 
      signalType: analysisType,
      date: { $gte: new Date().setHours(0,0,0,0) } // 오늘 분석 결과만
    });
    
    // 새 분석 결과 저장
    for (const result of results) {
      const signal = new Signal({
        symbol: result.symbol,
        name: result.name,
        signalType: analysisType,
        currentPrice: result.currentPrice,
        confidence: result.score || 'medium',
        reasoning: JSON.stringify(result),
        metadata: {
          dataSource: result.dataSource,
          revenueGrowth3Y: result.revenueGrowth3Y,
          netIncomeGrowth3Y: result.netIncomeGrowth3Y,
          psr: result.psr
        },
        date: new Date(),
        timestamp: new Date().toISOString()
      });
      
      await signal.save();
    }
    
    res.json({
      success: true,
      message: `${results.length}개 분석 결과 저장 완료`,
      analysisType: analysisType,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('분석 결과 저장 실패:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// MongoDB 저장된 분석 결과 조회
router.get('/saved-analysis/:type?', async (req, res) => {
  try {
    const analysisType = req.params.type;
    const limit = parseInt(req.query.limit) || 100;
    
    const Signal = require('../models/Signal');
    
    let query = {};
    if (analysisType) {
      query.signalType = analysisType;
    }
    
    const savedResults = await Signal.find(query)
      .sort({ date: -1 })
      .limit(limit);
    
    res.json({
      success: true,
      total: savedResults.length,
      results: savedResults,
      lastUpdated: savedResults[0]?.date || null,
      message: `${savedResults.length}개 저장된 분석 결과`
    });
    
  } catch (error) {
    console.error('저장된 분석 조회 실패:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// 단일 종목 테스트 API (디버깅용)
router.get('/test-stock/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    console.log(`🧪 ${symbol} 단일 종목 테스트 시작`);
    
    // 1. 키움 API 연결 상태 확인
    const kiwoomConnected = require('../services/kiwoomService').isConnectedToKiwoom();
    
    // 2. 현재가 조회 테스트
    let currentPrice = null;
    let priceError = null;
    try {
      currentPrice = await require('../services/kiwoomService').getCurrentPrice(symbol);
    } catch (error) {
      priceError = error.message;
    }
    
    // 3. DART API 테스트
    let dartData = null;
    let dartError = null;
    try {
      dartData = await require('../services/dartService').analyzeStockFinancials(symbol);
    } catch (error) {
      dartError = error.message;
    }
    
    // 4. 슈퍼스톡스 분석 테스트
    let superstockResult = null;
    let analysisError = null;
    try {
      superstockResult = await SuperstocksAnalyzer.analyzeStock(symbol);
    } catch (error) {
      analysisError = error.message;
    }
    
    res.json({
      success: true,
      symbol: symbol,
      testResults: {
        kiwoomConnected: kiwoomConnected,
        currentPrice: currentPrice,
        priceError: priceError,
        dartData: dartData,
        dartError: dartError,
        superstockResult: superstockResult,
        analysisError: analysisError
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`${req.params.symbol} 테스트 실패:`, error);
    res.status(500).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// DART API 연결 테스트
router.get('/test-dart', async (req, res) => {
  try {
    const DartService = require('../services/dartService');
    
    console.log('🧪 DART API 연결 테스트');
    
    // 삼성전자로 테스트
    const testResult = await DartService.analyzeStockFinancials('005930');
    
    res.json({
      success: true,
      dartApiKey: !!process.env.DART_API_KEY,
      testSymbol: '005930',
      result: testResult,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('DART API 테스트 실패:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      dartApiKey: !!process.env.DART_API_KEY,
      timestamp: new Date().toISOString()
    });
  }
});

// Yahoo Finance 연결 테스트
router.get('/test-yahoo', async (req, res) => {
  try {
    const YahooFinanceService = require('../services/yahooFinanceService');
    
    console.log('🧪 Yahoo Finance 연결 테스트');
    
    // 삼성전자로 테스트
    const testResult = await YahooFinanceService.testConnection('005930');
    
    res.json({
      success: testResult.success,
      testSymbol: '005930',
      result: testResult,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Yahoo Finance 테스트 실패:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 매도 신호 분석 API (보유 종목 대상)
router.post('/sell-analysis', async (req, res) => {
  try {
    const { apiKey } = req.body;
    
    // API 키 검증
    const validApiKey = process.env.MAKE_API_KEY || 'TtL_9K2m8X7nQ4pE6wR3vY5uI8oP1aSdF7gH9jK2mN5vB8xC3zE6rT9yU4iO7pL0';
    if (!apiKey || apiKey !== validApiKey) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Invalid API key'
      });
    }
    
    console.log('🔍 Make.com에서 매도 신호 분석 요청');
    
    // 1. 키움 API에서 보유 종목 조회
    const KiwoomService = require('../services/kiwoomService');
    const accountData = await KiwoomService.getAccountBalance();
    
    if (!accountData || !accountData.positions || accountData.positions.length === 0) {
      // 슬랙 메시지 생성 및 전송
      const slackMessage = SlackMessageFormatter.formatDataFailure('SELL_ANALYSIS', '보유 종목이 없거나 조회할 수 없습니다.');
      
      // Make.com webhook으로 슬랙 전송 시도
      try {
        const axios = require('axios');
        const webhookUrl = process.env.MAKE_WEBHOOK_URL_TURTLE_NOTIFICATION;
        if (webhookUrl) {
          await axios.post(webhookUrl, {
            type: 'ERROR_NOTIFICATION',
            title: '매도 신호 분석 실패 - 보유 종목 없음',
            message: slackMessage,
            timestamp: new Date().toISOString(),
            error: '보유 종목 데이터 없음'
          });
          console.log('📤 슬랙 알림 전송 완료');
        } else {
          console.log('⚠️ Make.com webhook URL 미설정, 슬랙 전송 생략');
        }
      } catch (slackError) {
        console.error('❌ 슬랙 알림 전송 실패:', slackError.message);
      }
      
      return res.status(404).json({
        success: false,
        error: 'NO_POSITIONS_FOUND',
        message: '보유 종목 데이터를 조회할 수 없거나 보유 종목이 없습니다. 슬랙으로 상세 내용을 전송했습니다.',
        timestamp: new Date().toISOString(),
        details: '실제 계좌 데이터가 필요합니다.',
        slackMessage: slackMessage
      });
    }
    
    // 2. 보유 종목 각각에 대해 매도 신호 분석
    const sellSignals = [];
    const positionAnalysis = [];
    
    for (const position of accountData.positions) {
      try {
        console.log(`📊 매도 신호 분석: ${position.symbol} (${position.name})`);
        
        // 터틀 분석으로 매도 신호 확인
        const signal = await TurtleAnalyzer.analyzeStock(position.symbol, position.name);
        
        if (signal) {
          // 매도 조건 확인
          const sellConditions = await TurtleAnalyzer.checkSellConditions(signal, position);
          
          if (sellConditions.shouldSell) {
            sellSignals.push({
              ...signal,
              position: position,
              sellReason: sellConditions.reason,
              urgency: sellConditions.urgency
            });
          }
          
          positionAnalysis.push({
            symbol: position.symbol,
            name: position.name,
            quantity: position.quantity,
            avgPrice: position.avgPrice,
            currentPrice: position.currentPrice,
            unrealizedPL: position.unrealizedPL,
            sellConditions: sellConditions
          });
        }
        
      } catch (error) {
        console.error(`${position.symbol} 매도 분석 실패:`, error);
      }
    }
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      sellAnalysis: {
        totalPositions: accountData.positions.length,
        sellSignals: sellSignals.length,
        urgentSells: sellSignals.filter(s => s.urgency === 'HIGH').length,
        stopLossSells: sellSignals.filter(s => s.sellReason.includes('손절')).length
      },
      sellSignals: sellSignals,
      positionAnalysis: positionAnalysis,
      accountSummary: {
        totalAsset: accountData.totalAsset,
        cash: accountData.cash,
        positionCount: accountData.positions.length
      },
      metadata: {
        requestedBy: 'make.com',
        analysisType: 'sell_signals',
        market: 'KRX',
        apiVersion: '1.0'
      },
      slackMessage: SlackMessageFormatter.formatSellSignals({
        timestamp: new Date().toISOString(),
        sellSignals: sellSignals,
        accountSummary: {
          totalAsset: accountData.totalAsset,
          cash: accountData.cash,
          positionCount: accountData.positions.length
        }
      })
    });
    
  } catch (error) {
    console.error('매도 신호 분석 실패:', error);
    
    // 슬랙 메시지 생성 및 전송
    const slackMessage = SlackMessageFormatter.formatDataFailure('SELL_ANALYSIS', error.message);
    
    // Make.com webhook으로 슬랙 전송 시도
    try {
      const axios = require('axios');
      const webhookUrl = process.env.MAKE_WEBHOOK_URL_TURTLE_NOTIFICATION;
      if (webhookUrl) {
        await axios.post(webhookUrl, {
          type: 'ERROR_NOTIFICATION',
          title: '매도 신호 분석 실패',
          message: slackMessage,
          timestamp: new Date().toISOString(),
          error: error.message
        });
        console.log('📤 슬랙 알림 전송 완료');
      } else {
        console.log('⚠️ Make.com webhook URL 미설정, 슬랙 전송 생략');
      }
    } catch (slackError) {
      console.error('❌ 슬랙 알림 전송 실패:', slackError.message);
    }
    
    res.status(500).json({
      success: false,
      error: 'SELL_ANALYSIS_FAILED',
      message: error.message || '매도 신호 분석 중 데이터 조회 실패했습니다. 슬랙으로 상세 내용을 전송했습니다.',
      timestamp: new Date().toISOString(),
      details: '실제 계좌 및 시장 데이터를 조회할 수 없어 분석을 중단했습니다.',
      slackMessage: slackMessage
    });
  }
});

// 현재 보유 종목의 N값(ATR) 조회 API
router.get('/portfolio-n-values', async (req, res) => {
  try {
    const { apiKey } = req.query;
    
    // API 키 검증
    const validApiKey = process.env.MAKE_API_KEY || 'TtL_9K2m8X7nQ4pE6wR3vY5uI8oP1aSdF7gH9jK2mN5vB8xC3zE6rT9yU4iO7pL0';
    if (!apiKey || apiKey !== validApiKey) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Invalid API key'
      });
    }
    
    console.log('📊 보유 종목 N값(ATR) 조회 요청');
    
    // 키움 API에서 보유 종목 조회
    const KiwoomService = require('../services/kiwoomService');
    let accountData = null;
    let portfolioNValues = [];
    
    try {
      accountData = await KiwoomService.getAccountBalance();
      
      if (accountData && accountData.positions && accountData.positions.length > 0) {
        // 각 보유 종목의 N값(ATR) 계산
        for (const position of accountData.positions) {
          try {
            console.log(`📈 ${position.symbol} (${position.name}) N값 계산 중...`);
            
            // ETF 종목 제외 (터틀 트레이딩에 적합하지 않음)
            const isETF = isETFStock(position.symbol, position.name);
            if (isETF) {
              console.log(`📊 ${position.symbol} (${position.name}): ETF 종목으로 N값 계산 제외`);
              
              portfolioNValues.push({
                symbol: position.symbol,
                name: position.name,
                currentPrice: position.currentPrice,
                avgPrice: position.avgPrice,
                quantity: position.quantity,
                marketValue: position.currentPrice * position.quantity,
                unrealizedPL: position.unrealizedPL || 0,
                unrealizedPLPercent: position.avgPrice > 0 ? 
                  ((position.currentPrice - position.avgPrice) / position.avgPrice) * 100 : 0,
                nValue: null,
                twoN: null,
                stopLossPrice: null,
                low10: null,
                riskAmount: 0,
                riskPercent: 0,
                isNearStopLoss: false,
                isNearSellSignal: false,
                priceFromStopLoss: null,
                priceFromLow10: null,
                dataStatus: 'ETF_EXCLUDED',
                excludeReason: 'ETF 종목은 터틀 트레이딩 분석에서 제외됩니다.'
              });
              
              continue; // 다음 종목으로
            }
            
            // 실제 데이터만 사용 (시뮬레이션 데이터 제외)
            let priceData = null;
            try {
              // TurtleAnalyzer의 getPriceData 사용 (시뮬레이션 데이터 필터링됨)
              priceData = await TurtleAnalyzer.getPriceData(position.symbol, 25);
              
              // 추가 검증: 시뮬레이션 데이터 감지
              if (priceData && priceData.length > 0) {
                const isSimulation = TurtleAnalyzer.detectSimulationData(priceData, position.symbol);
                if (isSimulation) {
                  console.log(`⚠️ ${position.symbol}: 시뮬레이션 데이터 감지, 실제 데이터 없음`);
                  priceData = [];
                }
              }
            } catch (priceError) {
              console.error(`❌ ${position.symbol} 가격 조회 실패: ${priceError.message}`);
              priceData = null;
            }
            
            if (priceData && priceData.length >= 21) {
              const atr = TurtleAnalyzer.calculateATR(priceData.slice(0, 21));
              // ATR이 null인 경우 에러 반환, 시뮬레이션 값 사용 안함
              if (!atr || atr <= 0) {
                throw new Error(`${position.name} (${position.symbol}) ATR 계산 결과가 유효하지 않습니다.`);
              }
              
              // 10일 최저가 계산 (터틀 트레이딩 매도 신호용)
              // KiwoomService에서 이미 최신순으로 정렬되어 옴
              const lows = priceData.map(d => d.low);
              
              console.log(`🔍 ${position.symbol} 최신 5일 가격 데이터:`, priceData.slice(0, 5).map(d => ({ date: d.date, close: d.close, low: d.low })));
              
              // 전일부터 10일간의 최저가 (오늘 제외, 최근 10일)
              const low10Array = lows.slice(1, 11); // 1번째~10번째 = 전일부터 10일
              const low10 = lows.length >= 11 ? Math.min(...low10Array) : null; 
              
              console.log(`📉 ${position.symbol} 10일 최저가 배열 (전일부터 10일):`, low10Array);
              console.log(`📉 ${position.symbol} 10일 최저가 계산: ${low10}원, 현재가: ${position.currentPrice}원`);
              
              const nValue = Math.round(atr);
              const twoN = nValue * 2;
              const stopLossPrice = position.avgPrice - twoN;
              const riskAmount = position.quantity * twoN;
              
              // 현재 손익률 계산
              const unrealizedPL = position.unrealizedPL || 0;
              const unrealizedPLPercent = position.avgPrice > 0 ? 
                ((position.currentPrice - position.avgPrice) / position.avgPrice) * 100 : 0;
              
              portfolioNValues.push({
                symbol: position.symbol,
                name: position.name,
                currentPrice: position.currentPrice,
                avgPrice: position.avgPrice,
                quantity: position.quantity,
                marketValue: position.currentPrice * position.quantity,
                unrealizedPL: unrealizedPL,
                unrealizedPLPercent: Math.round(unrealizedPLPercent * 100) / 100,
                nValue: nValue,                    // N값 (ATR)
                twoN: twoN,                       // 2N (손절 거리)
                stopLossPrice: Math.round(stopLossPrice),  // 터틀 손절가
                low10: low10 ? Math.round(low10) : null,   // 10일 최저가 (터틀 매도 신호)
                riskAmount: Math.round(riskAmount),        // 종목별 리스크 금액
                riskPercent: position.avgPrice > 0 ? Math.round((twoN / position.avgPrice) * 10000) / 100 : 0, // 리스크 퍼센트
                isNearStopLoss: position.currentPrice <= stopLossPrice, // 손절가 근접 여부
                isNearSellSignal: low10 ? position.currentPrice <= low10 : false, // 10일 최저가 매도 신호 근접
                priceFromStopLoss: position.currentPrice - stopLossPrice, // 손절가와의 거리
                priceFromLow10: low10 ? position.currentPrice - low10 : null, // 10일 최저가와의 거리
                dataStatus: 'REAL_DATA' // 실제 데이터 사용
              });
              
            } else {
              // 가격 조회 실패시 에러 반환, 시뮬레이션 데이터 사용 안함
              console.error(`❌ ${position.symbol} (${position.name}) 가격 데이터 조회 실패`);
              throw new Error(`${position.name} (${position.symbol}) 가격 데이터를 조회할 수 없습니다. N값 계산이 불가능합니다.`);
            }
            
          } catch (error) {
            console.error(`❌ ${position.symbol} N값 계산 실패:`, error.message);
            // 에러 발생시 전체 분석 중단, 시뮬레이션 데이터 사용 안함
            throw new Error(`${position.name} (${position.symbol}) N값 계산 중 오류가 발생했습니다: ${error.message}`);
          }
        }
      }
    } catch (accountError) {
      console.error('❌ 계좌 조회 실패:', accountError.message);
      
      // 슬랙 메시지 생성 및 전송
      const slackMessage = SlackMessageFormatter.formatDataFailure('PORTFOLIO_N_VALUES', accountError.message);
      
      // Make.com webhook으로 슬랙 전송 시도
      try {
        const axios = require('axios');
        const webhookUrl = process.env.MAKE_WEBHOOK_URL_TURTLE_NOTIFICATION;
        if (webhookUrl) {
          await axios.post(webhookUrl, {
            type: 'ERROR_NOTIFICATION',
            title: '포트폴리오 N값 분석 실패',
            message: slackMessage,
            timestamp: new Date().toISOString(),
            error: accountError.message
          });
          console.log('📤 슬랙 알림 전송 완료');
        } else {
          console.log('⚠️ Make.com webhook URL 미설정, 슬랙 전송 생략');
        }
      } catch (slackError) {
        console.error('❌ 슬랙 알림 전송 실패:', slackError.message);
      }
      
      return res.status(500).json({
        success: false,
        error: 'PORTFOLIO_DATA_UNAVAILABLE',
        message: '계좌 데이터 또는 가격 정보를 조회할 수 없습니다. 슬랙으로 상세 내용을 전송했습니다.',
        timestamp: new Date().toISOString(),
        details: accountError.message,
        slackMessage: slackMessage
      });
    }
    
    // 포트폴리오 전체 리스크 분석
    const totalMarketValue = portfolioNValues.reduce((sum, p) => sum + p.marketValue, 0);
    const totalRiskAmount = portfolioNValues.reduce((sum, p) => sum + p.riskAmount, 0);
    const portfolioRiskPercent = totalMarketValue > 0 ? (totalRiskAmount / totalMarketValue) * 100 : 0;
    const nearStopLossCount = portfolioNValues.filter(p => p.isNearStopLoss).length;
    
    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        totalPositions: portfolioNValues.length,
        totalMarketValue: totalMarketValue,
        totalRiskAmount: totalRiskAmount,
        portfolioRiskPercent: Math.round(portfolioRiskPercent * 100) / 100,
        nearStopLossCount: nearStopLossCount,
        averageNValue: portfolioNValues.length > 0 ? 
          Math.round(portfolioNValues.reduce((sum, p) => sum + p.nValue, 0) / portfolioNValues.length) : 0
      },
      positions: portfolioNValues.sort((a, b) => b.marketValue - a.marketValue), // 시가총액 순 정렬
      accountInfo: accountData ? {
        totalAsset: accountData.totalAsset,
        cash: accountData.cash,
        positionCount: accountData.positions.length
      } : null,
      metadata: {
        requestedBy: 'api_client',
        analysisType: 'portfolio_n_values',
        market: 'KRX',
        apiVersion: '1.0'
      }
    };
    
    // 슬랙 메시지 추가
    result.slackMessage = SlackMessageFormatter.formatPortfolioNValues(result);
    
    console.log(`✅ 포트폴리오 N값 분석 완료: ${portfolioNValues.length}개 종목, 평균 N값: ${result.summary.averageNValue}원`);
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ 포트폴리오 N값 분석 실패:', error);
    
    // 슬랙 메시지 생성 및 전송
    const slackMessage = SlackMessageFormatter.formatDataFailure('PORTFOLIO_N_VALUES', error.message);
    
    // Make.com webhook으로 슬랙 전송 시도
    try {
      const axios = require('axios');
      const webhookUrl = process.env.MAKE_WEBHOOK_URL_TURTLE_NOTIFICATION;
      if (webhookUrl) {
        await axios.post(webhookUrl, {
          type: 'ERROR_NOTIFICATION',
          title: '포트폴리오 N값 분석 실패',
          message: slackMessage,
          timestamp: new Date().toISOString(),
          error: error.message
        });
        console.log('📤 슬랙 알림 전송 완료');
      } else {
        console.log('⚠️ Make.com webhook URL 미설정, 슬랙 전송 생략');
      }
    } catch (slackError) {
      console.error('❌ 슬랙 알림 전송 실패:', slackError.message);
    }
    
    res.status(500).json({
      success: false,
      error: 'PORTFOLIO_N_VALUES_FAILED',
      message: error.message || '포트폴리오 데이터를 조회할 수 없습니다. 슬랙으로 상세 내용을 전송했습니다.',
      timestamp: new Date().toISOString(),
      details: '실제 계좌 및 가격 데이터를 조회할 수 없어 N값 계산을 중단했습니다.',
      slackMessage: slackMessage
    });
  }
});

// Make.com 웹훅 수신용 엔드포인트
router.post('/webhook', async (req, res) => {
  try {
    const webhookData = req.body;
    console.log('📨 Make.com 웹훅 수신:', webhookData);
    
    // 웹훅 데이터 처리 (예: 알림, 로깅 등)
    
    res.json({
      success: true,
      message: 'Webhook received successfully',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('웹훅 처리 실패:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

module.exports = router;