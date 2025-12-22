const express = require('express');
const router = express.Router();
const DartService = require('../services/dartService');
const YahooFinanceService = require('../services/yahooFinanceService');

// DART API vs Yahoo Finance 재무데이터 비교 테스트 (30개 종목)
router.get('/compare-financial-data', async (req, res) => {
  try {
    console.log('🧪 DART API vs Yahoo Finance 재무데이터 비교 테스트 시작...');
    
    // 테스트 대상 30개 종목 (주요 종목 위주)
    const testStocks = [
      // 대형주 (DART 데이터 있을 가능성 높음)
      '005930', '000660', '035420', '005380', '012330', '000270', '105560', '055550', '035720', '051910',
      
      // 중형주 
      '006400', '028260', '096770', '003550', '015760', '017670', '034730', '003490', '009150', '032830',
      
      // 코스닥 대형주
      '251270', '036570', '352820', '377300', '259960', '293490', '263750', '095660', '112040', '326030'
    ];
    
    const results = {
      timestamp: new Date().toISOString(),
      totalTested: testStocks.length,
      dartResults: {
        success: 0,
        failed: 0,
        details: {}
      },
      yahooResults: {
        success: 0,
        failed: 0,
        details: {}
      },
      comparison: {
        onlyDart: [],
        onlyYahoo: [],
        both: [],
        neither: []
      }
    };
    
    for (const stockCode of testStocks) {
      console.log(`\n🔍 ${stockCode} 데이터 소스 비교 테스트...`);
      
      // 1. DART API 테스트
      let dartSuccess = false;
      let dartData = null;
      try {
        dartData = await DartService.analyzeStockFinancials(stockCode);
        if (dartData && dartData.stockCode) {
          dartSuccess = true;
          results.dartResults.success++;
          results.dartResults.details[stockCode] = {
            success: true,
            revenue: dartData.revenue,
            netIncome: dartData.netIncome,
            revenueGrowth3Y: dartData.revenueGrowth3Y,
            netIncomeGrowth3Y: dartData.netIncomeGrowth3Y
          };
          console.log(`✅ DART: 매출 ${dartData.revenue}억원, 성장률 ${dartData.revenueGrowth3Y}%`);
        } else {
          results.dartResults.failed++;
          results.dartResults.details[stockCode] = { success: false, reason: '데이터 없음' };
          console.log(`❌ DART: 데이터 없음`);
        }
      } catch (dartError) {
        results.dartResults.failed++;
        results.dartResults.details[stockCode] = { success: false, reason: dartError.message };
        console.log(`❌ DART: ${dartError.message}`);
      }
      
      // 2. Yahoo Finance 테스트
      let yahooSuccess = false;
      let yahooData = null;
      try {
        yahooData = await YahooFinanceService.getStockInfo(stockCode);
        if (yahooData && yahooData.totalRevenue) {
          yahooSuccess = true;
          results.yahooResults.success++;
          results.yahooResults.details[stockCode] = {
            success: true,
            totalRevenue: yahooData.totalRevenue,
            totalRevenueDisplay: `${(yahooData.totalRevenue / 100000000).toFixed(0)}억원`,
            sharesOutstanding: yahooData.sharesOutstanding || 0,
            marketCap: yahooData.marketCap || 0
          };
          console.log(`✅ Yahoo: 매출 ${(yahooData.totalRevenue / 100000000).toFixed(0)}억원, 시총 ${(yahooData.marketCap / 1000000000).toFixed(1)}억원`);
        } else {
          results.yahooResults.failed++;
          results.yahooResults.details[stockCode] = { success: false, reason: '데이터 없음' };
          console.log(`❌ Yahoo: 데이터 없음`);
        }
      } catch (yahooError) {
        results.yahooResults.failed++;
        results.yahooResults.details[stockCode] = { success: false, reason: yahooError.message };
        console.log(`❌ Yahoo: ${yahooError.message}`);
      }
      
      // 3. 비교 결과 분류
      if (dartSuccess && yahooSuccess) {
        results.comparison.both.push(stockCode);
      } else if (dartSuccess && !yahooSuccess) {
        results.comparison.onlyDart.push(stockCode);
      } else if (!dartSuccess && yahooSuccess) {
        results.comparison.onlyYahoo.push(stockCode);
      } else {
        results.comparison.neither.push(stockCode);
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 결과 통계
    const dartSuccessRate = (results.dartResults.success / testStocks.length * 100).toFixed(1);
    const yahooSuccessRate = (results.yahooResults.success / testStocks.length * 100).toFixed(1);
    
    console.log(`📊 비교 테스트 완료: DART ${dartSuccessRate}% vs Yahoo ${yahooSuccessRate}%`);
    
    res.json({
      success: true,
      results: results,
      statistics: {
        dartSuccessRate: `${dartSuccessRate}%`,
        yahooSuccessRate: `${yahooSuccessRate}%`,
        bothSuccess: results.comparison.both.length,
        onlyDartSuccess: results.comparison.onlyDart.length,
        onlyYahooSuccess: results.comparison.onlyYahoo.length,
        bothFailed: results.comparison.neither.length
      },
      recommendation: yahooSuccessRate > dartSuccessRate ? 
        'Yahoo Finance가 더 안정적' : 
        'DART API가 더 안정적',
      message: `30개 종목 테스트 완료: DART ${results.dartResults.success}개, Yahoo ${results.yahooResults.success}개 성공`
    });
    
  } catch (error) {
    console.error('데이터 소스 비교 테스트 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '데이터 소스 비교 테스트 중 오류 발생'
    });
  }
});

// Yahoo Finance 3개년 데이터 상세 테스트
router.get('/yahoo-3year-test', async (req, res) => {
  try {
    console.log('📊 Yahoo Finance 3개년 재무데이터 상세 테스트...');
    
    const testStocks = ['005930', '000660', '035420', '251270', '036570'];
    const results = [];
    
    for (const stockCode of testStocks) {
      console.log(`\n📈 ${stockCode} Yahoo Finance 상세 분석...`);
      
      try {
        const stockInfo = await YahooFinanceService.getStockInfo(stockCode);
        
        if (stockInfo) {
          // 야후 파이낸스에서 제공하는 모든 재무 정보 확인
          const analysis = {
            stockCode: stockCode,
            hasBasicData: !!stockInfo.totalRevenue,
            totalRevenue: stockInfo.totalRevenue || 0,
            revenueDisplay: stockInfo.totalRevenue ? `${(stockInfo.totalRevenue / 100000000).toFixed(0)}억원` : 'N/A',
            
            // 추가 재무 정보 확인
            marketCap: stockInfo.marketCap || 0,
            marketCapDisplay: stockInfo.marketCap ? `${(stockInfo.marketCap / 1000000000).toFixed(1)}조원` : 'N/A',
            sharesOutstanding: stockInfo.sharesOutstanding || 0,
            
            // 가능한 다른 재무 정보들
            availableFields: Object.keys(stockInfo).filter(key => 
              key.includes('revenue') || 
              key.includes('income') || 
              key.includes('profit') || 
              key.includes('earnings')
            ),
            
            // PSR 계산 가능 여부
            canCalculatePSR: !!(stockInfo.totalRevenue && stockInfo.sharesOutstanding),
            
            rawData: stockInfo // 전체 원시 데이터
          };
          
          results.push(analysis);
          console.log(`✅ ${stockCode}: 매출 ${analysis.revenueDisplay}, PSR 계산 ${analysis.canCalculatePSR ? '가능' : '불가'}`);
          
        } else {
          results.push({
            stockCode: stockCode,
            hasBasicData: false,
            error: 'Yahoo Finance 데이터 없음'
          });
          console.log(`❌ ${stockCode}: Yahoo Finance 데이터 없음`);
        }
        
      } catch (error) {
        results.push({
          stockCode: stockCode,
          hasBasicData: false,
          error: error.message
        });
        console.log(`❌ ${stockCode}: ${error.message}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    const successCount = results.filter(r => r.hasBasicData).length;
    const psrCalculableCount = results.filter(r => r.canCalculatePSR).length;
    
    res.json({
      success: true,
      testResults: results,
      statistics: {
        totalTested: testStocks.length,
        hasBasicData: successCount,
        canCalculatePSR: psrCalculableCount,
        successRate: `${(successCount / testStocks.length * 100).toFixed(1)}%`,
        psrCalculableRate: `${(psrCalculableCount / testStocks.length * 100).toFixed(1)}%`
      },
      message: `Yahoo Finance 테스트 완료: ${successCount}개 성공, ${psrCalculableCount}개 PSR 계산 가능`
    });
    
  } catch (error) {
    console.error('Yahoo Finance 테스트 실패:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Yahoo Finance 테스트 중 오류 발생'
    });
  }
});

module.exports = router;