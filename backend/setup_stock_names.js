/**
 * 종목명 캐시 초기 설정
 */

require('dotenv').config();
const mongoose = require('mongoose');
const StockNameCacheService = require('./services/stockNameCacheService');

async function setupStockNames() {
  try {
    console.log('🚀 종목명 캐시 초기 설정 시작...');
    
    // MongoDB 연결
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🐢 MongoDB 연결 성공!');
    
    // 종목명 데이터 저장
    const result = await StockNameCacheService.populateStockNames();
    
    console.log(`📊 종목명 캐시 설정 완료:`);
    console.log(`   신규 저장: ${result.saved}개`);
    console.log(`   업데이트: ${result.updated}개`);
    console.log(`   총 처리: ${result.total}개`);
    
    // 캐시 통계 확인
    const stats = await StockNameCacheService.getCacheStats();
    console.log(`\n📋 캐시 통계:`);
    console.log(`   총 종목: ${stats.total}개`);
    console.log(`   메모리 캐시: ${stats.memoryCacheSize}개`);
    
    if (stats.byMarket) {
      stats.byMarket.forEach(market => {
        console.log(`   ${market._id}: ${market.count}개`);
      });
    }
    
    // 테스트 조회
    console.log(`\n🧪 종목명 조회 테스트:`);
    const testCodes = ['032500', '200670', '290650', '900130', '300080'];
    
    for (const code of testCodes) {
      const name = await StockNameCacheService.getStockName(code);
      console.log(`   ${code} → ${name}`);
    }
    
    await mongoose.connection.close();
    console.log('\n✅ 종목명 캐시 설정 완료!');
    
  } catch (error) {
    console.error('❌ 종목명 캐시 설정 실패:', error.message);
    await mongoose.connection.close();
  }
}

setupStockNames();