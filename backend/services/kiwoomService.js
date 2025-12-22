const axios = require('axios');

class KiwoomService {
  
  constructor() {
    this.isConnected = false;
    this.accountNumber = '';
    this.accessToken = '';
    this.baseURL = 'https://api.kiwoom.com'; // 실서버
    this.mockURL = 'https://mockapi.kiwoom.com'; // 모의투자서버
    this.useMock = false; // 실서버 사용
  }
  
  // 주식 기본정보 조회 (ka10001) - 신규 추가
  async getStockInfo(stockCode) {
    try {
      if (!this.isConnected) {
        console.log(`🔐 ${stockCode} 조회를 위한 키움 API 인증 필요...`);
        const authenticated = await this.authenticate(
          process.env.KIWOOM_APP_KEY, 
          process.env.KIWOOM_SECRET_KEY
        );
        if (!authenticated) {
          throw new Error('키움 API 인증 실패');
        }
      }

      console.log(`📊 ${stockCode} 키움 REST API로 주식정보 조회...`);

      const url = `${this.useMock ? this.mockURL : this.baseURL}/v1/market/trade/ka10001`;
      
      const response = await axios.post(url, {
        stk_cd: stockCode.padStart(6, '0') // 6자리 종목코드
      }, {
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'Authorization': `Bearer ${this.accessToken}`,
          'appkey': process.env.KIWOOM_APP_KEY,
          'appsecret': process.env.KIWOOM_SECRET_KEY,
          'custtype': 'P', // 개인
          'tr_id': 'ka10001', // 주식기본정보
          'tr_cont': 'N' // 연속조회 없음
        },
        timeout: 10000
      });

      if (response.data && response.data.output) {
        const stockData = response.data.output;
        
        // 주요 정보 추출 (정확한 필드명 사용)
        const result = {
          stockCode: stockCode,
          name: stockData.hts_kor_isnm || stockData.krlnm || '종목명없음', // 종목명
          currentPrice: parseInt(stockData.cur_prc || '0'), // 현재가/종가
          basePrice: parseInt(stockData.base_pric || '0'), // 기준가
          openPrice: parseInt(stockData.open_pric || '0'), // 시가  
          highPrice: parseInt(stockData.high_pric || '0'), // 고가
          lowPrice: parseInt(stockData.low_pric || '0'), // 저가
          marketCap: parseInt(stockData.mktcap || '0'), // 시가총액 (억원)
          sharesOutstanding: parseInt(stockData.lstn_stcn || '0'), // 상장주식수
          per: parseFloat(stockData.per || '0'), // PER
          eps: parseInt(stockData.eps || '0'), // EPS
          pbr: parseFloat(stockData.pbr || '0'), // PBR
          roe: parseFloat(stockData.roe || '0'), // ROE
          volume: parseInt(stockData.acml_vol || '0'), // 거래량
          changeRate: parseFloat(stockData.prdy_ctrt || '0'), // 등락률
          changePrice: parseInt(stockData.prdy_vrss || '0'), // 등락가
          upperLimit: parseInt(stockData.upl_pric || '0'), // 상한가
          lowerLimit: parseInt(stockData.lst_pric || '0'), // 하한가
          dataSource: 'KIWOOM_REST',
          timestamp: new Date().toISOString()
        };

        console.log(`✅ ${stockCode} 키움 정보: ${result.name}, 현재가 ${result.currentPrice}원, 시총 ${result.marketCap}억원, 상장주식수 ${result.sharesOutstanding?.toLocaleString()}주`);
        
        return result;
      }

      console.log(`❌ ${stockCode} 키움 API 응답 데이터 없음`);
      return null;

    } catch (error) {
      console.error(`❌ ${stockCode} 키움 주식정보 조회 실패:`, error.message);
      
      if (error.response) {
        console.error(`   HTTP ${error.response.status}:`, error.response.data);
      }
      
      return null;
    }
  }

  // 다중 종목 정보 일괄 조회 (배치 처리)
  async getBulkStockInfo(stockCodes, batchSize = 10) {
    try {
      console.log(`🚀 키움 REST API로 ${stockCodes.length}개 종목 일괄 조회...`);
      
      const results = new Map();
      const errors = [];

      // 배치 단위로 처리
      for (let i = 0; i < stockCodes.length; i += batchSize) {
        const batch = stockCodes.slice(i, i + batchSize);
        console.log(`📦 배치 ${Math.floor(i/batchSize) + 1}/${Math.ceil(stockCodes.length/batchSize)} (${batch.length}개 종목)`);

        const batchPromises = batch.map(async (stockCode) => {
          try {
            const stockInfo = await this.getStockInfo(stockCode);
            return { stockCode, data: stockInfo, error: null };
          } catch (error) {
            return { stockCode, data: null, error: error.message };
          }
        });

        const batchResults = await Promise.all(batchPromises);

        // 결과 처리
        batchResults.forEach(result => {
          if (result.data) {
            results.set(result.stockCode, result.data);
          } else {
            errors.push({ stockCode: result.stockCode, error: result.error });
          }
        });

        // API Rate Limit 고려 (배치 간 대기)
        if (i + batchSize < stockCodes.length) {
          console.log('⏳ 1초 대기...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log(`✅ 키움 일괄 조회 완료: 성공 ${results.size}개, 실패 ${errors.length}개`);

      return {
        successes: results,
        failures: errors,
        summary: {
          total: stockCodes.length,
          success: results.size,
          failed: errors.length,
          successRate: ((results.size / stockCodes.length) * 100).toFixed(1) + '%'
        }
      };

    } catch (error) {
      console.error('❌ 키움 일괄 조회 실패:', error.message);
      throw error;
    }
  }

  // 경량 현재가 조회 (가격 정보만)
  async getCurrentPriceOnly(stockCode) {
    try {
      if (!this.isConnected) {
        const authenticated = await this.authenticate(
          process.env.KIWOOM_APP_KEY, 
          process.env.KIWOOM_SECRET_KEY
        );
        if (!authenticated) return null;
      }

      const url = `${this.useMock ? this.mockURL : this.baseURL}/v1/market/trade/ka10001`;
      
      const response = await axios.post(url, {
        stk_cd: stockCode.padStart(6, '0')
      }, {
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'Authorization': `Bearer ${this.accessToken}`,
          'appkey': process.env.KIWOOM_APP_KEY,
          'appsecret': process.env.KIWOOM_SECRET_KEY,
          'custtype': 'P',
          'tr_id': 'ka10001',
          'tr_cont': 'N'
        },
        timeout: 5000 // 짧은 타임아웃
      });

      // 키움 API 응답 구조 확인
      console.log(`🔍 ${stockCode} 키움 API 응답 구조:`, JSON.stringify(response.data, null, 2));

      if (response.data?.output) {
        const stockData = response.data.output;
        
        // 여러 가격 필드 시도
        const priceFields = ['cur_prc', 'stck_prpr', 'prpr', 'price', 'close', 'last_price'];
        let currentPrice = null;
        
        for (const field of priceFields) {
          if (stockData[field] && parseInt(stockData[field]) > 0) {
            currentPrice = parseInt(stockData[field]);
            console.log(`💰 ${stockCode} 키움 종가 (${field}): ${currentPrice}원`);
            break;
          }
        }
        
        if (currentPrice) {
          return currentPrice;
        } else {
          console.log(`⚠️ ${stockCode} 모든 가격 필드 확인 결과 없음:`, Object.keys(stockData));
        }
      }

      return null;
    } catch (error) {
      console.log(`⚠️ ${stockCode} 키움 가격 조회 실패: ${error.message}`);
      return null;
    }
  }

  // 다중 종목 현재가 고속 조회 (가격만)
  async getBulkCurrentPrices(stockCodes, batchSize = 10) {
    try {
      console.log(`💰 키움 API로 ${stockCodes.length}개 종목 현재가 고속 조회...`);
      
      const results = new Map();
      
      // 작은 배치로 빠른 처리
      for (let i = 0; i < stockCodes.length; i += batchSize) {
        const batch = stockCodes.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (stockCode) => {
          const price = await this.getCurrentPriceOnly(stockCode);
          return { stockCode, price };
        });

        const batchResults = await Promise.all(batchPromises);
        
        batchResults.forEach(result => {
          if (result.price) {
            results.set(result.stockCode, result.price);
          }
        });

        // 짧은 대기
        if (i + batchSize < stockCodes.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      console.log(`✅ 키움 가격 조회 완료: ${results.size}개 성공`);
      return results;

    } catch (error) {
      console.error('❌ 키움 대량 가격 조회 실패:', error.message);
      return new Map();
    }
  }

  // OAuth 2.0 토큰 발급
  async authenticate(appKey, secretKey) {
    try {
      console.log('🔐 키움 API 인증 시작...');
      
      // 서버 IP 확인
      try {
        const ipResponse = await axios.get('https://api.ipify.org?format=json');
        console.log('🌍 현재 서버 IP:', ipResponse.data.ip);
      } catch (ipError) {
        console.log('⚠️ IP 조회 실패:', ipError.message);
      }
      
      const url = `${this.useMock ? this.mockURL : this.baseURL}/oauth2/token`;
      
      // JSON 형태로 데이터 준비
      const data = {
        grant_type: 'client_credentials',
        appkey: appKey,
        secretkey: secretKey
      };
      
      const response = await axios.post(url, data, {
        headers: {
          'Content-Type': 'application/json;charset=UTF-8'
        }
      });
      
      if (response.data.token) {
        this.accessToken = response.data.token;
        this.isConnected = true;
        console.log('✅ 키움 API 인증 성공');
        console.log('📅 토큰 만료:', response.data.expires_dt);
        return true;
      } else {
        console.log('📋 응답 데이터:', response.data);
        throw new Error('토큰 발급 실패');
      }
      
    } catch (error) {
      console.error('❌ 키움 API 인증 실패:', error.message);
      if (error.response) {
        console.error('📋 에러 응답:', error.response.status, error.response.data);
      }
      this.isConnected = false;
      
      // 인증 실패시 시뮬레이션 모드로 전환
      console.log('📊 시뮬레이션 모드로 전환');
      return false;
    }
  }
  
  // 키움 OpenAPI Plus 연결
  async connect(accountNumber, appKey, secretKey) {
    try {
      console.log('🔗 키움 API 연결 시도...');
      
      this.accountNumber = accountNumber;
      
      // 토큰 인증 시도
      const authSuccess = await this.authenticate(appKey, secretKey);
      
      if (authSuccess) {
        console.log('✅ 키움 API 연결 성공');
      } else {
        console.log('⚠️ 시뮬레이션 모드로 실행');
      }
      
      return authSuccess;
      
    } catch (error) {
      console.error('❌ 키움 API 연결 실패:', error);
      this.isConnected = false;
      return false;
    }
  }
  
  // 주식 현재가 조회 (일별주가 API 사용 - 정확한 종가)
  async getCurrentPrice(symbol) {
    try {
      if (!this.isConnected) {
        return this.getSimulationPrice(symbol);
      }
      
      // 키움 일별주가 조회 API (ka10086) - 정확한 당일 종가
      const url = `${this.useMock ? this.mockURL : this.baseURL}/api/dostk/mrkcond`;
      
      // 오늘 날짜 (YYYYMMDD)
      const today = new Date();
      const queryDate = today.getFullYear().toString() + 
                       (today.getMonth() + 1).toString().padStart(2, '0') + 
                       today.getDate().toString().padStart(2, '0');
      
      const response = await axios.post(url, {
        stk_cd: symbol,
        qry_dt: queryDate,
        indc_tp: '0'
      }, {
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'authorization': `Bearer ${this.accessToken}`,
          'cont-yn': 'N',
          'next-key': '',
          'api-id': 'ka10086'
        },
        timeout: 10000
      });
      
      if (response.data.return_code === 0 && response.data.daly_stkpc?.length > 0) {
        // 첫 번째 데이터 (최신일)의 종가
        const latestData = response.data.daly_stkpc[0];
        const closePrice = parseInt(latestData.close_pric.replace(/[+-]/g, ''));
        
        console.log(`✅ 키움 ${symbol} 종가: ${closePrice.toLocaleString()}원 (${latestData.date})`);
        return closePrice;
      } else {
        throw new Error(`키움 일별주가 조회 실패: ${response.data.return_msg}`);
      }
      
    } catch (error) {
      console.error(`키움 가격 조회 실패 (${symbol}):`, error.message);
      return this.getSimulationPrice(symbol);
    }
  }
  
  // 일봉 데이터 조회 (실제 데이터 우선, Yahoo Finance 백업)
  async getDailyData(symbol, days = 55) {
    try {
      // 1. Yahoo Finance에서 실제 일봉 데이터 시도
      const YahooFinanceService = require('./yahooFinanceService');
      const yahooData = await YahooFinanceService.getDailyChartData(symbol, days);
      
      if (yahooData && yahooData.length > 0) {
        console.log(`✅ Yahoo Finance: ${symbol} 실제 일봉 데이터 ${yahooData.length}개 조회`);
        return yahooData;
      }
      
      // 2. 키움 API 시도 (연결된 경우)
      if (this.isConnected) {
        console.log(`🔄 ${symbol} 키움 API 시도...`);
        
        const url = `${this.useMock ? this.mockURL : this.baseURL}/api/dostk/chart`;
        const today = new Date();
        const baseDate = today.toISOString().slice(0, 10).replace(/-/g, '');
        
        const requestBody = {
          stk_cd: symbol,
          base_dt: baseDate,
          upd_stkpc_tp: '1'
        };
        
        const response = await axios.post(url, requestBody, {
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'authorization': `Bearer ${this.accessToken}`,
            'cont-yn': 'N',
            'next-key': '',
            'api-id': 'ka10081'
          }
        });
        
        if (response.data && response.data.return_code === 0) {
          console.log(`✅ 키움 API: ${symbol} 일봉 데이터 조회 성공`);
          
          const chartData = response.data.stk_dt_pole_chart_qry || [];
          
          const dailyData = chartData.slice(0, days).map(item => ({
            date: item.dt,
            open: parseInt(item.open_pric || '0'),
            high: parseInt(item.high_pric || '0'),
            low: parseInt(item.low_pric || '0'),
            close: parseInt(item.cur_prc || '0'),  // 종가는 cur_prc 필드
            volume: parseInt(item.trde_qty || '0')
          })).filter(item => item.close > 0); // 유효하지 않은 데이터 필터링
          
          console.log(`📊 ${symbol} 키움 API 파싱 결과: ${dailyData.length}개 유효 데이터, 최근가 ${dailyData[0]?.close}원`);
          
          if (dailyData.length === 0) {
            console.log(`❌ ${symbol} 키움 API 데이터 파싱 실패 - 모든 가격이 0`);
            throw new Error('키움 API 데이터 파싱 실패');
          }
          
          return dailyData.reverse();
        }
      }
      
      // 3. 실제 데이터 없으면 빈 배열 반환 (시뮬레이션 사용 안함)
      console.log(`⚠️ ${symbol}: 실제 데이터 없음, 분석 제외`);
      return [];
      
    } catch (error) {
      console.error(`일봉 데이터 조회 실패 (${symbol}):`, error.message);
      // 최종 백업: 빈 배열 반환 (시뮬레이션 사용 안함)
      return [];
    }
  }
  
  // 계좌 잔고 조회
  async getAccountBalance() {
    try {
      console.log('🔍 계좌 잔고 조회 시작, 연결상태:', this.isConnected);
      
      // 항상 재인증을 시도하여 토큰 유효성 보장
      console.log('🔐 키움 API 재인증 시도...');
      console.log('🔑 환경변수 확인:', {
        appKey: process.env.KIWOOM_APP_KEY ? '설정됨' : '미설정',
        secretKey: process.env.KIWOOM_SECRET_KEY ? '설정됨' : '미설정'
      });
      
      const authenticated = await this.authenticate(
        process.env.KIWOOM_APP_KEY, 
        process.env.KIWOOM_SECRET_KEY
      );
      
      if (!authenticated) {
        console.log('❌ 키움 API 인증 실패');
        throw new Error('키움 API 연결에 실패했습니다. API 키를 확인하고 다시 시도해주세요.');
      }
      
      // 실제 키움 API 호출 - 계좌평가잔고내역 (kt00018)
      const url = `${this.useMock ? this.mockURL : this.baseURL}/api/dostk/acnt`;
      
      const requestBody = {
        qry_tp: '1', // 조회구분 1:합산, 2:개별
        dmst_stex_tp: 'KRX' // 국내거래소구분 KRX:한국거래소,NXT:넥스트트레이드
      };
      
      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'authorization': `Bearer ${this.accessToken}`,
          'cont-yn': 'N',
          'next-key': '',
          'api-id': 'kt00018'
        }
      });
      
      console.log('📋 키움 API 전체 응답:', JSON.stringify(response.data, null, 2));
      
      if (response.data && response.data.return_code === 0) {
        console.log('✅ 키움 API 성공 응답 수신');
        
        const data = response.data;
        
        // 실제 키움 계좌 데이터 파싱
        const totalAsset = parseInt(data.prsm_dpst_aset_amt || '0'); // 추정예탁자산금액
        const totalEvaluation = parseInt(data.tot_evlt_amt || '0'); // 총평가금액  
        const totalPurchase = parseInt(data.tot_pur_amt || '0'); // 총매입금액
        const cash = totalAsset - totalEvaluation; // 현금 = 총자산 - 평가금액
        
        // 보유종목 정보 (올바른 필드명 사용)
        const positions = (data.acnt_evlt_remn_indv_tot || []).map(item => ({
          symbol: item.stk_cd || '',
          name: item.stk_nm || '',
          quantity: parseInt(item.rmnd_qty || '0'), // 보유수량
          avgPrice: parseInt(item.pur_pric || '0'), // 매입가
          currentPrice: parseInt(item.cur_prc || '0'), // 현재가
          unrealizedPL: parseInt(item.evltv_prft || '0'), // 평가손익
          totalValue: parseInt(item.evlt_amt || '0'), // 평가금액
          profitRate: parseFloat(item.prft_rt || '0'), // 수익률
          entryDate: new Date().toISOString().split('T')[0], // 진입일자 (추정)
          entrySignal: 'MANUAL_BUY' // 수동 매수 (추정)
        })).filter(pos => pos.quantity > 0);
        
        console.log('✅ 실제 키움 계좌 조회 성공');
        console.log(`💰 추정예탁자산: ${totalAsset.toLocaleString()}원`);
        console.log(`💵 현금(추정): ${cash.toLocaleString()}원`);
        console.log(`📈 평가금액: ${totalEvaluation.toLocaleString()}원`);
        console.log(`📊 보유종목: ${positions.length}개`);
        
        return {
          cash: cash,
          totalAsset: totalAsset,
          stockValue: totalEvaluation,
          positions: positions
        };
      } else {
        console.log('📋 키움 계좌 응답:', JSON.stringify(response.data, null, 2));
        throw new Error(`API 오류: ${response.data?.return_msg || '알 수 없는 오류'}`);
      }
      
    } catch (error) {
      console.error('계좌 조회 실패:', error.message);
      if (error.response) {
        console.error('📋 에러 응답:', error.response.status, error.response.data);
      }
      
      // 인증 오류인 경우 재인증 시도
      if (error.message.includes('Token이 유효하지 않습니다') || 
          error.message.includes('인증에 실패했습니다') ||
          (error.response && error.response.status === 401)) {
        console.log('🔄 토큰 만료 감지, 재인증 시도...');
        this.isConnected = false;
        
        try {
          const authenticated = await this.authenticate(
            process.env.KIWOOM_APP_KEY, 
            process.env.KIWOOM_SECRET_KEY
          );
          
          if (authenticated) {
            console.log('✅ 재인증 성공, 계좌 조회 재시도...');
            return await this.getAccountBalance(); // 재귀 호출
          }
        } catch (authError) {
          console.error('❌ 재인증 실패:', authError.message);
        }
      }
      
      // API 오류시 에러 발생
      console.log('❌ 키움 API 호출 오류:', error.message);
      throw new Error(`키움 API 호출에 실패했습니다: ${error.message}`);
    }
  }
  
  // 시뮬레이션 현재가 (실제 API 연동 전까지 사용)
  getSimulationPrice(symbol) {
    const basePrices = {
      '005930': 72500,   // 삼성전자
      '000660': 185000,  // SK하이닉스  
      '035420': 195000,  // NAVER
      '005380': 238500,  // 현대차
      '012330': 250000,  // 현대모비스
      '122870': 45000    // 와이지엔터테인먼트
    };
    
    const basePrice = basePrices[symbol] || 100000;
    const randomChange = (Math.random() - 0.5) * 0.04; // ±2%
    return Math.round(basePrice * (1 + randomChange));
  }
  
  // 시뮬레이션 일봉 데이터 (터틀 신호 발생 가능하도록 개선)
  getSimulationDailyData(symbol, days) {
    const currentPrice = this.getSimulationPrice(symbol);
    const data = [];
    
    // 터틀 신호 생성을 위한 패턴 (30% 확률로 돌파 패턴 생성)
    const generateBreakout = Math.random() < 0.3;
    const breakoutDay = Math.floor(days * 0.7); // 70% 지점에서 돌파
    
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i)); // 오래된 날짜부터
      
      let dayPrice;
      
      if (generateBreakout && i >= breakoutDay) {
        // 돌파 패턴: 최근 20일 최고가 돌파
        const basePrice = currentPrice * 0.85; // 기준 가격
        const breakoutBoost = 1 + (i - breakoutDay) * 0.02; // 점진적 상승
        dayPrice = Math.round(basePrice * breakoutBoost);
      } else {
        // 일반적인 횡보/하락 패턴
        const trendFactor = 1 + (Math.random() - 0.6) * 0.02; // 약간 하락 편향
        dayPrice = Math.round(currentPrice * trendFactor * (0.95 + i * 0.001));
      }
      
      const volatility = 0.015 + Math.random() * 0.015; // 1.5-3% 변동성
      const high = Math.round(dayPrice * (1 + volatility));
      const low = Math.round(dayPrice * (1 - volatility));
      const open = low + Math.round((high - low) * Math.random());
      
      data.push({
        date: date.toISOString().split('T')[0],
        open: open,
        high: high,
        low: low,
        close: dayPrice,
        volume: Math.round(500000 + Math.random() * 3000000)
      });
    }
    
    // 최신 가격을 현재가에 맞춤
    if (data.length > 0) {
      data[data.length - 1].close = currentPrice;
    }
    
    return data; // 이미 시간순 정렬됨
  }
  
  // 실제 키움 API 호출 함수 (나중에 구현)
  async callKiwoomAPI(endpoint, params) {
    // 키움 OpenAPI Plus 호출 로직
    // 현재는 시뮬레이션
    throw new Error('키움 API 실제 연동 준비중');
  }
  
  // 연결 상태 확인
  isConnectedToKiwoom() {
    return this.isConnected;
  }
}

module.exports = new KiwoomService();