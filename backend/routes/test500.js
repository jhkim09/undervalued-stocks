const express = require('express');
const router = express.Router();
const StockListService = require('../services/stockListService');
const FinancialDataCacheService = require('../services/financialDataCacheService');
const SuperstocksAnalyzer = require('../services/superstocksAnalyzer');
const TurtleAnalyzer = require('../services/turtleAnalyzer');

// 500개 종목 시스템 전체 테스트
router.get('/system-health', async (req, res) => {
  try {
    console.log('🧪 500개 종목 통합 시스템 헬스체크 시작...');
    
    const results = {
      timestamp: new Date().toISOString(),
      systemStatus: 'TESTING',
      stockList: {},
      financialCache: {},
      apiConnections: {},
      errors: []
    };
    
    // 1. 통합 종목 리스트 상태
    try {
      const stats = StockListService.getStatistics();
      results.stockList = {
        ...stats,
        status: 'OK'
      };
      console.log(`✅ 통합 종목 리스트: ${stats.total}개 (코스피 ${stats.kospi} + 코스닥 ${stats.kosdaq})`);
    } catch (error) {
      results.errors.push(`종목 리스트 오류: ${error.message}`);
      results.stockList.status = 'ERROR';
    }
    
    // 2. 재무데이터 캐시 상태
    try {
      const cacheStats = await FinancialDataCacheService.getCacheStatistics();
      results.financialCache = {
        cacheEntries: cacheStats,
        status: cacheStats.length > 0 ? 'OK' : 'EMPTY'
      };
      console.log(`📊 재무데이터 캐시: ${cacheStats.length}개 년도별 엔트리`);
    } catch (error) {
      results.errors.push(`캐시 상태 오류: ${error.message}`);
      results.financialCache.status = 'ERROR';
    }
    
    // 3. API 연결 상태 (샘플 5개 종목)
    const testStocks = ['005930', '000660', '035420', '251270', '042700'];
    const apiTests = [];
    
    for (const stock of testStocks) {
      const test = { stockCode: stock, tests: {} };
      
      // 재무데이터 캐시 테스트
      try {
        const cached = await FinancialDataCacheService.getCachedFinancialData(stock);
        test.tests.financialCache = cached ? 'OK' : 'EMPTY';
      } catch (error) {
        test.tests.financialCache = 'ERROR';
        results.errors.push(`${stock} 재무캐시 오류: ${error.message}`);
      }
      
      apiTests.push(test);
    }
    
    results.apiConnections = {
      sampleTests: apiTests,
      status: results.errors.length === 0 ? 'OK' : 'PARTIAL'
    };
    
    // 4. 전체 시스템 상태 판정
    if (results.errors.length === 0) {
      results.systemStatus = 'HEALTHY';
    } else if (results.errors.length < 3) {
      results.systemStatus = 'DEGRADED';
    } else {
      results.systemStatus = 'UNHEALTHY';
    }
    
    console.log(`🏁 500개 종목 시스템 헬스체크 완료: ${results.systemStatus}`);
    
    res.json({
      success: true,
      healthCheck: results,
      message: `시스템 상태: ${results.systemStatus}, 오류: ${results.errors.length}개`
    });
    
  } catch (error) {
    console.error('시스템 헬스체크 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '시스템 헬스체크 중 오류 발생'
    });
  }
});

// 500개 종목 재무데이터 수집 성능 테스트
router.post('/bulk-collection-test', async (req, res) => {
  try {
    console.log('🚀 500개 종목 재무데이터 수집 성능 테스트 시작...');
    
    const { 
      testMode = true,  // 테스트 모드 (실제 수집 안함)
      sampleSize = 10,  // 테스트할 샘플 크기
      batchSize = 5     // 배치 크기
    } = req.body;
    
    const stockCodes = StockListService.getUnifiedStockList();
    
    if (testMode) {
      // 테스트 모드: 샘플만 수집
      const sampleStocks = stockCodes.slice(0, sampleSize);
      console.log(`🧪 테스트 모드: ${sampleStocks.length}개 샘플 종목으로 테스트`);
      
      const startTime = Date.now();
      const results = await FinancialDataCacheService.bulkCollectFinancialData(sampleStocks, batchSize);
      const endTime = Date.now();
      
      const duration = endTime - startTime;
      const estimatedFullTime = (duration / sampleStocks.length) * stockCodes.length;
      
      res.json({
        success: true,
        testResults: results,
        performance: {
          sampleSize: sampleStocks.length,
          duration: `${(duration / 1000).toFixed(1)}초`,
          estimatedFullCollection: `${(estimatedFullTime / 1000 / 60).toFixed(1)}분`,
          totalStocks: stockCodes.length
        },
        message: `테스트 완료: ${sampleStocks.length}개 샘플에서 ${results.success}개 성공`
      });
      
    } else {
      // 실제 모드: 전체 500개 수집
      console.log('🔥 실제 모드: 500개 전체 종목 수집 (주의: 시간 소요)');
      
      const startTime = Date.now();
      const results = await FinancialDataCacheService.bulkCollectFinancialData(stockCodes, batchSize);
      const endTime = Date.now();
      
      res.json({
        success: true,
        fullResults: results,
        performance: {
          totalStocks: stockCodes.length,
          duration: `${((endTime - startTime) / 1000 / 60).toFixed(1)}분`,
          successRate: `${(results.success / results.total * 100).toFixed(1)}%`
        },
        message: `전체 수집 완료: ${results.success}개 성공, ${results.failed}개 실패`
      });
    }
    
  } catch (error) {
    console.error('성능 테스트 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '성능 테스트 중 오류 발생'
    });
  }
});

// 재무데이터 기반 종목 분석 통계
router.get('/financial-analysis-stats', async (req, res) => {
  try {
    console.log('📊 재무데이터 기반 종목 분석 통계 생성...');
    
    const stockCodes = StockListService.getUnifiedStockList();
    const sampleSize = Math.min(50, stockCodes.length); // 최대 50개 샘플
    const sampleStocks = stockCodes.slice(0, sampleSize);
    
    const stats = {
      total: sampleStocks.length,
      withFinancialData: 0,
      superstocksQualified: 0,
      turtleFinancialQualified: 0,
      averagePSR: 0,
      averageRevenueGrowth: 0,
      dataSourceBreakdown: {},
      errors: []
    };
    
    let psrSum = 0;
    let revenueGrowthSum = 0;
    let validDataCount = 0;
    
    for (const stockCode of sampleStocks) {
      try {
        const financial = await FinancialDataCacheService.getCachedFinancialData(stockCode);
        
        if (financial) {
          stats.withFinancialData++;
          
          // 통계 계산
          if (financial.revenueGrowth3Y) {
            revenueGrowthSum += financial.revenueGrowth3Y;
            validDataCount++;
          }
          
          // 데이터 소스 분류
          const source = financial.dataSource || 'UNKNOWN';
          stats.dataSourceBreakdown[source] = (stats.dataSourceBreakdown[source] || 0) + 1;
          
          // 슈퍼스톡스 조건 체크 (PSR은 현재가 필요하므로 스키핑)
          if (financial.revenueGrowth3Y >= 15 && financial.netIncomeGrowth3Y >= 15) {
            stats.superstocksQualified++;
          }
          
          // 터틀 재무 필터 체크
          if (financial.revenueGrowth3Y >= 10) {
            stats.turtleFinancialQualified++;
          }
        }
        
      } catch (error) {
        stats.errors.push(`${stockCode}: ${error.message}`);
      }
    }
    
    stats.averageRevenueGrowth = validDataCount > 0 ? (revenueGrowthSum / validDataCount).toFixed(1) : 0;
    
    res.json({
      success: true,
      analysisStats: stats,
      message: `${sampleSize}개 샘플 분석 완료: ${stats.withFinancialData}개 재무데이터 보유`
    });
    
  } catch (error) {
    console.error('분석 통계 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;