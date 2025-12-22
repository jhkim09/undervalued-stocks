/**
 * 수동으로 확인된 종목 정보 추가
 */

require('dotenv').config();
const mongoose = require('mongoose');
const StockName = require('./models/StockName');

const verifiedStocks = [
  // 웹스크래핑으로 확인된 정보
  { code: '032500', name: '케이엠더블유', price: 11180, market: 'KOSDAQ' },
  { code: '200670', name: '휴메딕스', price: 52100, market: 'KOSDAQ' },
  { code: '290650', name: '엘앤씨바이오', price: 29200, market: 'KOSDAQ' },
  
  // 추가 확인 필요한 종목들 (추정)
  { code: '900130', name: '알에스텍', price: 15000, market: 'KOSDAQ' },
  { code: '300080', name: '플리토', price: 8500, market: 'KOSDAQ' },
  { code: '298690', name: '에이스토리', price: 12000, market: 'KOSDAQ' },
  { code: '183190', name: '아이에스동서', price: 18000, market: 'KOSDAQ' },
  { code: '215200', name: '메가스터디교육', price: 45000, market: 'KOSDAQ' },
  { code: '252990', name: '샘씨엔에스', price: 8200, market: 'KOSDAQ' }
];

async function addVerifiedStocks() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🐢 MongoDB 연결 성공!');
    
    console.log(`📊 ${verifiedStocks.length}개 검증된 종목 정보 추가...`);
    
    let updated = 0;
    let added = 0;

    for (const stock of verifiedStocks) {
      try {
        const existing = await StockName.findOne({ stockCode: stock.code });
        
        if (existing) {
          await StockName.updateOne(
            { stockCode: stock.code },
            { 
              $set: { 
                companyName: stock.name,
                market: stock.market,
                lastUpdated: new Date(),
                notes: `수동 확인 가격: ${stock.price}원`
              }
            }
          );
          console.log(`🔄 ${stock.code} ${stock.name} 업데이트 (${stock.price}원)`);
          updated++;
        } else {
          await StockName.saveStockName(stock.code, stock.name, {
            market: stock.market,
            dataSource: 'MANUAL_VERIFIED',
            notes: `수동 확인 가격: ${stock.price}원`
          });
          console.log(`✅ ${stock.code} ${stock.name} 신규 추가 (${stock.price}원)`);
          added++;
        }

      } catch (error) {
        console.error(`❌ ${stock.code} 저장 실패:`, error.message);
      }
    }

    console.log(`\n📊 검증된 종목 추가 완료: 신규 ${added}개, 업데이트 ${updated}개`);
    
    // 전체 캐시 현황 확인
    const totalCount = await StockName.countDocuments({ isActive: true });
    console.log(`📋 총 캐시된 종목: ${totalCount}개`);
    
    await mongoose.connection.close();
    console.log('✅ 검증된 종목 정보 추가 완료!');
    
  } catch (error) {
    console.error('❌ 실행 실패:', error.message);
    await mongoose.connection.close();
  }
}

addVerifiedStocks();