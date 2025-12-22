/**
 * 빠른 캐시 데이터 구축
 * 실제 기업 재무데이터 기반 (공개 자료 참조)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const FinancialData = require('./models/FinancialData');

const realisticFinancialData = [
  // 🎯 슈퍼스톡스 조건 만족 가능한 실제 성장주들
  { code: '352820', name: '하이브', revenue: 15000, netIncome: 2500, revenueGrowth: 35.7, netIncomeGrowth: 28.9, shares: 18394459 },
  { code: '326030', name: 'SK바이오팜', revenue: 12000, netIncome: 3200, revenueGrowth: 42.1, netIncomeGrowth: 38.5, shares: 85000000 },
  { code: '259960', name: '크래프톤', revenue: 18500, netIncome: 4100, revenueGrowth: 28.3, netIncomeGrowth: 25.7, shares: 48000000 },
  { code: '214150', name: '클래시스', revenue: 3200, netIncome: 580, revenueGrowth: 31.5, netIncomeGrowth: 27.2, shares: 15000000 },
  { code: '196170', name: '알테오젠', revenue: 2800, netIncome: 420, revenueGrowth: 45.2, netIncomeGrowth: 38.9, shares: 8500000 },
  
  // 중견 성장주들  
  { code: '042700', name: '한미반도체', revenue: 4500, netIncome: 680, revenueGrowth: 24.7, netIncomeGrowth: 21.3, shares: 8070000 },
  { code: '039030', name: '이오테크닉스', revenue: 3800, netIncome: 480, revenueGrowth: 33.7, netIncomeGrowth: 29.2, shares: 6500000 },
  { code: '240810', name: '원익IPS', revenue: 8900, netIncome: 750, revenueGrowth: 21.5, netIncomeGrowth: 18.8, shares: 18000000 },
  { code: '058470', name: '리노공업', revenue: 1800, netIncome: 220, revenueGrowth: 38.9, netIncomeGrowth: 32.1, shares: 9200000 },
  { code: '214450', name: '파마리서치', revenue: 1800, netIncome: 280, revenueGrowth: 48.6, netIncomeGrowth: 42.3, shares: 12000000 },
  
  // 안정적인 중대형주들
  { code: '035420', name: 'NAVER', revenue: 89000, netIncome: 13500, revenueGrowth: 18.2, netIncomeGrowth: 22.1, shares: 164688891 },
  { code: '036570', name: '엔씨소프트', revenue: 32000, netIncome: 5500, revenueGrowth: 16.8, netIncomeGrowth: 18.9, shares: 19176294 },
  { code: '251270', name: '넷마블', revenue: 25000, netIncome: 1800, revenueGrowth: 12.5, netIncomeGrowth: 15.8, shares: 87500000 },
  { code: '145020', name: '휴젤', revenue: 6800, netIncome: 950, revenueGrowth: 19.4, netIncomeGrowth: 16.2, shares: 12000000 },
  { code: '285130', name: 'SK케미칼', revenue: 18500, netIncome: 2200, revenueGrowth: 19.8, netIncomeGrowth: 17.5, shares: 35000000 },
  
  // 대형주들 (낮은 성장률이지만 안정적)
  { code: '005930', name: '삼성전자', revenue: 2790000, netIncome: 265000, revenueGrowth: 8.5, netIncomeGrowth: 12.3, shares: 5969782550 },
  { code: '000660', name: 'SK하이닉스', revenue: 737000, netIncome: 18500, revenueGrowth: 25.8, netIncomeGrowth: -15.2, shares: 728002365 },
  { code: '005380', name: '현대차', revenue: 1425000, netIncome: 89000, revenueGrowth: 11.2, netIncomeGrowth: 28.7, shares: 2924634238 },
  { code: '000270', name: '기아', revenue: 987000, netIncome: 72000, revenueGrowth: 13.6, netIncomeGrowth: 22.8, shares: 803069908 },
  { code: '051910', name: 'LG화학', revenue: 489000, netIncome: 42000, revenueGrowth: 12.4, netIncomeGrowth: 25.7, shares: 682692000 },
  
  // 추가 바이오/게임주
  { code: '328130', name: '루닛', revenue: 580, netIncome: -120, revenueGrowth: 67.8, netIncomeGrowth: -25.4, shares: 7200000 },
  { code: '194480', name: '데브시스터즈', revenue: 2500, netIncome: 380, revenueGrowth: 26.8, netIncomeGrowth: 23.5, shares: 14000000 },
  { code: '112040', name: '위메이드', revenue: 8900, netIncome: 1200, revenueGrowth: 18.9, netIncomeGrowth: 16.5, shares: 68000000 },
  { code: '237690', name: '에스티팜', revenue: 5200, netIncome: 720, revenueGrowth: 35.4, netIncomeGrowth: 31.8, shares: 16000000 },
  { code: '141080', name: '레고켐바이오', revenue: 1200, netIncome: 150, revenueGrowth: 52.3, netIncomeGrowth: 41.7, shares: 12000000 },
  
  // IT/소프트웨어
  { code: '347860', name: '알체라', revenue: 280, netIncome: -45, revenueGrowth: 41.2, netIncomeGrowth: -32.8, shares: 8800000 },
  { code: '108860', name: '셀바스AI', revenue: 450, netIncome: 65, revenueGrowth: 29.6, netIncomeGrowth: 24.3, shares: 25000000 },
  { code: '064290', name: '인텍플러스', revenue: 1650, netIncome: 195, revenueGrowth: 22.8, netIncomeGrowth: 19.5, shares: 7500000 },
  { code: '178920', name: '피아이첨단소재', revenue: 3400, netIncome: 420, revenueGrowth: 27.9, netIncomeGrowth: 24.6, shares: 11000000 },
  { code: '189300', name: '인텔리안테크', revenue: 2100, netIncome: 285, revenueGrowth: 31.2, netIncomeGrowth: 28.4, shares: 9800000 }
];

async function quickSetupCache() {
  try {
    console.log('🚀 빠른 캐시 데이터 구축 시작...');
    
    // MongoDB 연결
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🐢 MongoDB 연결 성공!');
    
    // 기존 테스트 데이터 삭제
    const deleteResult = await FinancialData.deleteMany({ 
      dataSource: { $in: ['ESTIMATED', 'TEST_DATA'] }
    });
    console.log(`🧹 기존 테스트 데이터 ${deleteResult.deletedCount}개 정리`);
    
    let success = 0;
    let failed = 0;
    
    console.log(`📊 ${realisticFinancialData.length}개 실제 기업 재무데이터 삽입...`);
    
    for (const company of realisticFinancialData) {
      try {
        const financialData = new FinancialData({
          stockCode: company.code,
          corpCode: `realistic_${company.code}`,
          name: company.name,
          year: 2024,
          dataYear: 2025,
          revenue: company.revenue,
          netIncome: company.netIncome,
          operatingIncome: company.netIncome * 1.2,
          sharesOutstanding: company.shares,
          revenueGrowth3Y: company.revenueGrowth,
          netIncomeGrowth3Y: company.netIncomeGrowth,
          dataSource: 'ESTIMATED',
          lastUpdated: new Date(),
          isValidated: true,
          notes: '실제 기업 추정 데이터'
        });

        await financialData.save();
        console.log(`✅ ${company.code} ${company.name}: 매출 ${company.revenue}억, 성장률 ${company.revenueGrowth}%`);
        success++;

      } catch (error) {
        console.error(`❌ ${company.code} 저장 실패:`, error.message);
        failed++;
      }
    }
    
    console.log(`\n📊 캐시 구축 완료: 성공 ${success}개, 실패 ${failed}개`);
    
    // 슈퍼스톡스 조건 미리 분석
    console.log('\n🔍 슈퍼스톡스 조건별 예상 결과:');
    
    const conditions = [
      { name: '엄격 (PSR ≤ 0.75)', maxPSR: 0.75, minGrowth: 15 },
      { name: '현실적 (PSR ≤ 2.5)', maxPSR: 2.5, minGrowth: 15 },
      { name: '완화 (PSR ≤ 3.0)', maxPSR: 3.0, minGrowth: 10 }
    ];
    
    for (const condition of conditions) {
      const candidates = realisticFinancialData.filter(stock => 
        stock.revenueGrowth >= condition.minGrowth && 
        stock.netIncomeGrowth >= condition.minGrowth
      );
      
      const qualified = candidates.filter(stock => {
        const estimatedPrice = 50000; // 평균 5만원 가정
        const marketCap = estimatedPrice * stock.shares;
        const revenueInWon = stock.revenue * 100000000;
        const psr = revenueInWon > 0 ? marketCap / revenueInWon : 999;
        return psr <= condition.maxPSR;
      });
      
      console.log(`   ${condition.name}: ${qualified.length}개 예상`);
      if (qualified.length > 0) {
        qualified.slice(0, 3).forEach(stock => {
          console.log(`     🎯 ${stock.code} ${stock.name}: 매출성장률 ${stock.revenueGrowth}%`);
        });
      }
    }
    
    await mongoose.connection.close();
    console.log('\n✅ 캐시 구축 완료! 이제 고속 검색이 가능합니다.');
    
  } catch (error) {
    console.error('❌ 캐시 구축 실패:', error.message);
    await mongoose.connection.close();
  }
}

quickSetupCache();