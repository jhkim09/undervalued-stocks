/**
 * 키움 REST API 기반 슈퍼스톡스 분석 서비스
 * DART API 의존도를 줄이고 실시간 데이터 활용
 */

const KiwoomService = require('./kiwoomService');
const FinancialData = require('../models/FinancialData');

class KiwoomSuperstocksService {
  constructor() {
    this.minRevenueGrowth = 15;
    this.minNetIncomeGrowth = 15;
    this.maxPSR = 2.5; // 현실적인 PSR 기준
    this.maxPBR = 3.0; // PBR 조건 추가
    this.minROE = 10; // ROE 조건 추가
  }

  // 키움 API + 캐시 재무데이터 조합 분석
  async analyzeSuperstocksWithKiwoom(stockCodes) {
    try {
      console.log(`🚀 키움 기반 슈퍼스톡스 분석 시작: ${stockCodes.length}개 종목`);
      
      const results = [];
      const batchSize = 5; // 안정적인 배치 크기

      // 배치 단위로 처리
      for (let i = 0; i < stockCodes.length; i += batchSize) {
        const batch = stockCodes.slice(i, i + batchSize);
        console.log(`📦 키움 배치 ${Math.floor(i/batchSize) + 1}/${Math.ceil(stockCodes.length/batchSize)}: ${batch.join(', ')}`);

        const batchPromises = batch.map(async (stockCode) => {
          try {
            return await this.analyzeStockWithKiwoom(stockCode);
          } catch (error) {
            console.error(`${stockCode} 키움 분석 실패:`, error.message);
            return null;
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(r => r !== null));

        // 배치 간 대기
        if (i + batchSize < stockCodes.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // 조건 만족 종목 필터링
      const qualifiedStocks = results.filter(stock => 
        stock && stock.meetsSuperstocksConditions
      );

      console.log(`✅ 키움 기반 분석 완료: ${results.length}개 분석, ${qualifiedStocks.length}개 조건 만족`);

      return {
        totalAnalyzed: results.length,
        qualifiedStocks: qualifiedStocks,
        allResults: results.sort((a, b) => b.totalScore - a.totalScore),
        summary: {
          excellent: results.filter(s => s.grade === 'EXCELLENT').length,
          good: results.filter(s => s.grade === 'GOOD').length,
          qualified: qualifiedStocks.length
        }
      };

    } catch (error) {
      console.error('❌ 키움 기반 슈퍼스톡스 분석 실패:', error.message);
      throw error;
    }
  }

  // 개별 종목 키움 + 캐시 조합 분석
  async analyzeStockWithKiwoom(stockCode) {
    try {
      console.log(`📊 ${stockCode} 키움 + 캐시 조합 분석...`);

      // 1. 키움 REST API로 실시간 데이터 조회
      const kiwoomData = await KiwoomService.getStockInfo(stockCode);
      if (!kiwoomData) {
        console.log(`❌ ${stockCode} 키움 데이터 조회 실패`);
        return null;
      }

      // 2. 캐시된 재무데이터 조회 (성장률 정보)
      const cachedFinancial = await FinancialData.findOne({
        stockCode: stockCode,
        dataYear: 2025
      });

      if (!cachedFinancial) {
        console.log(`⚠️ ${stockCode} 캐시된 재무데이터 없음, 키움 데이터만 사용`);
      }

      // 3. 조합 분석
      const analysis = this.combineKiwoomAndCacheData(kiwoomData, cachedFinancial);
      
      console.log(`📊 ${stockCode} ${analysis.name}: 현재가 ${analysis.currentPrice}원, PSR ${analysis.psr}, PBR ${analysis.pbr}, 등급 ${analysis.grade}`);

      return analysis;

    } catch (error) {
      console.error(`❌ ${stockCode} 키움 조합 분석 실패:`, error.message);
      return null;
    }
  }

  // 키움 데이터와 캐시 재무데이터 조합
  combineKiwoomAndCacheData(kiwoomData, cachedFinancial) {
    // 키움에서 가져온 실시간 정보
    const currentPrice = kiwoomData.currentPrice;
    const marketCap = kiwoomData.marketCap * 100000000; // 억원 → 원
    const sharesOutstanding = kiwoomData.sharesOutstanding;
    const pbr = kiwoomData.pbr;
    const per = kiwoomData.per;
    const roe = kiwoomData.roe;

    // 캐시에서 가져온 성장률 정보 (없으면 추정)
    const revenueGrowth3Y = cachedFinancial?.revenueGrowth3Y || this.estimateGrowthRate(kiwoomData.name);
    const netIncomeGrowth3Y = cachedFinancial?.netIncomeGrowth3Y || this.estimateGrowthRate(kiwoomData.name) * 0.8;
    const revenue = cachedFinancial?.revenue || this.estimateRevenue(marketCap, kiwoomData.name);

    // PSR 계산 (키움 시가총액 활용)
    const revenueInWon = revenue * 100000000;
    const psr = revenueInWon > 0 ? marketCap / revenueInWon : 999;

    // 조건 확인
    const meetsSuperstocksConditions = (
      revenueGrowth3Y >= this.minRevenueGrowth &&
      netIncomeGrowth3Y >= this.minNetIncomeGrowth &&
      psr <= this.maxPSR &&
      pbr <= this.maxPBR &&
      roe >= this.minROE &&
      currentPrice > 1000 // 최소가격
    );

    // 종합 점수 계산
    let totalScore = 0;
    
    // 성장률 점수
    if (revenueGrowth3Y >= 30) totalScore += 30;
    else if (revenueGrowth3Y >= 20) totalScore += 20;
    else if (revenueGrowth3Y >= 15) totalScore += 10;

    if (netIncomeGrowth3Y >= 30) totalScore += 30;
    else if (netIncomeGrowth3Y >= 20) totalScore += 20;
    else if (netIncomeGrowth3Y >= 15) totalScore += 10;

    // 밸류에이션 점수
    if (psr <= 1.0) totalScore += 20;
    else if (psr <= 2.0) totalScore += 15;
    else if (psr <= 2.5) totalScore += 10;

    if (pbr <= 1.5) totalScore += 10;
    else if (pbr <= 2.5) totalScore += 5;

    if (roe >= 20) totalScore += 10;
    else if (roe >= 15) totalScore += 5;

    const grade = totalScore >= 80 ? 'EXCELLENT' : totalScore >= 60 ? 'GOOD' : totalScore >= 40 ? 'FAIR' : 'POOR';

    return {
      symbol: kiwoomData.stockCode,
      name: kiwoomData.name,
      currentPrice: currentPrice,
      marketCap: marketCap,
      sharesOutstanding: sharesOutstanding,
      
      // 밸류에이션 지표 (키움에서)
      per: per,
      pbr: Math.round(pbr * 100) / 100,
      roe: Math.round(roe * 100) / 100,
      psr: Math.round(psr * 1000) / 1000,
      
      // 성장률 (캐시 또는 추정)
      revenue: revenue,
      revenueGrowth3Y: Math.round(revenueGrowth3Y * 100) / 100,
      netIncomeGrowth3Y: Math.round(netIncomeGrowth3Y * 100) / 100,
      
      // 기술적 지표
      volume: kiwoomData.volume,
      changeRate: kiwoomData.changeRate,
      high52w: kiwoomData.high52w,
      low52w: kiwoomData.low52w,
      
      // 분석 결과
      totalScore: totalScore,
      grade: grade,
      meetsSuperstocksConditions: meetsSuperstocksConditions,
      
      // 메타데이터
      dataSource: 'KIWOOM_HYBRID',
      hasFinancialCache: !!cachedFinancial,
      timestamp: new Date().toISOString()
    };
  }

  // 성장률 추정 (업종별)
  estimateGrowthRate(companyName) {
    // 업종별 평균 성장률 추정
    if (companyName.includes('바이오') || companyName.includes('제약')) return 25;
    if (companyName.includes('게임') || companyName.includes('엔터')) return 20;
    if (companyName.includes('IT') || companyName.includes('소프트')) return 18;
    if (companyName.includes('반도체') || companyName.includes('전자')) return 15;
    if (companyName.includes('화학') || companyName.includes('소재')) return 12;
    if (companyName.includes('자동차') || companyName.includes('모비스')) return 10;
    if (companyName.includes('금융') || companyName.includes('은행')) return 8;
    if (companyName.includes('전력') || companyName.includes('유틸')) return 5;
    
    return 12; // 기본값
  }

  // 매출 추정 (시가총액 기반)
  estimateRevenue(marketCapInWon, companyName) {
    // PSR 추정치로 매출 역산
    let estimatedPSR = 2.0; // 기본 PSR
    
    if (companyName.includes('바이오') || companyName.includes('제약')) estimatedPSR = 8.0;
    else if (companyName.includes('게임') || companyName.includes('IT')) estimatedPSR = 4.0;
    else if (companyName.includes('반도체')) estimatedPSR = 2.5;
    else if (companyName.includes('자동차')) estimatedPSR = 0.8;
    else if (companyName.includes('금융')) estimatedPSR = 1.2;

    const estimatedRevenueInWon = marketCapInWon / estimatedPSR;
    return estimatedRevenueInWon / 100000000; // 원 → 억원
  }

  // 주요 종목만 키움 기반 분석
  async quickAnalyzeTopStocks() {
    const majorStocks = [
      '005930', '000660', '035420', '005380', '000270', 
      '051910', '035720', '251270', '036570', '352820',
      '326030', '145020', '042700', '195940', '214150'
    ];

    try {
      console.log(`⚡ 주요 ${majorStocks.length}개 종목 키움 기반 빠른 분석...`);
      
      const result = await this.analyzeSuperstocksWithKiwoom(majorStocks);
      
      console.log('\n🎯 키움 기반 슈퍼스톡스 후보:');
      result.qualifiedStocks.forEach(stock => {
        console.log(`   ${stock.symbol} ${stock.name}: 현재가 ${stock.currentPrice}원, PSR ${stock.psr}, PBR ${stock.pbr}, ROE ${stock.roe}% (${stock.grade})`);
      });

      return result;

    } catch (error) {
      console.error('❌ 주요 종목 빠른 분석 실패:', error.message);
      throw error;
    }
  }
}

module.exports = new KiwoomSuperstocksService();