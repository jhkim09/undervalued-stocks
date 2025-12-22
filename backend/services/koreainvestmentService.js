const axios = require('axios');

class KoreaInvestmentService {
  
  constructor() {
    this.baseURL = 'https://openapi.koreainvestment.com:9443';
    this.appKey = process.env.KIS_APP_KEY || '';
    this.appSecret = process.env.KIS_APP_SECRET || '';
    this.accessToken = '';
    this.isConnected = false;
    this.cache = new Map();
  }
  
  // OAuth 인증
  async authenticate() {
    try {
      console.log('🔐 한국투자증권 API 인증 시작...');
      
      const response = await axios.post(`${this.baseURL}/oauth2/tokenP`, {
        grant_type: 'client_credentials',
        appkey: this.appKey,
        appsecret: this.appSecret
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.access_token) {
        this.accessToken = response.data.access_token;
        this.isConnected = true;
        console.log('✅ 한국투자증권 API 인증 성공');
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error('❌ 한국투자증권 API 인증 실패:', error.message);
      return false;
    }
  }
  
  // 현재가 조회 (정확한 실시간 데이터)
  async getCurrentPrice(symbol) {
    try {
      if (!this.isConnected) {
        console.log('⚠️ 한투 API 미연결, 인증 시도...');
        await this.authenticate();
      }
      
      if (!this.isConnected) {
        throw new Error('한국투자증권 API 인증 필요');
      }
      
      // 캐시 확인 (1분간 유효)
      const cacheKey = `price_${symbol}`;
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < 60 * 1000) {
          return cached.price;
        }
      }
      
      // 한국투자증권 현재가 조회 API
      const response = await axios.get(`${this.baseURL}/uapi/domestic-stock/v1/quotations/inquire-price`, {
        headers: {
          'Content-Type': 'application/json',
          'authorization': `Bearer ${this.accessToken}`,
          'appkey': this.appKey,
          'appsecret': this.appSecret,
          'tr_id': 'FHKST01010100'
        },
        params: {
          'fid_cond_mrkt_div_code': 'J', // 주식시장구분 (J:주식)
          'fid_input_iscd': symbol
        }
      });
      
      if (response.data.rt_cd === '0' && response.data.output) {
        const currentPrice = parseInt(response.data.output.stck_prpr);
        
        // 캐시 저장
        this.cache.set(cacheKey, {
          price: currentPrice,
          timestamp: Date.now()
        });
        
        console.log(`✅ 한투 API ${symbol} 현재가: ${currentPrice.toLocaleString()}원`);
        return currentPrice;
      }
      
      throw new Error('현재가 데이터 없음');
      
    } catch (error) {
      console.error(`한투 API 현재가 조회 실패 (${symbol}):`, error.message);
      return null;
    }
  }
  
  // 연결 상태 확인
  isConnectedToKis() {
    return this.isConnected;
  }
  
  // 캐시 초기화
  clearCache() {
    this.cache.clear();
  }
}

module.exports = new KoreaInvestmentService();