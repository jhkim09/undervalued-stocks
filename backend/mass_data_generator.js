/**
 * 500개 기업 대량 재무데이터 생성기
 * 업종별 현실적인 재무데이터 패턴 기반
 */

require('dotenv').config();
const mongoose = require('mongoose');
const FinancialData = require('./models/FinancialData');
const StockListService = require('./services/stockListService');

class MassDataGenerator {
  constructor() {
    // 업종별 재무 특성 패턴
    this.industryPatterns = {
      // 대형 전자/반도체 (시총 10조원 이상)
      electronics_large: {
        revenueRange: [500000, 3000000], // 50만~300만억
        growthRange: [5, 15],
        profitMargin: [8, 15],
        sharesRange: [500000000, 6000000000],
        codes: ['005930', '000660', '005380', '000270', '051910']
      },
      
      // 중형 IT/게임 (시총 1~10조원)
      it_gaming: {
        revenueRange: [10000, 100000], // 1만~10만억
        growthRange: [15, 40],
        profitMargin: [10, 25],
        sharesRange: [10000000, 200000000],
        codes: ['035420', '251270', '036570', '352820', '259960', '293490', '377300']
      },
      
      // 바이오/제약 (고성장)
      bio_pharma: {
        revenueRange: [500, 20000], // 500억~2만억
        growthRange: [20, 60],
        profitMargin: [5, 30],
        sharesRange: [5000000, 100000000],
        codes: ['326030', '145020', '195940', '214150', '214450', '196170', '328130', '285130', '237690', '141080']
      },
      
      // IT/반도체 중소형
      it_small: {
        revenueRange: [1000, 15000], // 1천~1.5만억
        growthRange: [15, 45],
        profitMargin: [8, 25],
        sharesRange: [5000000, 50000000],
        codes: ['042700', '039030', '240810', '058470', '064290', '108860', '347860', '178920', '189300']
      },
      
      // 전통 제조업 (안정형)
      manufacturing: {
        revenueRange: [5000, 80000], // 5천~8만억
        growthRange: [5, 20],
        profitMargin: [5, 15],
        sharesRange: [20000000, 500000000],
        codes: ['012330', '096770', '003550', '009150', '028260']
      },
      
      // 금융/보험
      financial: {
        revenueRange: [100000, 500000], // 10만~50만억
        growthRange: [3, 12],
        profitMargin: [15, 30],
        sharesRange: [500000000, 2000000000],
        codes: ['105560', '055550', '086790', '316140', '024110']
      },
      
      // 기타 중소형주 (랜덤)
      others: {
        revenueRange: [500, 10000], // 500억~1만억
        growthRange: [0, 35],
        profitMargin: [3, 20],
        sharesRange: [5000000, 100000000],
        codes: [] // 나머지 모든 종목
      }
    };
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

  // 업종 분류
  classifyStock(stockCode) {
    for (const [industry, pattern] of Object.entries(this.industryPatterns)) {
      if (pattern.codes.includes(stockCode)) {
        return industry;
      }
    }
    return 'others'; // 기본값
  }

  // 업종별 현실적인 재무데이터 생성
  generateRealisticFinancials(stockCode, industry) {
    const pattern = this.industryPatterns[industry];
    
    // 매출 (억원)
    const revenue = Math.random() * (pattern.revenueRange[1] - pattern.revenueRange[0]) + pattern.revenueRange[0];
    
    // 수익률 기반 순이익 계산
    const profitMargin = (Math.random() * (pattern.profitMargin[1] - pattern.profitMargin[0]) + pattern.profitMargin[0]) / 100;
    const netIncome = revenue * profitMargin;
    
    // 성장률 (3년 평균)
    const revenueGrowth = Math.random() * (pattern.growthRange[1] - pattern.growthRange[0]) + pattern.growthRange[0];
    const netIncomeGrowth = revenueGrowth + (Math.random() - 0.5) * 10; // 순이익 성장률은 매출 대비 ±5% 변동
    
    // 상장주식수
    const sharesOutstanding = Math.random() * (pattern.sharesRange[1] - pattern.sharesRange[0]) + pattern.sharesRange[0];
    
    return {
      revenue: Math.round(revenue),
      netIncome: Math.round(netIncome),
      revenueGrowth3Y: Math.round(revenueGrowth * 100) / 100,
      netIncomeGrowth3Y: Math.round(netIncomeGrowth * 100) / 100,
      sharesOutstanding: Math.round(sharesOutstanding)
    };
  }

  // 종목명 추정 (업종 기반)
  generateStockName(stockCode, industry) {
    const industryNames = {
      electronics_large: ['전자', '반도체', '디스플레이', '전기'],
      it_gaming: ['게임', 'IT', '소프트웨어', '플랫폼', '엔터'],
      bio_pharma: ['바이오', '제약', '의료', '헬스케어', '생명과학'],
      it_small: ['테크', 'AI', '반도체', '부품', '소재'],
      manufacturing: ['제조', '화학', '자동차', '철강', '기계'],
      financial: ['금융', '은행', '보험', '증권', '자산관리'],
      others: ['산업', '개발', '투자', '서비스', '물류']
    };
    
    const industryKeywords = industryNames[industry] || industryNames.others;
    const randomKeyword = industryKeywords[Math.floor(Math.random() * industryKeywords.length)];
    
    return `${randomKeyword}${stockCode.slice(-3)}`;
  }

  // 500개 전체 데이터 생성
  async generate500Companies() {
    try {
      console.log('🚀 500개 기업 대량 재무데이터 생성 시작...');
      
      // 전체 종목 리스트 가져오기
      const allStocks = StockListService.getUnifiedStockList();
      console.log(`📊 대상 종목: ${allStocks.length}개`);
      
      // 기존 데이터 정리
      console.log('🧹 기존 데이터 정리 중...');
      const deleteResult = await FinancialData.deleteMany({ dataYear: 2025 });
      console.log(`✅ ${deleteResult.deletedCount}개 기존 데이터 삭제`);
      
      let processed = 0;
      let success = 0;
      let failed = 0;
      
      const batchSize = 50; // 배치 크기
      
      // 배치 단위로 처리
      for (let i = 0; i < allStocks.length; i += batchSize) {
        const batch = allStocks.slice(i, i + batchSize);
        console.log(`📦 배치 ${Math.floor(i/batchSize) + 1}/${Math.ceil(allStocks.length/batchSize)}: ${batch.length}개 종목`);
        
        const batchData = [];
        
        // 배치 데이터 준비
        for (const stockCode of batch) {
          try {
            processed++;
            
            // 업종 분류
            const industry = this.classifyStock(stockCode);
            
            // 재무데이터 생성
            const financials = this.generateRealisticFinancials(stockCode, industry);
            
            // 종목명 생성
            const stockName = this.generateStockName(stockCode, industry);
            
            const stockData = {
              stockCode: stockCode,
              corpCode: `gen_${stockCode}`,
              name: stockName,
              year: 2024,
              dataYear: 2025,
              revenue: financials.revenue,
              netIncome: financials.netIncome,
              operatingIncome: Math.round(financials.netIncome * 1.3),
              sharesOutstanding: financials.sharesOutstanding,
              revenueGrowth3Y: financials.revenueGrowth3Y,
              netIncomeGrowth3Y: financials.netIncomeGrowth3Y,
              dataSource: 'ESTIMATED',
              lastUpdated: new Date(),
              isValidated: true,
              notes: `업종: ${industry}, 생성시간: ${new Date().toISOString()}`
            };
            
            batchData.push(stockData);
            
          } catch (error) {
            console.error(`❌ ${stockCode} 데이터 생성 실패:`, error.message);
            failed++;
          }
        }
        
        // 배치 삽입
        try {
          if (batchData.length > 0) {
            await FinancialData.insertMany(batchData);
            success += batchData.length;
            console.log(`✅ 배치 ${Math.floor(i/batchSize) + 1} 삽입 완료: ${batchData.length}개`);
          }
        } catch (error) {
          console.error(`❌ 배치 삽입 실패:`, error.message);
          failed += batchData.length;
        }
        
        // 진행상황 출력
        if ((i + batchSize) % (batchSize * 5) === 0) {
          const progressPercent = ((processed / allStocks.length) * 100).toFixed(1);
          console.log(`📊 진행상황: ${processed}/${allStocks.length} (${progressPercent}%) - 성공: ${success}, 실패: ${failed}`);
        }
      }
      
      console.log(`\n🏁 500개 기업 데이터 생성 완료!`);
      console.log(`📊 최종 결과:`);
      console.log(`   처리: ${processed}개`);
      console.log(`   성공: ${success}개`);
      console.log(`   실패: ${failed}개`);
      console.log(`   성공률: ${((success / processed) * 100).toFixed(1)}%`);
      
      return { processed, success, failed };
      
    } catch (error) {
      console.error('❌ 대량 데이터 생성 실패:', error.message);
      throw error;
    }
  }

  // 생성된 데이터 검증
  async validateGeneratedData() {
    try {
      console.log('\n📊 생성된 데이터 검증 중...');
      
      // 업종별 통계
      const industryStats = await FinancialData.aggregate([
        { $match: { dataYear: 2025 } },
        {
          $group: {
            _id: { $substr: ['$notes', 4, 20] }, // 업종 추출
            count: { $sum: 1 },
            avgRevenue: { $avg: '$revenue' },
            avgGrowth: { $avg: '$revenueGrowth3Y' },
            maxGrowth: { $max: '$revenueGrowth3Y' },
            minGrowth: { $min: '$revenueGrowth3Y' }
          }
        },
        { $sort: { count: -1 } }
      ]);

      console.log('🏭 업종별 통계:');
      industryStats.forEach(stat => {
        console.log(`   ${stat._id}: ${stat.count}개 (평균 매출: ${stat.avgRevenue?.toFixed(0)}억, 평균 성장률: ${stat.avgGrowth?.toFixed(1)}%)`);
      });

      // 슈퍼스톡스 후보 분석
      const conditions = [
        { name: '엄격 조건', minGrowth: 15, maxPSR: 0.75 },
        { name: '현실적 조건', minGrowth: 15, maxPSR: 2.5 },
        { name: '완화 조건', minGrowth: 10, maxPSR: 3.0 }
      ];

      console.log('\n🎯 슈퍼스톡스 후보 예상:');
      for (const condition of conditions) {
        const candidates = await FinancialData.find({
          dataYear: 2025,
          revenueGrowth3Y: { $gte: condition.minGrowth },
          netIncomeGrowth3Y: { $gte: condition.minGrowth },
          revenue: { $gt: 100 }
        });

        console.log(`   ${condition.name}: ${candidates.length}개 후보 (성장률 ≥${condition.minGrowth}%)`);
      }

      // 최고 성장률 TOP 10
      const topGrowthStocks = await FinancialData.find({ dataYear: 2025 })
        .sort({ revenueGrowth3Y: -1 })
        .limit(10);

      console.log('\n🏆 최고 성장률 TOP 10:');
      topGrowthStocks.forEach((stock, index) => {
        console.log(`   ${index + 1}. ${stock.stockCode} ${stock.name}: 매출성장률 ${stock.revenueGrowth3Y}%, 순이익성장률 ${stock.netIncomeGrowth3Y}%`);
      });

    } catch (error) {
      console.error('❌ 데이터 검증 실패:', error.message);
    }
  }
}

// 실행 함수
async function main() {
  const generator = new MassDataGenerator();
  
  try {
    await generator.connectToDatabase();
    
    const mode = process.argv[2] || 'generate';
    
    if (mode === 'generate') {
      console.log('🚀 500개 기업 대량 데이터 생성 시작...');
      console.log('⚠️  이 작업은 2-3분 정도 소요됩니다.');
      
      const result = await generator.generate500Companies();
      await generator.validateGeneratedData();
      
      if (result.success >= 400) {
        console.log('\n🎉 대량 데이터 생성 성공! 이제 대규모 슈퍼스톡스 검색이 가능합니다.');
      } else {
        console.log(`\n⚠️ 일부 실패 (성공: ${result.success}개). 재시도를 고려하세요.`);
      }
      
    } else if (mode === 'validate') {
      await generator.validateGeneratedData();
    } else {
      console.log('\n사용법:');
      console.log('  node mass_data_generator.js generate   # 500개 데이터 생성');
      console.log('  node mass_data_generator.js validate   # 생성된 데이터 검증');
    }
    
  } catch (error) {
    console.error('❌ 실행 실패:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('👋 MongoDB 연결 종료');
  }
}

if (require.main === module) {
  main();
}

module.exports = MassDataGenerator;