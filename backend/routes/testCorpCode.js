const express = require('express');
const router = express.Router();
const DartService = require('../services/dartService');

// DART API 기업코드 ZIP 로딩 테스트
router.get('/zip-loading-test', async (req, res) => {
  try {
    console.log('🧪 DART API 기업코드 ZIP 로딩 테스트 시작...');
    
    const results = {
      timestamp: new Date().toISOString(),
      apiKeyStatus: {
        exists: !!DartService.apiKey,
        length: DartService.apiKey?.length || 0,
        valid: DartService.apiKey?.length >= 20
      },
      zipLoadingTest: {},
      sampleCorpCodes: {},
      errors: []
    };
    
    // 1. API 키 상태 확인
    if (!results.apiKeyStatus.valid) {
      results.errors.push('DART API 키가 유효하지 않음');
      return res.json({
        success: false,
        results: results,
        message: 'DART API 키 문제로 ZIP 로딩 불가'
      });
    }
    
    // 2. ZIP 파일 로딩 시도
    try {
      const startTime = Date.now();
      const allCorpCodes = await DartService.loadAllCorpCodes();
      const endTime = Date.now();
      
      if (allCorpCodes && allCorpCodes.size > 0) {
        results.zipLoadingTest = {
          success: true,
          totalCorpCodes: allCorpCodes.size,
          loadTime: `${(endTime - startTime) / 1000}초`,
          cacheStatus: 'LOADED'
        };
        
        // 3. 샘플 기업코드 조회 테스트
        const testStocks = ['005930', '000660', '035420', '042700', '251270'];
        const sampleResults = {};
        
        for (const stock of testStocks) {
          const corpInfo = allCorpCodes.get(stock);
          sampleResults[stock] = corpInfo ? {
            found: true,
            corpCode: corpInfo.corpCode,
            corpName: corpInfo.corpName
          } : {
            found: false,
            reason: '종목코드 매핑 없음'
          };
        }
        
        results.sampleCorpCodes = sampleResults;
        
      } else {
        results.zipLoadingTest = {
          success: false,
          error: 'ZIP 로딩 성공했지만 데이터 파싱 실패'
        };
        results.errors.push('기업코드 데이터 파싱 실패');
      }
      
    } catch (zipError) {
      results.zipLoadingTest = {
        success: false,
        error: zipError.message
      };
      results.errors.push(`ZIP 로딩 실패: ${zipError.message}`);
    }
    
    res.json({
      success: results.errors.length === 0,
      results: results,
      message: results.errors.length === 0 ? 
        `ZIP 로딩 성공: ${results.zipLoadingTest.totalCorpCodes}개 기업코드` :
        `ZIP 로딩 실패: ${results.errors.length}개 오류`
    });
    
  } catch (error) {
    console.error('기업코드 ZIP 로딩 테스트 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '기업코드 ZIP 로딩 테스트 중 오류 발생'
    });
  }
});

// 하드코딩되지 않은 종목들의 기업코드 수집
router.post('/collect-missing-corp-codes', async (req, res) => {
  try {
    console.log('🔍 누락된 기업코드 수집 시작...');
    
    const StockListService = require('../services/stockListService');
    const allStocks = StockListService.getUnifiedStockList();
    
    // 하드코딩된 종목코드 목록
    const knownCorpCodes = {
      '005930': '00126380', '000660': '00164779', '035420': '00593624',
      '005380': '00164742', '012330': '00268317', '000270': '00164509',
      '105560': '00103522', '055550': '00126186', '035720': '00593652',
      '051910': '00356370', '006400': '00126343', '028260': '00164742',
      '096770': '00126362', '003550': '00356361', '015760': '00164760',
      '017670': '00164765', '034730': '00164731', '003490': '00164734',
      '009150': '00126349', '032830': '00126344', '032350': '00111848',
      '060310': '00232467', '042700': '00164787', '251270': '00593651',
      '036570': '00593625', '352820': '00593659', '377300': '00593660',
      '259960': '00593655', '326030': '00593658', '145020': '00593640'
    };
    
    const missingStocks = allStocks.filter(stock => !knownCorpCodes[stock]);
    console.log(`📊 총 ${allStocks.length}개 종목 중 ${missingStocks.length}개 기업코드 누락`);
    
    if (missingStocks.length === 0) {
      return res.json({
        success: true,
        message: '모든 종목의 기업코드가 이미 하드코딩되어 있음',
        statistics: {
          totalStocks: allStocks.length,
          knownStocks: Object.keys(knownCorpCodes).length,
          missingStocks: 0
        }
      });
    }
    
    // ZIP 파일에서 누락된 기업코드 찾기
    const allCorpCodes = await DartService.loadAllCorpCodes();
    if (!allCorpCodes) {
      throw new Error('DART API ZIP 파일 로딩 실패');
    }
    
    const foundCorpCodes = {};
    const stillMissing = [];
    
    for (const stock of missingStocks.slice(0, 50)) { // 처음 50개만 테스트
      const corpInfo = allCorpCodes.get(stock);
      if (corpInfo) {
        foundCorpCodes[stock] = {
          corpCode: corpInfo.corpCode,
          corpName: corpInfo.corpName
        };
      } else {
        stillMissing.push(stock);
      }
    }
    
    res.json({
      success: true,
      results: {
        totalChecked: Math.min(50, missingStocks.length),
        foundInZip: Object.keys(foundCorpCodes).length,
        stillMissing: stillMissing.length,
        foundCorpCodes: foundCorpCodes,
        missingStockSamples: stillMissing.slice(0, 10)
      },
      message: `${Object.keys(foundCorpCodes).length}개 기업코드 추가 발견`
    });
    
  } catch (error) {
    console.error('기업코드 수집 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '기업코드 수집 중 오류 발생'
    });
  }
});

// 특정 종목의 기업코드 조회 테스트
router.get('/corp-code/:stockCode', async (req, res) => {
  try {
    const { stockCode } = req.params;
    console.log(`🔍 ${stockCode} 기업코드 조회 테스트...`);
    
    const corpInfo = await DartService.getCorpCode(stockCode);
    
    if (corpInfo) {
      res.json({
        success: true,
        stockCode: stockCode,
        corpInfo: corpInfo,
        message: '기업코드 조회 성공'
      });
    } else {
      res.json({
        success: false,
        stockCode: stockCode,
        message: '기업코드를 찾을 수 없음'
      });
    }
    
  } catch (error) {
    console.error(`기업코드 조회 실패 (${req.params.stockCode}):`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '기업코드 조회 중 오류 발생'
    });
  }
});

module.exports = router;