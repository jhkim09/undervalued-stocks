const express = require('express');
const router = express.Router();
const FinancialDataCacheService = require('../services/financialDataCacheService');
const SuperstocksAnalyzer = require('../services/superstocksAnalyzer');

// 캐시 통계 조회
router.get('/cache/stats', async (req, res) => {
  try {
    const stats = await FinancialDataCacheService.getCacheStatistics();
    res.json({
      success: true,
      cacheStats: stats,
      message: '재무데이터 캐시 통계 조회 완료'
    });
  } catch (error) {
    console.error('캐시 통계 조회 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 특정 종목 재무데이터 조회
router.get('/stock/:stockCode', async (req, res) => {
  try {
    const { stockCode } = req.params;
    
    const financialData = await FinancialDataCacheService.getCachedFinancialData(stockCode);
    
    if (!financialData) {
      return res.status(404).json({
        success: false,
        message: `${stockCode} 재무데이터를 찾을 수 없습니다`
      });
    }
    
    res.json({
      success: true,
      stockCode: stockCode,
      financialData: financialData,
      message: '재무데이터 조회 완료'
    });
    
  } catch (error) {
    console.error('재무데이터 조회 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 통합 500개 종목 재무데이터 일괄 수집
router.post('/bulk/unified', async (req, res) => {
  try {
    console.log('🚀 통합 500개 종목 재무데이터 일괄 수집 시작...');
    
    const StockListService = require('../services/stockListService');
    const stockCodes = StockListService.getUnifiedStockList();
    const stats = StockListService.getStatistics();
    
    console.log(`📊 대상 종목: ${stats.total}개 (코스피 ${stats.kospi}개 + 코스닥 ${stats.kosdaq}개)`);
    
    const results = await FinancialDataCacheService.bulkCollectFinancialData(
      stockCodes, 
      req.body.batchSize || 8 // 500개라서 배치 크기 줄임
    );
    
    res.json({
      success: true,
      results: results,
      stockListStats: stats,
      message: `통합 종목 재무데이터 일괄 수집 완료: ${results.success}개 성공, ${results.failed}개 실패`
    });
    
  } catch (error) {
    console.error('통합 일괄 수집 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 슈퍼스톡스 100개 종목 재무데이터 일괄 수집 (기존 호환성)
router.post('/bulk/superstocks', async (req, res) => {
  try {
    console.log('🚀 슈퍼스톡스 종목 재무데이터 일괄 수집 시작...');
    
    // 슈퍼스톡스 분석 대상 종목 리스트 (이제 500개)
    const stockCodes = SuperstocksAnalyzer.getDefaultStockList();
    
    const results = await FinancialDataCacheService.bulkCollectFinancialData(
      stockCodes, 
      req.body.batchSize || 8
    );
    
    res.json({
      success: true,
      results: results,
      message: `슈퍼스톡스 재무데이터 일괄 수집 완료: ${results.success}개 성공, ${results.failed}개 실패`
    });
    
  } catch (error) {
    console.error('일괄 수집 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 커스텀 종목 리스트 재무데이터 일괄 수집
router.post('/bulk/custom', async (req, res) => {
  try {
    const { stockCodes, batchSize = 10 } = req.body;
    
    if (!stockCodes || !Array.isArray(stockCodes)) {
      return res.status(400).json({
        success: false,
        message: 'stockCodes 배열이 필요합니다'
      });
    }
    
    console.log(`🚀 커스텀 ${stockCodes.length}개 종목 재무데이터 일괄 수집 시작...`);
    
    const results = await FinancialDataCacheService.bulkCollectFinancialData(
      stockCodes, 
      batchSize
    );
    
    res.json({
      success: true,
      results: results,
      message: `재무데이터 일괄 수집 완료: ${results.success}개 성공, ${results.failed}개 실패`
    });
    
  } catch (error) {
    console.error('커스텀 일괄 수집 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 오래된 캐시 데이터 정리
router.delete('/cache/cleanup', async (req, res) => {
  try {
    const { keepYears = 2 } = req.query;
    
    const deletedCount = await FinancialDataCacheService.cleanupOldCache(parseInt(keepYears));
    
    res.json({
      success: true,
      deletedCount: deletedCount,
      message: `${deletedCount}개 오래된 재무데이터 정리 완료`
    });
    
  } catch (error) {
    console.error('캐시 정리 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 재무데이터 년도 업데이트 체크 (4월 1일 이후 실행)
router.post('/update-year-check', async (req, res) => {
  try {
    const updated = FinancialDataCacheService.checkDataYearUpdate();
    
    res.json({
      success: true,
      yearUpdated: updated,
      currentTargetYear: FinancialDataCacheService.targetYear,
      message: updated ? '재무데이터 대상년도 업데이트됨' : '재무데이터 대상년도 변경 없음'
    });
    
  } catch (error) {
    console.error('년도 업데이트 체크 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;