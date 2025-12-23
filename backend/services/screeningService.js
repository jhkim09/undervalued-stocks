/**
 * 분기별 저평가주식 스크리닝 서비스
 * 시클리컬 가치주 후보군 자동 추출
 */

const undervaluedAnalyzer = require('./undervaluedStocksAnalyzer');
const stockListService = require('./stockListService');
const kiwoomService = require('./kiwoomService');
const emailService = require('./emailService');

class ScreeningService {
  constructor() {
    this.isRunning = false;
    this.lastResult = null;
  }

  /**
   * 전체 종목 스크리닝 실행
   */
  async runFullScreening(options = {}) {
    const {
      market = 'ALL',       // KOSPI, KOSDAQ, ALL
      limit = 0,            // 0 = 전체
      sendEmail = true,     // 이메일 발송 여부
      batchSize = 10        // 배치 크기
    } = options;

    if (this.isRunning) {
      console.log('⚠️ 스크리닝이 이미 진행 중입니다.');
      return null;
    }

    this.isRunning = true;
    const startTime = Date.now();

    console.log('\n' + '='.repeat(60));
    console.log('📊 분기별 저평가주식 스크리닝 시작');
    console.log('='.repeat(60));

    try {
      // 1. 종목 리스트 가져오기
      let stockCodes = stockListService.getUnifiedStockList();
      const stats = stockListService.getStatistics();

      console.log(`📋 전체 종목: ${stats.total}개 (코스피 ${stats.kospi} + 코스닥 ${stats.kosdaq})`);

      // 시장 필터링
      if (market !== 'ALL') {
        stockCodes = stockCodes.filter(code => {
          const firstDigit = code.charAt(0);
          if (market === 'KOSPI') return ['0', '1'].includes(firstDigit);
          if (market === 'KOSDAQ') return ['2', '3'].includes(firstDigit);
          return true;
        });
        console.log(`🔍 ${market} 필터링: ${stockCodes.length}개`);
      }

      // 제한 적용
      if (limit > 0) {
        stockCodes = stockCodes.slice(0, limit);
        console.log(`⚙️ 제한 적용: ${stockCodes.length}개`);
      }

      // 2. 현재가 일괄 조회 (키움 API)
      console.log('\n📈 현재가 조회 중...');
      const stocksWithPrice = await this.fetchPrices(stockCodes, batchSize);
      console.log(`✅ 현재가 조회 완료: ${stocksWithPrice.length}개`);

      if (stocksWithPrice.length === 0) {
        throw new Error('현재가 조회된 종목이 없습니다.');
      }

      // 3. 저평가 분석 실행
      console.log('\n🔬 저평가 분석 중...');
      const analysisResult = await undervaluedAnalyzer.analyzeBulk(stocksWithPrice, {
        batchSize: 5,
        onProgress: (progress) => {
          if (progress.current % 20 === 0) {
            console.log(`   진행: ${progress.current}/${progress.total} (저평가: ${progress.undervalued}개)`);
          }
        }
      });

      // 4. 결과 정리
      const result = {
        undervalued: analysisResult.undervalued,
        summary: {
          total: stocksWithPrice.length,
          analyzed: analysisResult.summary.analyzed,
          failed: analysisResult.summary.failed,
          undervalued: analysisResult.summary.undervalued
        },
        market,
        analyzedAt: new Date().toISOString(),
        duration: Math.round((Date.now() - startTime) / 1000)
      };

      this.lastResult = result;

      // 5. 결과 출력
      console.log('\n' + '='.repeat(60));
      console.log('📊 스크리닝 완료!');
      console.log('='.repeat(60));
      console.log(`   분석 종목: ${result.summary.analyzed}개`);
      console.log(`   저평가 발견: ${result.summary.undervalued}개`);
      console.log(`   소요 시간: ${result.duration}초`);

      if (result.undervalued.length > 0) {
        console.log('\n🎯 저평가 종목:');
        result.undervalued.slice(0, 10).forEach((stock, idx) => {
          console.log(`   ${idx + 1}. ${stock.name} (${stock.stockCode})`);
          console.log(`      PSR: ${stock.PSR?.toFixed(2)} | PBR: ${stock.PBR?.toFixed(2)}`);
          console.log(`      근거: ${stock.undervaluedReasons?.join(', ')}`);
        });

        if (result.undervalued.length > 10) {
          console.log(`   ... 외 ${result.undervalued.length - 10}개`);
        }
      }

      // 6. 이메일 발송
      if (sendEmail && result.undervalued.length > 0) {
        console.log('\n📧 이메일 발송 중...');
        const emailSent = await emailService.sendScreeningReport(result);
        result.emailSent = emailSent;
      }

      return result;

    } catch (error) {
      console.error('❌ 스크리닝 실패:', error.message);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 현재가 일괄 조회
   */
  async fetchPrices(stockCodes, batchSize = 10) {
    const stocksWithPrice = [];
    const failed = [];

    for (let i = 0; i < stockCodes.length; i += batchSize) {
      const batch = stockCodes.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(stockCodes.length / batchSize);

      if (batchNum % 5 === 0 || batchNum === 1) {
        console.log(`   배치 ${batchNum}/${totalBatches}...`);
      }

      const batchPromises = batch.map(async (stockCode) => {
        try {
          const price = await kiwoomService.getCurrentPrice(stockCode);
          if (price && price > 0) {
            return { stockCode, price };
          }
          return null;
        } catch (error) {
          return null;
        }
      });

      const results = await Promise.all(batchPromises);

      results.forEach(result => {
        if (result) {
          stocksWithPrice.push(result);
        }
      });

      // Rate limit
      if (i + batchSize < stockCodes.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return stocksWithPrice;
  }

  /**
   * 마지막 스크리닝 결과 조회
   */
  getLastResult() {
    return this.lastResult;
  }

  /**
   * 스크리닝 상태 조회
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastResult: this.lastResult ? {
        analyzedAt: this.lastResult.analyzedAt,
        undervaluedCount: this.lastResult.summary?.undervalued || 0
      } : null
    };
  }

  /**
   * 스크리닝 상태 리셋 (비상용)
   */
  reset() {
    console.log('⚠️ 스크리닝 상태 수동 리셋');
    this.isRunning = false;
    return { reset: true, isRunning: this.isRunning };
  }
}

module.exports = new ScreeningService();
