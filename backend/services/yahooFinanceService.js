const axios = require('axios');

class YahooFinanceService {
  
  constructor() {
    this.baseURL = 'https://query1.finance.yahoo.com';
    this.cache = new Map(); // 캐시로 API 호출 최소화
    this.rateLimitDelay = 100; // API 호출 간격 (밀리초)
  }
  
  // 한국 주식 코드 변환 (005930 → 005930.KS)
  convertToYahooSymbol(koreanSymbol) {
    return `${koreanSymbol}.KS`;
  }
  
  // 일봉 차트 데이터 조회
  async getDailyChartData(symbol, days = 60) {
    try {
      const yahooSymbol = this.convertToYahooSymbol(symbol);
      const cacheKey = `chart_${yahooSymbol}_${days}`;
      
      // 캐시 확인 (5분간 유효)
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < 5 * 60 * 1000) {
          return cached.data;
        }
      }
      
      // 기간 설정 (현재부터 과거로 - 여유분 추가)
      const endDate = Math.floor(Date.now() / 1000);
      const startDate = endDate - ((days + 30) * 24 * 60 * 60); // days + 30일 전 (주말/공휴일 고려)
      
      const url = `${this.baseURL}/v8/finance/chart/${yahooSymbol}`;
      
      const response = await axios.get(url, {
        params: {
          range: '1mo', // 1개월 데이터 (약 30일, 20일 분석용)
          interval: '1d',
          includePrePost: false,
          events: 'div,splits'
        },
        timeout: 10000 // 10초 타임아웃
      });
      
      if (response.data.chart?.result?.[0]) {
        const result = response.data.chart.result[0];
        const timestamps = result.timestamp || [];
        const quotes = result.indicators?.quote?.[0] || {};
        
        const dailyData = timestamps.map((timestamp, index) => ({
          date: new Date(timestamp * 1000).toISOString().split('T')[0],
          open: Math.round(quotes.open?.[index] || 0),
          high: Math.round(quotes.high?.[index] || 0),
          low: Math.round(quotes.low?.[index] || 0),
          close: Math.round(quotes.close?.[index] || 0),
          volume: quotes.volume?.[index] || 0
        }))
        .filter(item => item.close > 0) // 유효한 데이터만
        .sort((a, b) => new Date(b.date) - new Date(a.date)); // 최신순 정렬 (최신이 [0])
        
        // 캐시 저장
        this.cache.set(cacheKey, {
          data: dailyData,
          timestamp: Date.now()
        });
        
        console.log(`✅ Yahoo Finance: ${symbol} 일봉 데이터 ${dailyData.length}개 조회 성공`);
        return dailyData;
        
      } else {
        throw new Error('차트 데이터가 없습니다');
      }
      
    } catch (error) {
      console.error(`Yahoo Finance 일봉 조회 실패 (${symbol}):`, error.message);
      return null;
    }
  }
  
  // 현재가 조회
  async getCurrentPrice(symbol) {
    try {
      const yahooSymbol = this.convertToYahooSymbol(symbol);
      const cacheKey = `price_${yahooSymbol}`;
      
      // 캐시 확인 (1분간 유효)
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < 60 * 1000) {
          return cached.data;
        }
      }
      
      const url = `${this.baseURL}/v8/finance/chart/${yahooSymbol}`;
      
      const response = await axios.get(url, {
        params: {
          range: '1d',
          interval: '1m'
        },
        timeout: 5000
      });
      
      if (response.data.chart?.result?.[0]) {
        const result = response.data.chart.result[0];
        const currentPrice = result.meta?.regularMarketPrice || result.meta?.previousClose;
        
        if (currentPrice) {
          const price = Math.round(currentPrice);
          
          // 캐시 저장
          this.cache.set(cacheKey, {
            data: price,
            timestamp: Date.now()
          });
          
          return price;
        }
      }
      
      throw new Error('현재가 데이터가 없습니다');
      
    } catch (error) {
      console.error(`Yahoo Finance 현재가 조회 실패 (${symbol}):`, error.message);
      return null;
    }
  }
  
  // 여러 종목 배치 조회 (성능 최적화)
  async getBatchDailyData(symbols, days = 60) {
    const batchSize = 5; // 동시 요청 수 제한
    const results = {};
    
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (symbol) => {
        const data = await this.getDailyChartData(symbol, days);
        return { symbol, data };
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      batchResults.forEach(({ symbol, data }) => {
        results[symbol] = data;
      });
      
      // Rate limiting
      if (i + batchSize < symbols.length) {
        await this.delay(this.rateLimitDelay);
      }
    }
    
    return results;
  }
  
  // 주식 기본 정보 조회 (상장주식수 포함) - 차트 API 사용
  async getStockInfo(symbol) {
    try {
      const yahooSymbol = this.convertToYahooSymbol(symbol);
      const cacheKey = `info_${yahooSymbol}`;
      
      // 캐시 확인 (1시간 유효)
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < 60 * 60 * 1000) {
          return cached.data;
        }
      }
      
      await this.delay(this.rateLimitDelay);
      
      // 차트 API로 메타데이터 조회 (401 오류 없는 방법)
      const response = await axios.get(`${this.baseURL}/v8/finance/chart/${yahooSymbol}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        params: {
          range: '1y',
          interval: '1d'
        },
        timeout: 10000
      });
      
      const result = response.data?.chart?.result?.[0];
      if (result) {
        const meta = result.meta || {};
        
        // 알려진 대형주 시가총액으로 상장주식수 추정
        const knownMarketCaps = {
          '005930': 841000000000000, // 삼성전자 약 841조원
          '000660': 195000000000000, // SK하이닉스 약 195조원
          '035420': 37000000000000,  // NAVER 약 37조원
          '005380': 63000000000000,  // 현대차 약 63조원
          '012330': 34000000000000   // 현대모비스 약 34조원
        };
        
        const currentPrice = meta.regularMarketPrice || meta.previousClose || 0;
        let estimatedShares = null;
        let estimatedMarketCap = null;
        
        if (knownMarketCaps[symbol] && currentPrice > 0) {
          estimatedShares = Math.round(knownMarketCaps[symbol] / currentPrice);
          estimatedMarketCap = knownMarketCaps[symbol];
        }
        
        const stockInfo = {
          sharesOutstanding: meta.sharesOutstanding || estimatedShares,
          marketCap: meta.marketCap || estimatedMarketCap,
          forwardPE: null, // 차트 API에서는 제공되지 않음
          trailingPE: null,
          priceToSalesTrailing12Months: null,
          totalRevenue: null, // 별도 API 필요
          totalCash: null,
          // 차트에서 가져올 수 있는 추가 정보
          fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
          currency: meta.currency,
          exchangeName: meta.exchangeName
        };
        
        console.log(`📊 ${symbol} Yahoo 정보: 상장주식수 ${stockInfo.sharesOutstanding?.toLocaleString() || 'N/A'}주, 시총 ${(stockInfo.marketCap/1000000000000)?.toFixed(0) || 'N/A'}조원`);
        
        // 캐시 저장
        this.cache.set(cacheKey, {
          data: stockInfo,
          timestamp: Date.now()
        });
        
        return stockInfo;
      }
      
      return null;
      
    } catch (error) {
      console.error(`Yahoo Finance 주식정보 조회 실패 (${symbol}):`, error.message);
      return null;
    }
  }
  
  // Rate limit을 위한 지연 함수
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // 캐시 초기화
  clearCache() {
    this.cache.clear();
  }
  
  // 52주 신고가/신저가 조회
  async get52WeekHighLow(symbol) {
    try {
      const yahooSymbol = this.convertToYahooSymbol(symbol);
      const cacheKey = `52week_${yahooSymbol}`;
      
      // 캐시 확인 (1시간간 유효)
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < 60 * 60 * 1000) {
          return cached.data;
        }
      }
      
      const url = `${this.baseURL}/v8/finance/chart/${yahooSymbol}`;
      
      const response = await axios.get(url, {
        params: {
          range: '1y', // 1년 데이터
          interval: '1d'
        },
        timeout: 10000
      });
      
      if (response.data.chart?.result?.[0]) {
        const result = response.data.chart.result[0];
        const quotes = result.indicators?.quote?.[0] || {};
        const highs = quotes.high || [];
        const lows = quotes.low || [];
        
        const week52High = Math.max(...highs.filter(h => h != null));
        const week52Low = Math.min(...lows.filter(l => l != null));
        
        const highLowData = {
          symbol: symbol,
          week52High: Math.round(week52High),
          week52Low: Math.round(week52Low),
          dataPoints: highs.length
        };
        
        // 캐시 저장
        this.cache.set(cacheKey, {
          data: highLowData,
          timestamp: Date.now()
        });
        
        console.log(`✅ Yahoo Finance: ${symbol} 52주 신고가 ${week52High}원, 신저가 ${week52Low}원`);
        return highLowData;
      }
      
      throw new Error('52주 데이터가 없습니다');
      
    } catch (error) {
      console.error(`Yahoo Finance 52주 조회 실패 (${symbol}):`, error.message);
      return null;
    }
  }
  
  // 연결 테스트
  async testConnection(symbol = '005930') {
    try {
      const price = await this.getCurrentPrice(symbol);
      const chartData = await this.getDailyChartData(symbol, 5);
      const highLow = await this.get52WeekHighLow(symbol);
      
      return {
        success: true,
        symbol: symbol,
        currentPrice: price,
        chartDataLength: chartData?.length || 0,
        week52High: highLow?.week52High || 0,
        week52Low: highLow?.week52Low || 0,
        message: 'Yahoo Finance 연결 성공'
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }
}

module.exports = new YahooFinanceService();