const FinancialData = require('../models/FinancialData');
const DartService = require('./dartService');

class FinancialDataCacheService {
  constructor() {
    this.currentDataYear = new Date().getFullYear();
    
    // 4월 1일 이후면 전년도 데이터를 수집
    const now = new Date();
    if (now.getMonth() >= 3) { // 4월(3)부터
      this.targetYear = this.currentDataYear - 1; // 2025년이면 2024년 데이터
    } else {
      this.targetYear = this.currentDataYear - 2; // 2025년 3월이면 2023년 데이터
    }
    
    console.log(`📅 재무데이터 캐시 서비스 초기화: ${this.targetYear}년 데이터 대상 (수집년도: ${this.currentDataYear})`);
  }
  
  // 캐시된 재무데이터 조회 (메인 API)
  async getCachedFinancialData(stockCode) {
    try {
      // 1. 데이터베이스에서 최신 재무데이터 조회
      const cachedData = await FinancialData.getLatestFinancialData(stockCode);
      
      if (cachedData && cachedData.hasFullData) {
        const latest = cachedData.latest;
        
        // 데이터 수집년도가 현재년도와 같으면 사용 (최신 데이터)
        if (latest.dataYear === this.currentDataYear) {
          console.log(`✅ ${stockCode} 캐시된 재무데이터 사용 (${latest.dataYear}년 수집)`);
          
          return {
            stockCode: stockCode,
            name: latest.name,
            revenue: latest.revenue,
            netIncome: latest.netIncome,
            revenueGrowth3Y: latest.revenueGrowth3Y,
            netIncomeGrowth3Y: latest.netIncomeGrowth3Y,
            sharesOutstanding: latest.sharesOutstanding,
            dataSource: 'CACHED',
            lastUpdated: latest.lastUpdated,
            allYearsData: cachedData.allYears
          };
        }
      }
      
      // 2. 캐시 없거나 오래된 데이터면 새로 수집
      console.log(`🔄 ${stockCode} 재무데이터 새로 수집 필요`);
      return await this.collectAndCacheFinancialData(stockCode);
      
    } catch (error) {
      console.error(`캐시된 재무데이터 조회 실패 (${stockCode}):`, error);
      return null;
    }
  }
  
  // 새로 수집하고 캐시에 저장
  async collectAndCacheFinancialData(stockCode) {
    try {
      console.log(`📊 ${stockCode} DART API로 재무데이터 수집 시작...`);
      
      // DART API로 재무데이터 수집
      const dartResult = await DartService.analyzeStockFinancials(stockCode);
      if (!dartResult || !dartResult.stockCode) {
        console.log(`❌ ${stockCode} DART 재무데이터 수집 실패`);
        return null;
      }
      
      // 상장주식수도 함께 수집
      let sharesOutstanding = null;
      try {
        sharesOutstanding = await DartService.getSharesOutstanding(stockCode, this.targetYear);
      } catch (error) {
        console.log(`⚠️ ${stockCode} 상장주식수 조회 실패: ${error.message}`);
      }
      
      // 3개년 데이터 구성
      const yearlyData = [];
      for (let i = 0; i < 3; i++) {
        const year = this.targetYear - i;
        yearlyData.push({
          year: year,
          revenue: dartResult.revenue || 0,
          netIncome: dartResult.netIncome || 0,
          operatingIncome: dartResult.operatingIncome || 0,
          sharesOutstanding: sharesOutstanding || 0,
          revenueGrowth3Y: dartResult.revenueGrowth3Y || 0,
          netIncomeGrowth3Y: dartResult.netIncomeGrowth3Y || 0,
          dataSource: 'DART',
          isValidated: true
        });
      }
      
      // 데이터베이스에 저장
      await FinancialData.saveFinancialData(
        stockCode, 
        dartResult.corpCode,
        dartResult.name, 
        yearlyData, 
        this.currentDataYear
      );
      
      console.log(`✅ ${stockCode} 재무데이터 수집 및 캐시 저장 완료`);
      
      return {
        stockCode: stockCode,
        name: dartResult.name,
        revenue: dartResult.revenue,
        netIncome: dartResult.netIncome,
        revenueGrowth3Y: dartResult.revenueGrowth3Y,
        netIncomeGrowth3Y: dartResult.netIncomeGrowth3Y,
        sharesOutstanding: sharesOutstanding,
        dataSource: 'FRESH_DART',
        lastUpdated: new Date(),
        allYearsData: yearlyData
      };
      
    } catch (error) {
      console.error(`재무데이터 수집 실패 (${stockCode}):`, error);
      return null;
    }
  }
  
  // 전체 종목 재무데이터 일괄 수집 (연 1회 실행용) - 개선된 Bulk API 활용
  async bulkCollectFinancialData(stockCodes, batchSize = 20) {
    console.log(`🚀 ${stockCodes.length}개 종목 재무데이터 일괄 수집 시작 (개선된 Bulk API 활용, 배치 크기: ${batchSize})`);
    
    const results = {
      total: stockCodes.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };
    
    // 1. 이미 최신 데이터가 있는 종목들 필터링
    const needsUpdateCodes = [];
    for (const stockCode of stockCodes) {
      const existing = await FinancialData.findOne({ 
        stockCode: stockCode, 
        dataYear: this.currentDataYear 
      });
      
      if (existing) {
        console.log(`⏭️ ${stockCode} 이미 ${this.currentDataYear}년 데이터 존재, 건너뛰기`);
        results.skipped++;
      } else {
        needsUpdateCodes.push(stockCode);
      }
    }
    
    console.log(`📋 업데이트 필요 종목: ${needsUpdateCodes.length}개 (전체 ${stockCodes.length}개 중)`);
    
    if (needsUpdateCodes.length === 0) {
      console.log('🏁 모든 종목이 최신 데이터를 보유하고 있습니다.');
      return results;
    }
    
    // 2. 새로운 Bulk API로 효율적 수집
    try {
      console.log(`🔥 DART Bulk API로 ${needsUpdateCodes.length}개 종목 동시 수집 시작...`);
      
      const bulkResult = await DartService.getBulkFinancialData(needsUpdateCodes, batchSize);
      
      console.log(`📊 Bulk API 결과: 성공 ${bulkResult.summary.success}개, 실패 ${bulkResult.summary.failed}개 (성공률: ${bulkResult.summary.successRate})`);
      
      // 3. 성공한 데이터들을 데이터베이스에 저장
      const savePromises = [];
      bulkResult.successes.forEach((financialData, stockCode) => {
        savePromises.push(this.saveBulkFinancialData(stockCode, financialData));
      });
      
      const saveResults = await Promise.all(savePromises);
      const successfulSaves = saveResults.filter(r => r === true).length;
      
      results.success = successfulSaves;
      results.failed += (bulkResult.failures.length + saveResults.filter(r => r !== true).length);
      
      // 4. 실패한 종목들은 기존 방식으로 재시도
      if (bulkResult.failures.length > 0) {
        console.log(`🔄 실패한 ${bulkResult.failures.length}개 종목 개별 재시도...`);
        
        for (const failure of bulkResult.failures) {
          try {
            const result = await this.collectAndCacheFinancialData(failure.stockCode);
            if (result) {
              results.success++;
            } else {
              results.errors.push({ 
                stockCode: failure.stockCode, 
                error: `Bulk 실패 후 개별 재시도도 실패: ${failure.reason}` 
              });
            }
          } catch (error) {
            results.errors.push({ 
              stockCode: failure.stockCode, 
              error: `개별 재시도 중 오류: ${error.message}` 
            });
          }
          
          // 개별 재시도 간 짧은 대기
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
    } catch (error) {
      console.error('Bulk API 전체 실패, 기존 방식으로 전환:', error.message);
      
      // Bulk API 실패시 기존 방식으로 Fallback
      return await this.bulkCollectFinancialDataLegacy(needsUpdateCodes, Math.min(batchSize, 10));
    }
    
    console.log(`🏁 개선된 재무데이터 일괄 수집 완료:`, results);
    return results;
  }

  // Bulk 수집된 데이터를 데이터베이스에 저장
  async saveBulkFinancialData(stockCode, financialData) {
    try {
      // 3개년 데이터 구성
      const yearlyData = [{
        year: this.targetYear,
        revenue: financialData.revenue,
        netIncome: financialData.netIncome,
        operatingIncome: 0, // Multi API에서는 제공되지 않음
        sharesOutstanding: 0, // 별도 조회 필요
        revenueGrowth3Y: financialData.revenueGrowth3Y,
        netIncomeGrowth3Y: financialData.netIncomeGrowth3Y,
        dataSource: 'DART_BULK',
        isValidated: true
      }];
      
      // 데이터베이스에 저장
      await FinancialData.saveFinancialData(
        stockCode,
        financialData.corpCode,
        financialData.name,
        yearlyData,
        this.currentDataYear
      );
      
      console.log(`✅ ${stockCode} Bulk 재무데이터 저장 완료`);
      return true;
      
    } catch (error) {
      console.error(`${stockCode} Bulk 데이터 저장 실패:`, error.message);
      return false;
    }
  }

  // 기존 방식 (Fallback용)
  async bulkCollectFinancialDataLegacy(stockCodes, batchSize = 10) {
    console.log(`🔄 기존 방식으로 ${stockCodes.length}개 종목 재무데이터 일괄 수집 (배치 크기: ${batchSize})`);
    
    const results = {
      total: stockCodes.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };
    
    // 배치 단위로 처리
    for (let i = 0; i < stockCodes.length; i += batchSize) {
      const batch = stockCodes.slice(i, i + batchSize);
      console.log(`📦 Legacy 배치 ${Math.floor(i/batchSize) + 1}/${Math.ceil(stockCodes.length/batchSize)} 처리 중...`);
      
      const batchPromises = batch.map(async (stockCode) => {
        try {
          const result = await this.collectAndCacheFinancialData(stockCode);
          if (result) {
            results.success++;
          } else {
            results.failed++;
          }
          return result;
          
        } catch (error) {
          console.error(`${stockCode} Legacy 처리 실패:`, error.message);
          results.failed++;
          results.errors.push({ stockCode, error: error.message });
          return null;
        }
      });
      
      await Promise.all(batchPromises);
      
      // 배치 간 대기 (API Rate Limit 고려)
      if (i + batchSize < stockCodes.length) {
        console.log('⏳ 2초 대기...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log(`🏁 Legacy 재무데이터 일괄 수집 완료:`, results);
    return results;
  }

  // 신규: 슈퍼스톡스 검색용 고속 재무데이터 조회
  async getSuperstocksFinancialData(stockCodes) {
    try {
      console.log(`⚡ 슈퍼스톡스 검색용 고속 재무데이터 조회: ${stockCodes.length}개 종목`);
      
      // 1. 캐시된 데이터 우선 조회 (병렬)
      const cachePromises = stockCodes.map(async (stockCode) => {
        try {
          const cached = await this.getCachedFinancialData(stockCode);
          return { stockCode, data: cached, source: 'cache' };
        } catch (error) {
          return { stockCode, data: null, source: 'cache_error', error: error.message };
        }
      });
      
      const cacheResults = await Promise.all(cachePromises);
      
      // 2. 캐시 적중률 분석
      const cacheMisses = cacheResults.filter(result => !result.data);
      const cacheHits = cacheResults.filter(result => result.data);
      
      console.log(`📊 캐시 적중률: ${cacheHits.length}/${stockCodes.length} (${((cacheHits.length/stockCodes.length)*100).toFixed(1)}%)`);
      
      // 3. 캐시 미스 종목들 Bulk API로 신속 수집
      const finalResults = new Map();
      
      // 캐시 히트 데이터 먼저 추가
      cacheHits.forEach(result => {
        finalResults.set(result.stockCode, result.data);
      });
      
      // 캐시 미스 데이터 Bulk API로 수집
      if (cacheMisses.length > 0) {
        console.log(`🚀 캐시 미스 ${cacheMisses.length}개 종목 Bulk API로 신속 수집...`);
        
        const missCodes = cacheMisses.map(result => result.stockCode);
        const bulkResult = await DartService.getBulkFinancialData(missCodes, 15); // 작은 배치로 빠른 처리
        
        // Bulk 성공 데이터 추가
        bulkResult.successes.forEach((data, stockCode) => {
          finalResults.set(stockCode, {
            stockCode,
            name: data.name,
            revenue: data.revenue,
            netIncome: data.netIncome,
            revenueGrowth3Y: data.revenueGrowth3Y,
            netIncomeGrowth3Y: data.netIncomeGrowth3Y,
            sharesOutstanding: null, // 별도 조회 필요
            dataSource: 'FRESH_BULK',
            lastUpdated: new Date()
          });
        });
        
        console.log(`⚡ 고속 수집 완료: 총 ${finalResults.size}개 종목 (캐시 ${cacheHits.length}개 + 신규 ${bulkResult.successes.size}개)`);
      }
      
      return finalResults;
      
    } catch (error) {
      console.error('슈퍼스톡스 고속 재무데이터 조회 실패:', error.message);
      throw error;
    }
  }
  
  // 캐시 통계 조회
  async getCacheStatistics() {
    try {
      const stats = await FinancialData.aggregate([
        {
          $group: {
            _id: '$dataYear',
            count: { $sum: 1 },
            uniqueStocks: { $addToSet: '$stockCode' },
            lastUpdated: { $max: '$lastUpdated' }
          }
        },
        {
          $addFields: {
            uniqueStockCount: { $size: '$uniqueStocks' }
          }
        },
        {
          $sort: { _id: -1 }
        }
      ]);
      
      return stats.map(stat => ({
        dataYear: stat._id,
        totalRecords: stat.count,
        uniqueStocks: stat.uniqueStockCount,
        lastUpdated: stat.lastUpdated
      }));
      
    } catch (error) {
      console.error('캐시 통계 조회 실패:', error);
      return [];
    }
  }
  
  // 오래된 캐시 데이터 정리 (2년 이상 된 데이터)
  async cleanupOldCache(keepYears = 2) {
    try {
      const cutoffYear = this.currentDataYear - keepYears;
      const result = await FinancialData.deleteMany({
        dataYear: { $lt: cutoffYear }
      });
      
      console.log(`🧹 ${result.deletedCount}개 오래된 재무데이터 정리 완료 (${cutoffYear}년 이전)`);
      return result.deletedCount;
      
    } catch (error) {
      console.error('캐시 데이터 정리 실패:', error);
      return 0;
    }
  }
  
  // 재무데이터 년도 업데이트 체크 (4월 1일 체크용)
  checkDataYearUpdate() {
    const now = new Date();
    const newTargetYear = now.getMonth() >= 3 ? 
      this.currentDataYear - 1 : 
      this.currentDataYear - 2;
      
    if (newTargetYear !== this.targetYear) {
      console.log(`📅 재무데이터 대상년도 업데이트: ${this.targetYear} → ${newTargetYear}`);
      this.targetYear = newTargetYear;
      return true;
    }
    return false;
  }
}

module.exports = new FinancialDataCacheService();