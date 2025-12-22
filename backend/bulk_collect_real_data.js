/**
 * 500개 종목 실제 DART API 재무데이터 대량 수집
 * 진행상황을 파일로 기록하며 실행
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const StockListService = require('./services/stockListService');
const FinancialDataCacheService = require('./services/financialDataCacheService');

class BulkDataCollector {
  constructor() {
    this.logFile = path.join(__dirname, 'bulk_collection_log.txt');
    this.progressFile = path.join(__dirname, 'collection_progress.json');
    this.startTime = Date.now();
    this.progress = {
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      currentBatch: 0,
      errors: [],
      startTime: new Date().toISOString(),
      lastUpdate: new Date().toISOString()
    };
  }

  // 로그 기록
  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    
    // 파일에도 기록
    fs.appendFileSync(this.logFile, logMessage + '\n');
  }

  // 진행상황 저장
  saveProgress() {
    this.progress.lastUpdate = new Date().toISOString();
    this.progress.elapsedTime = ((Date.now() - this.startTime) / 1000).toFixed(1) + '초';
    this.progress.estimatedRemaining = this.calculateETA();
    
    fs.writeFileSync(this.progressFile, JSON.stringify(this.progress, null, 2));
  }

  // 남은 시간 계산
  calculateETA() {
    if (this.progress.processed === 0) return '계산 중...';
    
    const elapsedMs = Date.now() - this.startTime;
    const avgTimePerStock = elapsedMs / this.progress.processed;
    const remainingStocks = this.progress.total - this.progress.processed;
    const remainingMs = avgTimePerStock * remainingStocks;
    
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    return `약 ${remainingMinutes}분`;
  }

  // MongoDB 연결
  async connectToDatabase() {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      this.log('🐢 MongoDB 연결 성공!');
    } catch (error) {
      this.log(`❌ MongoDB 연결 실패: ${error.message}`);
      throw error;
    }
  }

  // 500개 종목 대량 수집 실행
  async collectAllStocks() {
    try {
      // 1. 전체 종목 리스트 가져오기
      const allStocks = StockListService.getUnifiedStockList();
      this.progress.total = allStocks.length;
      
      this.log(`🚀 실제 DART API로 ${allStocks.length}개 종목 재무데이터 대량 수집 시작!`);
      this.log(`📊 예상 소요시간: ${Math.ceil(allStocks.length * 3 / 60)}분 (종목당 평균 3초)`);
      
      // 2. 이미 수집된 종목 확인
      const FinancialData = require('./models/FinancialData');
      const existingStocks = await FinancialData.distinct('stockCode', { dataYear: 2025 });
      const needsUpdate = allStocks.filter(code => !existingStocks.includes(code));
      
      this.log(`📋 전체 ${allStocks.length}개 중 수집 필요: ${needsUpdate.length}개, 이미 캐시됨: ${existingStocks.length}개`);
      
      if (needsUpdate.length === 0) {
        this.log('✅ 모든 종목이 이미 캐시되어 있습니다!');
        return this.progress;
      }

      // 3. FinancialDataCacheService 사용하여 안전한 대량 수집
      this.progress.total = needsUpdate.length;
      this.saveProgress();

      // 작은 배치 크기로 안정적 수집 (API Rate Limit 고려)
      const batchSize = 5;
      let batchIndex = 0;

      for (let i = 0; i < needsUpdate.length; i += batchSize) {
        const batch = needsUpdate.slice(i, i + batchSize);
        batchIndex++;
        this.progress.currentBatch = batchIndex;
        
        this.log(`📦 배치 ${batchIndex}/${Math.ceil(needsUpdate.length/batchSize)} 처리 중... (${batch.join(', ')})`);

        // 배치 처리
        const batchPromises = batch.map(async (stockCode) => {
          try {
            this.progress.processed++;
            
            // FinancialDataCacheService로 개별 수집
            const result = await FinancialDataCacheService.collectAndCacheFinancialData(stockCode);
            
            if (result) {
              this.progress.success++;
              this.log(`✅ ${stockCode} ${result.name}: 매출 ${result.revenue}억, 성장률 ${result.revenueGrowth3Y}%`);
              return { stockCode, status: 'success', data: result };
            } else {
              this.progress.failed++;
              this.log(`❌ ${stockCode} 재무데이터 수집 실패`);
              return { stockCode, status: 'failed', reason: 'No data returned' };
            }

          } catch (error) {
            this.progress.failed++;
            this.progress.errors.push({ stockCode, error: error.message });
            this.log(`❌ ${stockCode} 수집 중 오류: ${error.message}`);
            return { stockCode, status: 'error', reason: error.message };
          }
        });

        // 배치 실행
        await Promise.all(batchPromises);
        
        // 진행상황 저장
        this.saveProgress();
        
        // 중간 결과 로그
        if (batchIndex % 10 === 0) {
          const successRate = ((this.progress.success / this.progress.processed) * 100).toFixed(1);
          this.log(`📊 중간 결과 (배치 ${batchIndex}): 성공률 ${successRate}%, 성공 ${this.progress.success}개, 실패 ${this.progress.failed}개`);
        }

        // 배치 간 대기 (DART API Rate Limit 준수)
        if (i + batchSize < needsUpdate.length) {
          this.log('⏳ 3초 대기 (API Rate Limit)...');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      // 4. 최종 결과
      const endTime = Date.now();
      const totalTime = ((endTime - this.startTime) / 1000 / 60).toFixed(1);
      const successRate = ((this.progress.success / this.progress.processed) * 100).toFixed(1);

      this.log('\n🏁 대량 수집 완료!');
      this.log(`📊 최종 결과:`);
      this.log(`   총 처리: ${this.progress.processed}개`);
      this.log(`   성공: ${this.progress.success}개 (${successRate}%)`);
      this.log(`   실패: ${this.progress.failed}개`);
      this.log(`   총 소요시간: ${totalTime}분`);

      if (this.progress.errors.length > 0) {
        this.log(`\n❌ 실패한 종목들 (상위 10개):`);
        this.progress.errors.slice(0, 10).forEach(error => {
          this.log(`   ${error.stockCode}: ${error.error}`);
        });
      }

      this.saveProgress();
      return this.progress;

    } catch (error) {
      this.log(`❌ 대량 수집 프로세스 실패: ${error.message}`);
      this.progress.errors.push({ error: error.message });
      this.saveProgress();
      throw error;
    }
  }

  // 수집 결과 분석
  async analyzeCollectionResults() {
    try {
      this.log('\n📊 수집 결과 분석 중...');

      const FinancialData = require('./models/FinancialData');
      
      // 데이터 소스별 통계
      const sourceStats = await FinancialData.aggregate([
        { $match: { dataYear: 2025 } },
        {
          $group: {
            _id: '$dataSource',
            count: { $sum: 1 },
            avgRevenue: { $avg: '$revenue' },
            avgRevenueGrowth: { $avg: '$revenueGrowth3Y' },
            maxRevenueGrowth: { $max: '$revenueGrowth3Y' },
            minRevenueGrowth: { $min: '$revenueGrowth3Y' }
          }
        }
      ]);

      this.log('📈 데이터 소스별 통계:');
      sourceStats.forEach(stat => {
        this.log(`   ${stat._id}: ${stat.count}개 (평균 매출성장률: ${stat.avgRevenueGrowth?.toFixed(1)}%)`);
      });

      // 슈퍼스톡스 조건 예비 분석
      const potentialSuperstocks = await FinancialData.find({
        dataYear: 2025,
        revenueGrowth3Y: { $gte: 15 },
        netIncomeGrowth3Y: { $gte: 15 },
        revenue: { $gt: 0 }
      }).sort({ revenueGrowth3Y: -1 });

      this.log(`\n🎯 슈퍼스톡스 후보 분석:`);
      this.log(`   매출/순이익 성장률 조건 만족: ${potentialSuperstocks.length}개`);
      
      if (potentialSuperstocks.length > 0) {
        this.log(`   상위 5개 후보:`);
        potentialSuperstocks.slice(0, 5).forEach(stock => {
          this.log(`     ${stock.stockCode} ${stock.name}: 매출성장률 ${stock.revenueGrowth3Y}%, 순이익성장률 ${stock.netIncomeGrowth3Y}%`);
        });
      }

      return {
        sourceStats,
        potentialSuperstocks: potentialSuperstocks.length,
        topCandidates: potentialSuperstocks.slice(0, 10).map(stock => ({
          symbol: stock.stockCode,
          name: stock.name,
          revenueGrowth3Y: stock.revenueGrowth3Y,
          netIncomeGrowth3Y: stock.netIncomeGrowth3Y,
          revenue: stock.revenue
        }))
      };

    } catch (error) {
      this.log(`❌ 결과 분석 실패: ${error.message}`);
      return null;
    }
  }
}

// 메인 실행 함수
async function main() {
  const collector = new BulkDataCollector();
  
  try {
    // 로그 파일 초기화
    fs.writeFileSync(collector.logFile, `🚀 TurtleInvest 500개 종목 대량 재무데이터 수집 시작\n시작시간: ${new Date().toISOString()}\n\n`);
    
    collector.log('🚀 500개 종목 실제 DART API 재무데이터 수집 시작!');
    
    // MongoDB 연결
    await collector.connectToDatabase();
    
    // 대량 수집 실행
    const results = await collector.collectAllStocks();
    
    // 결과 분석
    const analysis = await collector.analyzeCollectionResults();
    
    collector.log('\n✅ 모든 작업 완료!');
    collector.log(`📄 상세 로그: ${collector.logFile}`);
    collector.log(`📊 진행상황: ${collector.progressFile}`);
    
  } catch (error) {
    collector.log(`❌ 전체 프로세스 실패: ${error.message}`);
  } finally {
    await mongoose.connection.close();
    collector.log('👋 MongoDB 연결 종료');
  }
}

// 진행상황 모니터링 함수
function monitorProgress() {
  const collector = new BulkDataCollector();
  
  if (fs.existsSync(collector.progressFile)) {
    const progress = JSON.parse(fs.readFileSync(collector.progressFile, 'utf8'));
    
    console.log('\n📊 현재 진행상황:');
    console.log(`   진행률: ${progress.processed}/${progress.total} (${((progress.processed/progress.total)*100).toFixed(1)}%)`);
    console.log(`   성공: ${progress.success}개, 실패: ${progress.failed}개`);
    console.log(`   현재 배치: ${progress.currentBatch}`);
    console.log(`   소요시간: ${progress.elapsedTime || '계산 중...'}`);
    console.log(`   예상 남은 시간: ${progress.estimatedRemaining || '계산 중...'}`);
    console.log(`   마지막 업데이트: ${progress.lastUpdate}`);
    
    if (progress.errors.length > 0) {
      console.log(`\n❌ 최근 에러 (상위 3개):`);
      progress.errors.slice(-3).forEach(error => {
        console.log(`     ${error.stockCode}: ${error.error}`);
      });
    }
  } else {
    console.log('📄 진행상황 파일이 없습니다. 수집이 아직 시작되지 않았을 수 있습니다.');
  }
}

// 실행 모드 선택
const mode = process.argv[2] || 'help';

switch (mode) {
  case 'start':
    console.log('🚀 500개 종목 대량 수집 시작...');
    console.log('⚠️  이 작업은 15-30분 정도 소요될 수 있습니다.');
    console.log('📊 진행상황 확인: node bulk_collect_real_data.js monitor');
    main();
    break;
    
  case 'monitor':
    console.log('📊 진행상황 모니터링...');
    monitorProgress();
    break;
    
  case 'help':
  default:
    console.log('\n🛠️  사용법:');
    console.log('  node bulk_collect_real_data.js start    # 대량 수집 시작');
    console.log('  node bulk_collect_real_data.js monitor  # 진행상황 확인');
    console.log('\n⚠️  주의사항:');
    console.log('  - DART_API_KEY 환경변수 필요');
    console.log('  - MongoDB 연결 필요');
    console.log('  - 15-30분 소요 예상');
    console.log('  - API Rate Limit으로 인한 대기 시간 포함');
    break;
}