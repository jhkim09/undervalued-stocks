/**
 * 매일 장 마감 후 전 종목 가격/회사명 업데이트
 * Make.com 스케줄러에서 오후 5시에 실행
 */

require('dotenv').config();
const mongoose = require('mongoose');
const StockName = require('./models/StockName');
const StockListService = require('./services/stockListService');

class DailyStockUpdater {
  constructor() {
    this.delay = 800; // 0.8초 대기 (네이버 서버 부하 고려)
    this.batchSize = 20; // 20개씩 배치 처리
    this.maxRetries = 3; // 실패시 재시도
  }

  async connectToDatabase() {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('🐢 MongoDB 연결 성공!');
    } catch (error) {
      console.error('❌ MongoDB 연결 실패:', error.message);
      throw error;
    }
  }

  // 네이버 금융에서 종목 정보 스크래핑 (WebFetch 사용)
  async scrapeStockFromNaver(stockCode, retryCount = 0) {
    try {
      const url = `https://finance.naver.com/item/main.nhn?code=${stockCode}`;
      
      const result = await fetch(url).then(res => res.text());
      
      // 간단한 HTML 파싱으로 정보 추출
      const nameMatch = result.match(/<title>([^<]+)\s*\([0-9]+\)/);
      const priceMatch = result.match(/현재가.*?([0-9,]+)원/);
      
      let companyName = null;
      let currentPrice = null;
      
      if (nameMatch) {
        companyName = nameMatch[1].trim();
      }
      
      if (priceMatch) {
        currentPrice = parseInt(priceMatch[1].replace(/,/g, ''));
      }
      
      if (companyName && currentPrice && currentPrice > 100) {
        console.log(`✅ ${stockCode} 스크래핑 성공: ${companyName}, ${currentPrice}원`);
        return {
          stockCode: stockCode,
          companyName: companyName,
          currentPrice: currentPrice,
          market: stockCode.startsWith('0') || stockCode.startsWith('1') ? 'KOSPI' : 'KOSDAQ',
          scrapedAt: new Date()
        };
      }
      
      console.log(`⚠️ ${stockCode} 정보 부족: name=${!!companyName}, price=${currentPrice}`);
      return null;

    } catch (error) {
      if (retryCount < this.maxRetries) {
        console.log(`🔄 ${stockCode} 재시도 ${retryCount + 1}/${this.maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기 후 재시도
        return await this.scrapeStockFromNaver(stockCode, retryCount + 1);
      }
      
      console.error(`❌ ${stockCode} 스크래핑 실패:`, error.message);
      return null;
    }
  }

  // 전체 종목 일일 업데이트
  async updateAllStocks() {
    try {
      const startTime = Date.now();
      console.log('🚀 전체 종목 일일 업데이트 시작 (장 마감 후)...');
      
      // 전체 종목 리스트
      const allStocks = StockListService.getUnifiedStockList();
      console.log(`📊 업데이트 대상: ${allStocks.length}개 종목`);
      
      const results = {
        total: allStocks.length,
        success: 0,
        failed: 0,
        skipped: 0,
        newNames: 0,
        priceUpdates: 0
      };

      // 배치 단위로 안전하게 처리
      for (let i = 0; i < allStocks.length; i += this.batchSize) {
        const batch = allStocks.slice(i, i + this.batchSize);
        const batchNum = Math.floor(i/this.batchSize) + 1;
        const totalBatches = Math.ceil(allStocks.length/this.batchSize);
        
        console.log(`📦 배치 ${batchNum}/${totalBatches}: ${batch.join(', ')}`);

        // 배치 내 순차 처리 (병렬 처리시 차단 위험)
        for (const stockCode of batch) {
          try {
            const stockInfo = await this.scrapeStockFromNaver(stockCode);
            
            if (stockInfo) {
              // StockName 컬렉션에 저장/업데이트
              const existing = await StockName.findOne({ stockCode: stockCode });
              
              if (existing) {
                await StockName.updateOne(
                  { stockCode: stockCode },
                  { 
                    $set: {
                      companyName: stockInfo.companyName,
                      market: stockInfo.market,
                      lastUpdated: new Date(),
                      notes: `일일업데이트: ${stockInfo.currentPrice}원 (${stockInfo.scrapedAt.toISOString()})`
                    }
                  }
                );
                results.priceUpdates++;
              } else {
                await StockName.saveStockName(stockCode, stockInfo.companyName, {
                  market: stockInfo.market,
                  dataSource: 'NAVER_DAILY',
                  notes: `일일업데이트: ${stockInfo.currentPrice}원`
                });
                results.newNames++;
              }
              
              results.success++;
            } else {
              results.failed++;
            }

            // 요청 간 대기 (네이버 서버 보호)
            await new Promise(resolve => setTimeout(resolve, this.delay));

          } catch (error) {
            console.error(`❌ ${stockCode} 업데이트 실패:`, error.message);
            results.failed++;
          }
        }

        // 배치 간 대기 및 진행상황 출력
        const progress = ((i + batch.length) / allStocks.length * 100).toFixed(1);
        console.log(`📊 진행률: ${progress}% (성공: ${results.success}, 실패: ${results.failed})`);
        
        if (i + this.batchSize < allStocks.length) {
          console.log('⏳ 배치 간 5초 대기...');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      const endTime = Date.now();
      const totalTime = ((endTime - startTime) / 1000 / 60).toFixed(1);

      console.log('\n🏁 일일 업데이트 완료!');
      console.log(`📊 최종 결과:`);
      console.log(`   총 처리: ${results.total}개`);
      console.log(`   성공: ${results.success}개`);
      console.log(`   실패: ${results.failed}개`);
      console.log(`   신규 회사명: ${results.newNames}개`);
      console.log(`   가격 업데이트: ${results.priceUpdates}개`);
      console.log(`   소요시간: ${totalTime}분`);
      console.log(`   성공률: ${((results.success/results.total)*100).toFixed(1)}%`);

      return results;

    } catch (error) {
      console.error('❌ 일일 업데이트 실패:', error.message);
      throw error;
    }
  }

  // 주요 종목만 빠른 업데이트 (5분 이내)
  async updateMajorStocksOnly() {
    try {
      console.log('⚡ 주요 종목 빠른 업데이트...');
      
      const majorStocks = [
        '005930', '000660', '035420', '005380', '000270', // 코스피 TOP 5
        '251270', '036570', '352820', '326030', '259960', // 코스닥 TOP 5
        '032500', '200670', '290650', '141080', '328130'  // 현재 신호 종목들
      ];

      const results = { total: majorStocks.length, success: 0, failed: 0 };

      for (const stockCode of majorStocks) {
        try {
          const stockInfo = await this.scrapeStockFromNaver(stockCode);
          
          if (stockInfo) {
            await StockName.saveStockName(stockCode, stockInfo.companyName, {
              market: stockInfo.market,
              dataSource: 'NAVER_MAJOR',
              notes: `주요종목 업데이트: ${stockInfo.currentPrice}원`
            });
            results.success++;
          } else {
            results.failed++;
          }

          await new Promise(resolve => setTimeout(resolve, 500)); // 0.5초 대기

        } catch (error) {
          console.error(`❌ ${stockCode} 업데이트 실패:`, error.message);
          results.failed++;
        }
      }

      console.log(`⚡ 주요 종목 업데이트 완료: 성공 ${results.success}개, 실패 ${results.failed}개`);
      return results;

    } catch (error) {
      console.error('❌ 주요 종목 업데이트 실패:', error.message);
      throw error;
    }
  }
}

// 실행 스크립트
async function main() {
  const updater = new DailyStockUpdater();
  
  try {
    await updater.connectToDatabase();
    
    const mode = process.argv[2] || 'major';
    
    if (mode === 'all') {
      console.log('🔥 전체 종목 일일 업데이트 (30-60분 소요)');
      await updater.updateAllStocks();
    } else if (mode === 'major') {
      console.log('⚡ 주요 종목만 빠른 업데이트 (5분 소요)');
      await updater.updateMajorStocksOnly();
    } else {
      console.log('\n사용법:');
      console.log('  node daily_stock_update.js major  # 주요 종목만 (5분)');
      console.log('  node daily_stock_update.js all    # 전체 종목 (30-60분)');
    }
    
  } catch (error) {
    console.error('❌ 일일 업데이트 실행 실패:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('👋 MongoDB 연결 종료');
  }
}

if (require.main === module) {
  main();
}

module.exports = DailyStockUpdater;