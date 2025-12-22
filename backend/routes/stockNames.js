/**
 * 종목명 관리 API 엔드포인트
 * 전체 상장사 데이터 수집 및 업데이트용
 */

const express = require('express');
const router = express.Router();
const StockNameCacheService = require('../services/stockNameCacheService');

// 전체 상장사 데이터 업데이트 (DART API 사용) - 백그라운드 처리
router.post('/update-all', async (req, res) => {
  try {
    console.log('🚀 전체 상장사 데이터 업데이트 API 호출 (백그라운드)...');
    
    // 즉시 응답 (타임아웃 방지)
    res.json({
      success: true,
      message: '전체 상장사 데이터 업데이트 시작됨 (백그라운드 처리)',
      note: 'GET /api/stock-names/status로 진행률 확인 가능',
      timestamp: new Date().toISOString()
    });

    // 백그라운드에서 실행
    setTimeout(async () => {
      try {
        const result = await StockNameCacheService.updateAllListedCompanies();
        console.log('✅ 백그라운드 업데이트 완료:', result);
      } catch (error) {
        console.error('❌ 백그라운드 업데이트 실패:', error.message);
      }
    }, 100);

  } catch (error) {
    console.error('❌ 전체 상장사 데이터 업데이트 API 실패:', error);
    
    res.status(500).json({
      success: false,
      message: '전체 상장사 데이터 업데이트 시작 실패',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 배치 업데이트 (작은 단위로 처리)
router.post('/update-batch', async (req, res) => {
  try {
    const { batchSize = 200, startIndex = 0 } = req.body;
    
    console.log(`🚀 배치 업데이트 시작: ${startIndex}번째부터 ${batchSize}개 처리...`);
    
    const result = await StockNameCacheService.updateBatchListedCompanies(batchSize, startIndex);
    
    res.json({
      success: true,
      message: `배치 업데이트 완료`,
      data: result,
      nextStartIndex: startIndex + batchSize,
      hasMore: result.hasMore || false,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ 배치 업데이트 실패:', error);
    
    res.status(500).json({
      success: false,
      message: '배치 업데이트 실패',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 기본 종목명 데이터 구축 (하드코딩된 주요 종목)
router.post('/populate', async (req, res) => {
  try {
    console.log('🚀 기본 종목명 데이터 구축 API 호출...');
    
    const result = await StockNameCacheService.populateStockNames();
    
    res.json({
      success: true,
      message: '기본 종목명 데이터 구축 완료',
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ 기본 종목명 데이터 구축 API 실패:', error);
    
    res.status(500).json({
      success: false,
      message: '기본 종목명 데이터 구축 실패',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 종목명 캐시 통계 조회
router.get('/stats', async (req, res) => {
  try {
    const stats = await StockNameCacheService.getCacheStats();
    
    res.json({
      success: true,
      message: '종목명 캐시 통계 조회 완료',
      data: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ 종목명 캐시 통계 조회 실패:', error);
    
    res.status(500).json({
      success: false,
      message: '종목명 캐시 통계 조회 실패',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 개별 종목명 조회 테스트
router.get('/test/:stockCode', async (req, res) => {
  try {
    const { stockCode } = req.params;
    const stockName = await StockNameCacheService.getStockName(stockCode);
    
    res.json({
      success: true,
      data: {
        stockCode,
        stockName
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`❌ 종목명 조회 테스트 실패 (${req.params.stockCode}):`, error);
    
    res.status(500).json({
      success: false,
      message: '종목명 조회 실패',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// KRX CSV 파일로 종목명 업데이트 (가장 정확한 방법)
router.post('/update-from-krx', async (req, res) => {
  try {
    const { csvFilePath } = req.body;
    
    if (!csvFilePath) {
      return res.status(400).json({
        success: false,
        message: 'CSV 파일 경로가 필요합니다',
        usage: 'POST /api/stock-names/update-from-krx {"csvFilePath": "/path/to/krx.csv"}',
        downloadUrl: 'https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020501',
        timestamp: new Date().toISOString()
      });
    }
    
    console.log('🚀 KRX CSV 파일로 종목명 업데이트 시작...');
    
    const KrxDataParser = require('../services/krxDataParser');
    const result = await KrxDataParser.updateStockNamesFromKrx(csvFilePath);
    
    res.json({
      success: true,
      message: 'KRX CSV 데이터로 종목명 업데이트 완료',
      data: result,
      source: 'KRX 한국거래소 정식 데이터',
      downloadUrl: 'https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020501',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ KRX CSV 업데이트 실패:', error);
    
    res.status(500).json({
      success: false,
      message: 'KRX CSV 업데이트 실패',
      error: error.message,
      downloadUrl: 'https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020501',
      timestamp: new Date().toISOString()
    });
  }
});

// 메모리 캐시 초기화
router.post('/clear-cache', async (req, res) => {
  try {
    StockNameCacheService.memoryCache.clear();
    
    res.json({
      success: true,
      message: '메모리 캐시 초기화 완료',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '메모리 캐시 초기화 실패',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;