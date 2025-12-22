/**
 * 재무데이터 캐시 스크립트
 * 주요 종목의 재무데이터를 미리 수집하여 MongoDB에 저장
 */

require('dotenv').config();
const mongoose = require('mongoose');
const FinancialData = require('./models/FinancialData');
const DartService = require('./services/dartService');

class FinancialDataCacher {
  constructor() {
    this.majorStocks = [
      // 코스피 주요 30개 (확실한 데이터가 있는 종목들)
      '005930', // 삼성전자
      '000660', // SK하이닉스
      '035420', // NAVER
      '005380', // 현대차
      '000270', // 기아
      '051910', // LG화학
      '068270', // 셀트리온
      '207940', // 삼성바이오로직스
      '323410', // 카카오뱅크
      '003670', // 포스코홀딩스
      '018260', // 삼성에스디에스
      '329180', // HD현대미포
      '010950', // S-Oil
      '000720', // 현대건설
      '024110', // 기업은행
      '316140', // 우리금융지주
      '086790', // 하나금융지주
      '030200', // KT
      '009540', // HD한국조선해양
      '011200', // HMM
      
      // 코스닥 주요 20개
      '251270', // 넷마블
      '036570', // 엔씨소프트
      '352820', // 하이브
      '377300', // 카카오페이
      '259960', // 크래프톤
      '293490', // 카카오게임즈
      '263750', // 펄어비스
      '095660', // 네오위즈
      '112040', // 위메이드
      '326030', // SK바이오팜
      '145020', // 휴젤
      '195940', // HK이노엔
      '214150', // 클래시스
      '042700', // 한미반도체
      '000990', // DB하이텍
      '058470', // 리노공업
      '240810', // 원익IPS
      '064290', // 인텍플러스
      '039030', // 이오테크닉스
      '108860'  // 셀바스AI
    ];
  }

  // MongoDB 연결
  async connectToDatabase() {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('🐢 MongoDB 연결 성공!');
    } catch (error) {
      console.error('❌ MongoDB 연결 실패:', error.message);
      throw error;
    }
  }

  // 단일 종목 재무데이터 캐시
  async cacheStockData(stockCode) {
    try {
      console.log(`📊 ${stockCode} 재무데이터 캐싱 시작...`);

      // 1. 이미 캐시된 데이터가 있는지 확인
      const existing = await FinancialData.findOne({
        stockCode: stockCode,
        dataYear: 2025 // 현재 수집년도
      });

      if (existing) {
        console.log(`⏭️ ${stockCode} 이미 캐시됨, 건너뛰기`);
        return { status: 'skipped', stockCode };
      }

      // 2. DART API로 최신 데이터 수집 (2024년)
      const financialResult = await DartService.analyzeStockFinancials(stockCode);
      
      if (!financialResult) {
        console.log(`❌ ${stockCode} DART 재무데이터 수집 실패`);
        return { status: 'failed', stockCode, reason: 'DART API 실패' };
      }

      // 3. 상장주식수 정보도 수집
      let sharesOutstanding = null;
      try {
        sharesOutstanding = await DartService.getSharesOutstanding(stockCode, 2024);
      } catch (error) {
        console.log(`⚠️ ${stockCode} 상장주식수 조회 실패, 추정값 사용`);
        sharesOutstanding = this.estimateShares(stockCode);
      }

      // 4. 데이터베이스에 저장
      const financialData = new FinancialData({
        stockCode: stockCode,
        corpCode: financialResult.corpCode || 'unknown',
        name: financialResult.name || DartService.getStockName(stockCode),
        dataYear: 2025, // 수집년도
        lastUpdated: new Date(),
        yearlyData: [{
          year: 2024, // 실제 재무데이터 년도
          revenue: financialResult.revenue || 0,
          netIncome: financialResult.netIncome || 0,
          operatingIncome: 0, // Multi API에서는 제공 안됨
          sharesOutstanding: sharesOutstanding || 0,
          revenueGrowth3Y: financialResult.revenueGrowth3Y || 0,
          netIncomeGrowth3Y: financialResult.netIncomeGrowth3Y || 0,
          dataSource: 'DART',
          isValidated: true
        }]
      });

      await financialData.save();
      
      console.log(`✅ ${stockCode} 재무데이터 캐시 완료: 매출 ${financialResult.revenue}억, 성장률 ${financialResult.revenueGrowth3Y}%`);
      
      return { 
        status: 'success', 
        stockCode,
        data: {
          revenue: financialResult.revenue,
          revenueGrowth3Y: financialResult.revenueGrowth3Y,
          netIncomeGrowth3Y: financialResult.netIncomeGrowth3Y
        }
      };

    } catch (error) {
      console.error(`❌ ${stockCode} 캐싱 실패:`, error.message);
      return { status: 'error', stockCode, reason: error.message };
    }
  }

  // 상장주식수 추정 (주요 종목)
  estimateShares(stockCode) {
    const knownShares = {
      '005930': 5969782550,  // 삼성전자
      '000660': 728002365,   // SK하이닉스
      '035420': 164688891,   // NAVER
      '005380': 2924634238,  // 현대차
      '000270': 803069908,   // 기아
      '051910': 682692000,   // LG화학
      '068270': 817387439,   // 셀트리온
      '207940': 687340000,   // 삼성바이오로직스
      '323410': 1600000000,  // 카카오뱅크
      '251270': 87500000,    // 넷마블
      '036570': 19176294,    // 엔씨소프트
      '352820': 18394459,    // 하이브
      '326030': 85000000,    // SK바이오팜
      '042700': 8070000      // 한미반도체
    };
    
    return knownShares[stockCode] || 100000000; // 기본 1억주
  }

  // 전체 주요 종목 캐싱
  async cacheAllMajorStocks() {
    console.log(`🚀 주요 ${this.majorStocks.length}개 종목 재무데이터 캐싱 시작...`);
    
    const results = {
      total: this.majorStocks.length,
      success: 0,
      skipped: 0,
      failed: 0,
      errors: []
    };

    // 배치 단위로 처리 (5개씩)
    const batchSize = 5;
    for (let i = 0; i < this.majorStocks.length; i += batchSize) {
      const batch = this.majorStocks.slice(i, i + batchSize);
      console.log(`📦 배치 ${Math.floor(i/batchSize) + 1}/${Math.ceil(this.majorStocks.length/batchSize)} (${batch.length}개 종목)`);

      const batchPromises = batch.map(stockCode => this.cacheStockData(stockCode));
      const batchResults = await Promise.all(batchPromises);

      // 결과 집계
      batchResults.forEach(result => {
        if (result.status === 'success') results.success++;
        else if (result.status === 'skipped') results.skipped++;
        else if (result.status === 'failed' || result.status === 'error') {
          results.failed++;
          results.errors.push(result);
        }
      });

      // 배치 간 대기 (DART API Rate Limit)
      if (i + batchSize < this.majorStocks.length) {
        console.log('⏳ 3초 대기...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    console.log('\n📊 캐싱 결과 요약:');
    console.log(`✅ 성공: ${results.success}개`);
    console.log(`⏭️ 건너뛰기: ${results.skipped}개`);
    console.log(`❌ 실패: ${results.failed}개`);
    
    if (results.errors.length > 0) {
      console.log('\n❌ 실패한 종목들:');
      results.errors.forEach(error => {
        console.log(`   ${error.stockCode}: ${error.reason}`);
      });
    }

    return results;
  }

  // 빠른 캐시 확인
  async checkCacheStatus() {
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

      console.log('\n📊 캐시 현황:');
      stats.forEach(stat => {
        console.log(`   ${stat._id}년: ${stat.uniqueStockCount}개 종목, 마지막 업데이트: ${stat.lastUpdated}`);
      });

      return stats;
    } catch (error) {
      console.error('캐시 상태 확인 실패:', error.message);
      return [];
    }
  }

  // 간단한 테스트 데이터 삽입 (DART 실패시 사용)
  async insertTestData() {
    console.log('🧪 테스트 재무데이터 삽입...');

    const testData = [
      {
        stockCode: '005930',
        name: '삼성전자',
        revenue: 2790000,
        netIncome: 265000,
        revenueGrowth3Y: 8.5,
        netIncomeGrowth3Y: 12.3,
        sharesOutstanding: 5969782550
      },
      {
        stockCode: '035420', 
        name: 'NAVER',
        revenue: 89000,
        netIncome: 13500,
        revenueGrowth3Y: 18.2,
        netIncomeGrowth3Y: 22.1,
        sharesOutstanding: 164688891
      },
      {
        stockCode: '000660',
        name: 'SK하이닉스',
        revenue: 737000,
        netIncome: 18500,
        revenueGrowth3Y: 25.8,
        netIncomeGrowth3Y: -15.2,
        sharesOutstanding: 728002365
      },
      {
        stockCode: '352820',
        name: '하이브',
        revenue: 15000,
        netIncome: 2500,
        revenueGrowth3Y: 35.7,
        netIncomeGrowth3Y: 28.9,
        sharesOutstanding: 18394459
      },
      {
        stockCode: '326030',
        name: 'SK바이오팜',
        revenue: 12000,
        netIncome: 3200,
        revenueGrowth3Y: 42.1,
        netIncomeGrowth3Y: 38.5,
        sharesOutstanding: 85000000
      }
    ];

    let inserted = 0;
    for (const stock of testData) {
      try {
        // 기존 데이터 삭제
        await FinancialData.deleteMany({ stockCode: stock.stockCode });

        const financialData = new FinancialData({
          stockCode: stock.stockCode,
          corpCode: 'test_corp',
          name: stock.name,
          year: 2024, // 실제 재무데이터 년도
          dataYear: 2025, // 수집년도
          revenue: stock.revenue,
          netIncome: stock.netIncome,
          operatingIncome: 0,
          sharesOutstanding: stock.sharesOutstanding,
          revenueGrowth3Y: stock.revenueGrowth3Y,
          netIncomeGrowth3Y: stock.netIncomeGrowth3Y,
          dataSource: 'ESTIMATED',
          lastUpdated: new Date(),
          isValidated: true
        });

        await financialData.save();
        console.log(`✅ ${stock.stockCode} ${stock.name} 테스트 데이터 삽입 완료`);
        inserted++;

      } catch (error) {
        console.error(`❌ ${stock.stockCode} 테스트 데이터 삽입 실패:`, error.message);
      }
    }

    console.log(`✅ 테스트 데이터 ${inserted}개 삽입 완료`);
    return inserted;
  }
}

// 실행 스크립트
async function main() {
  const cacher = new FinancialDataCacher();
  
  try {
    // 1. MongoDB 연결
    await cacher.connectToDatabase();
    
    // 2. 현재 캐시 상태 확인
    await cacher.checkCacheStatus();
    
    // 실행 모드 선택
    const mode = process.argv[2] || 'test';
    
    if (mode === 'test') {
      console.log('\n🧪 테스트 모드: 샘플 데이터 삽입');
      await cacher.insertTestData();
    } else if (mode === 'real') {
      console.log('\n🔥 실제 데이터 수집 모드');
      await cacher.cacheAllMajorStocks();
    } else if (mode === 'check') {
      console.log('\n📊 캐시 상태만 확인');
    } else {
      console.log('\n사용법:');
      console.log('  node cache_financial_data.js test   # 테스트 데이터 삽입');
      console.log('  node cache_financial_data.js real   # 실제 DART 데이터 수집');
      console.log('  node cache_financial_data.js check  # 캐시 상태 확인');
    }
    
    // 3. 최종 캐시 상태 확인
    await cacher.checkCacheStatus();
    
  } catch (error) {
    console.error('❌ 캐싱 프로세스 실패:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('👋 MongoDB 연결 종료');
  }
}

if (require.main === module) {
  main();
}

module.exports = FinancialDataCacher;