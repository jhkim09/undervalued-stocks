/**
 * 네이버 금융 종목 정보 스크래핑 서비스
 * 종목코드로 실제 회사명 자동 수집
 */

const StockName = require('../models/StockName');

class NaverStockScraper {
  constructor() {
    this.baseUrl = 'https://finance.naver.com/item/main.nhn';
    this.delay = 1000; // 요청 간 1초 대기
  }

  // 개별 종목 정보 스크래핑 (회사명 + 현재가)
  async scrapeStockInfo(stockCode) {
    try {
      console.log(`🔍 ${stockCode} 네이버 금융에서 정보 조회...`);
      
      const WebFetch = require('../../../WebFetch');
      const url = `${this.baseUrl}?code=${stockCode}`;
      
      const result = await WebFetch(url, `
        이 주식의 정보를 알려주세요:
        1. 정확한 회사명 (종목코드: ${stockCode})
        2. 현재가 또는 전일 종가 (숫자만)
        3. 시장구분 (코스피/코스닥)
        
        응답 형식: 회사명|가격|시장
        예시: 삼성전자|71200|코스피
      `);
      
      if (result) {
        // 파싱 시도 (여러 패턴)
        const patterns = [
          /([가-힣A-Za-z0-9&\(\)]+)\s*[|,]\s*([0-9,]+)\s*[|,]\s*(코스피|코스닥)/,
          /회사명[:\s]*([가-힣A-Za-z0-9&\(\)]+).*가격[:\s]*([0-9,]+)/,
          /([가-힣A-Za-z0-9&\(\)]+).*([0-9,]{4,})원/
        ];
        
        for (const pattern of patterns) {
          const match = result.match(pattern);
          if (match) {
            const companyName = match[1].trim();
            const priceStr = match[2].replace(/,/g, '');
            const price = parseInt(priceStr);
            const market = match[3] === '코스피' ? 'KOSPI' : 'KOSDAQ';
            
            if (companyName && price > 100) {
              console.log(`✅ ${stockCode} 정보: ${companyName}, ${price}원, ${market}`);
              return {
                companyName: companyName,
                currentPrice: price,
                market: market
              };
            }
          }
        }
        
        // 단순 회사명만 추출 시도
        const namePattern = /([가-힣A-Za-z0-9&\(\)]{2,}(?:주식회사|㈜|Inc|Corp|Co|Ltd)?)/;
        const nameMatch = result.match(namePattern);
        
        if (nameMatch) {
          const companyName = nameMatch[1].trim();
          console.log(`📝 ${stockCode} 회사명만 발견: ${companyName}`);
          return {
            companyName: companyName,
            currentPrice: null,
            market: this.guessMarket(stockCode)
          };
        }
      }

      console.log(`❌ ${stockCode} 정보 추출 실패`);
      return null;

    } catch (error) {
      console.error(`❌ ${stockCode} 스크래핑 실패:`, error.message);
      return null;
    }
  }

  // 시장 추정
  guessMarket(stockCode) {
    const firstDigit = stockCode.charAt(0);
    if (['0', '1'].includes(firstDigit)) return 'KOSPI';
    if (['2', '3', '4'].includes(firstDigit)) return 'KOSDAQ';
    return 'KOSDAQ';
  }

  // 여러 종목 배치 스크래핑
  async scrapeBulkStockNames(stockCodes, batchSize = 10) {
    try {
      console.log(`🚀 네이버 금융에서 ${stockCodes.length}개 종목명 스크래핑...`);
      
      const results = new Map();
      let success = 0;
      let failed = 0;

      // 배치 단위로 처리 (너무 빠르면 차단될 수 있음)
      for (let i = 0; i < stockCodes.length; i += batchSize) {
        const batch = stockCodes.slice(i, i + batchSize);
        console.log(`📦 배치 ${Math.floor(i/batchSize) + 1}/${Math.ceil(stockCodes.length/batchSize)}: ${batch.join(', ')}`);

        for (const stockCode of batch) {
          try {
            const companyName = await this.scrapeStockInfo(stockCode);
            
            if (companyName) {
              results.set(stockCode, companyName);
              
              // 즉시 DB에 저장
              await StockName.saveStockName(stockCode, companyName, {
                dataSource: 'NAVER_SCRAPING',
                notes: `스크래핑 일시: ${new Date().toISOString()}`
              });
              
              success++;
            } else {
              failed++;
            }

            // 요청 간 대기 (차단 방지)
            await new Promise(resolve => setTimeout(resolve, this.delay));

          } catch (error) {
            console.error(`❌ ${stockCode} 처리 실패:`, error.message);
            failed++;
          }
        }

        // 배치 간 추가 대기
        if (i + batchSize < stockCodes.length) {
          console.log('⏳ 배치 간 3초 대기...');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      console.log(`✅ 스크래핑 완료: 성공 ${success}개, 실패 ${failed}개`);
      
      return {
        results: results,
        summary: {
          total: stockCodes.length,
          success: success,
          failed: failed,
          successRate: ((success / stockCodes.length) * 100).toFixed(1) + '%'
        }
      };

    } catch (error) {
      console.error('❌ 대량 스크래핑 실패:', error.message);
      throw error;
    }
  }

  // 매핑되지 않은 종목들만 스크래핑
  async scrapeUnmappedStocks() {
    try {
      const StockListService = require('./stockListService');
      const allStocks = StockListService.getUnifiedStockList();
      
      console.log(`📊 전체 ${allStocks.length}개 종목에서 매핑되지 않은 종목 찾기...`);
      
      // 이미 캐시된 종목들 확인
      const existingNames = await StockName.find({ isActive: true });
      const existingCodes = new Set(existingNames.map(stock => stock.stockCode));
      
      // 매핑되지 않은 종목들만 필터링
      const unmappedStocks = allStocks.filter(code => !existingCodes.has(code));
      
      console.log(`🎯 매핑 필요 종목: ${unmappedStocks.length}개`);
      console.log(`📋 이미 매핑됨: ${existingCodes.size}개`);
      
      if (unmappedStocks.length === 0) {
        console.log('✅ 모든 종목이 이미 매핑되어 있습니다!');
        return { success: 0, failed: 0 };
      }

      // 매핑되지 않은 종목들만 스크래핑 (소량씩)
      const result = await this.scrapeBulkStockNames(unmappedStocks.slice(0, 20), 5); // 처음 20개만, 5개씩 배치
      
      return result.summary;

    } catch (error) {
      console.error('❌ 매핑되지 않은 종목 스크래핑 실패:', error.message);
      throw error;
    }
  }
}

module.exports = new NaverStockScraper();