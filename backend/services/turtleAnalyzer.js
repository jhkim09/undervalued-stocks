const Signal = require('../models/Signal');
const Portfolio = require('../models/Portfolio');
const KiwoomService = require('./kiwoomService');
const FinancialDataCacheService = require('./financialDataCacheService');

class TurtleAnalyzer {
  
  // 메인 분석 함수 - 매일 아침 실행
  static async analyzeMarket(options = {}) {
    try {
      console.log('🐢 터틀 트레이딩 시장 분석 시작...');
      
      const { 
        useFinancialFilter = false, // 재무건전성 필터 사용 여부
        minRevenueGrowth = 10,      // 최소 매출성장률
        maxPSR = 3.0               // 최대 PSR
      } = options;
      
      if (useFinancialFilter) {
        console.log(`🔍 재무건전성 필터 적용: 매출성장률 ≥${minRevenueGrowth}%, PSR ≤${maxPSR}`);
      }
      
      // 1. 관심종목 리스트 가져오기
      const watchlist = await this.getWatchlist();
      
      // 2. 각 종목별 신호 분석
      const signals = [];
      const processedSymbols = new Set(); // 중복 방지
      
      for (const stock of watchlist) {
        if (processedSymbols.has(stock.symbol)) {
          console.log(`⚠️ ${stock.symbol}: 이미 분석된 종목, 건너뜀`);
          continue;
        }
        
        const signal = await this.analyzeStock(stock.symbol, stock.name);
        if (signal) {
          // 재무건전성 필터 적용
          if (useFinancialFilter) {
            const passesFinancialFilter = await this.checkFinancialHealth(
              stock.symbol, 
              signal.currentPrice, 
              minRevenueGrowth, 
              maxPSR
            );
            
            if (passesFinancialFilter) {
              console.log(`✅ ${stock.symbol} 기술적 신호 + 재무건전성 통과`);
              signals.push({
                ...signal,
                hasFinancialData: true,
                financialScore: passesFinancialFilter.score
              });
            } else {
              console.log(`⚠️ ${stock.symbol} 기술적 신호 있지만 재무건전성 미달`);
            }
          } else {
            signals.push(signal);
          }
          processedSymbols.add(stock.symbol);
        }
      }
      
      // 3. 중복 신호 최종 제거
      const uniqueSignals = [];
      const signalSymbols = new Set();
      
      for (const signal of signals) {
        if (!signalSymbols.has(signal.symbol)) {
          uniqueSignals.push(signal);
          signalSymbols.add(signal.symbol);
        }
      }
      
      console.log(`📊 신호 중복 제거: ${signals.length}개 → ${uniqueSignals.length}개`);
      
      // 4. 데이터 부족한 신호 필터링 (리스크 관리 불가능한 신호 제외)
      const validSignals = uniqueSignals.filter(signal => {
        const recommendedAction = signal.recommendedAction;
        
        if (!recommendedAction) return true; // 액션이 없으면 일단 통과
        
        // 손절가가 "데이터 부족" 또는 NaN인 경우 제외
        const stopLossPrice = recommendedAction.risk?.stopLossPrice;
        if (!stopLossPrice || stopLossPrice === '데이터 부족' || stopLossPrice === 'N/A') {
          console.log(`⚠️ ${signal.symbol}: 손절가 데이터 부족으로 제외 (${stopLossPrice})`);
          return false;
        }
        
        // 투자 금액이 "데이터 부족"인 경우 제외  
        const investment = recommendedAction.investment?.actualAmount;
        if (!investment || investment === '데이터 부족' || investment === 'NaN') {
          console.log(`⚠️ ${signal.symbol}: 투자금액 데이터 부족으로 제외 (${investment})`);
          return false;
        }
        
        // ATR/N값이 "데이터 부족"인 경우 제외
        const atr = recommendedAction.technical?.atr;
        if (!atr || atr === '데이터 부족' || isNaN(atr)) {
          console.log(`⚠️ ${signal.symbol}: ATR 데이터 부족으로 제외 (${atr})`);
          return false;
        }
        
        // 코넥스(KONEX) 종목 제외 - 코스피/코스닥만 분석
        const konexStocks = ['216400']; // 인바이츠바이오코아 등 코넥스 종목
        if (konexStocks.includes(signal.symbol)) {
          console.log(`⚠️ ${signal.symbol}: 코넥스(KONEX) 종목으로 제외`);
          return false;
        }
        
        return true;
      });
      
      console.log(`🔍 데이터 검증: ${uniqueSignals.length}개 → ${validSignals.length}개 (데이터 부족 신호 ${uniqueSignals.length - validSignals.length}개 제외)`);
      
      // 5. 검증된 신호만 저장
      await this.saveSignals(validSignals);
      
      console.log(`✅ 분석 완료: ${validSignals.length}개 유효한 신호 발견`);
      return validSignals;
      
    } catch (error) {
      console.error('❌ 시장 분석 실패:', error);
      throw error;
    }
  }
  
  // 개별 종목 분석
  static async analyzeStock(symbol, name) {
    try {
      // 1. 25일 일봉 데이터 + 52주 신고가/신저가 조회 (최적화)
      const priceData = await this.getPriceData(symbol, 25);
      const YahooFinanceService = require('./yahooFinanceService');
      const highLowData = await YahooFinanceService.get52WeekHighLow(symbol);
      
      if (!priceData || priceData.length < 20) {
        console.log(`⚠️ ${symbol}: 실제 일봉 데이터 부족 (${priceData ? priceData.length : 0}일) - 시뮬레이션 데이터 제외됨`);
        return null;
      }
      
      if (!highLowData) {
        console.log(`⚠️ ${symbol}: 52주 신고가/신저가 데이터 없음`);
        return null;
      }
      
      const currentPrice = priceData[0].close;
      
      // 2. 터틀 지표 계산 (38일 일봉 + 52주 신고가/신저가)
      const indicators = this.calculateTurtleIndicators(priceData, highLowData);
      
      // 3. 신호 판단
      const signal = this.generateSignal(symbol, name, currentPrice, indicators, priceData, highLowData);
      
      return signal;
      
    } catch (error) {
      console.error(`❌ ${symbol} 분석 실패:`, error);
      return null;
    }
  }
  
  // 터틀 지표 계산 (38일 일봉 + 52주 신고가/신저가)
  static calculateTurtleIndicators(priceData, highLowData) {
    // 최근 데이터가 배열의 앞쪽에 있다고 가정
    const highs = priceData.map(d => d.high);
    const lows = priceData.map(d => d.low);
    const closes = priceData.map(d => d.close);
    
    // System 1: 20일/10일 고저점 (38일 일봉 데이터 사용)
    const high20 = Math.max(...highs.slice(1, 21));  // 전일까지 20일
    const low10 = Math.min(...lows.slice(1, 11));    // 전일까지 10일
    const low20 = Math.min(...lows.slice(1, 21));    // 전일까지 20일
    
    // System 2: 52주 신고가/신저가 (Yahoo Finance 별도 조회)
    const high52w = highLowData?.week52High || high20; // 52주 신고가
    const low52w = highLowData?.week52Low || low10;   // 52주 신저가
    
    // ATR 계산 (20일)
    const atr = this.calculateATR(priceData.slice(0, 21));
    
    // 거래량 정보
    const volumes = priceData.map(d => d.volume);
    const avgVolume20 = volumes.slice(1, 21).reduce((sum, v) => sum + v, 0) / 20;
    const currentVolume = volumes[0];
    const volumeRatio = currentVolume / avgVolume20;
    
    return {
      high20,
      low10,
      high52w,    // 52주 신고가
      low52w,     // 52주 신저가
      low20,
      atr,
      nValue: atr,
      volume: currentVolume,
      avgVolume20,
      volumeRatio
    };
  }
  
  // ATR (Average True Range) 계산
  static calculateATR(priceData, period = 20) {
    const trueRanges = [];
    
    for (let i = 1; i < priceData.length; i++) {
      const current = priceData[i];
      const previous = priceData[i - 1];
      
      // 데이터 검증
      if (!current || !previous || 
          typeof current.high !== 'number' || typeof current.low !== 'number' ||
          typeof previous.close !== 'number') {
        continue;
      }
      
      const tr1 = current.high - current.low;
      const tr2 = Math.abs(current.high - previous.close);
      const tr3 = Math.abs(current.low - previous.close);
      
      const trueRange = Math.max(tr1, tr2, tr3);
      if (trueRange > 0 && !isNaN(trueRange)) {
        trueRanges.push(trueRange);
      }
    }
    
    // 최소 데이터 확인
    if (trueRanges.length === 0) {
      console.warn('ATR 계산: 유효한 데이터 없음');
      return null; // 데이터 부족 표시
    }
    
    // 20일 평균 (최소 5일 이상 데이터가 있어야 계산)
    const useLength = Math.min(period, trueRanges.length);
    if (useLength < 5) {
      console.warn(`ATR 계산: 데이터 부족 (${useLength}일)`);
      return null; // 데이터 부족 표시
    }
    
    const avgTR = trueRanges.slice(0, useLength).reduce((sum, tr) => sum + tr, 0) / useLength;
    
    // 최종 검증
    if (isNaN(avgTR) || avgTR <= 0) {
      console.warn(`ATR 계산 결과 이상: ${avgTR}`);
      return null; // 계산 불가 표시
    }
    
    return avgTR;
  }
  
  // 신호 생성 (로깅 포함)
  static generateSignal(symbol, name, currentPrice, indicators, priceData, highLowData) {
    const signals = [];
    
    // 분석 로그 생성
    const analysisLog = {
      symbol: symbol,
      name: name,
      currentPrice: currentPrice,
      high20: indicators.high20,
      low10: indicators.low10,
      high52w: indicators.high52w,
      low52w: indicators.low52w,
      low20: indicators.low20,
      atr: indicators.atr,
      volumeRatio: indicators.volumeRatio,
      analysis: {
        system1_20d: currentPrice > indicators.high20 ? 'BREAKOUT' : 'NO_SIGNAL',
        system1_10d: currentPrice < indicators.low10 ? 'BREAKDOWN' : 'NO_SIGNAL',
        system2_52w: currentPrice > indicators.high52w ? 'BREAKOUT' : 'NO_SIGNAL',
        system2_52w_low: currentPrice < indicators.low52w ? 'BREAKDOWN' : 'NO_SIGNAL'
      },
      week52Data: {
        high52w: indicators.high52w,
        low52w: indicators.low52w,
        dataPoints: highLowData?.dataPoints || 0
      },
      dataInfo: {
        dataLength: priceData.length,
        dataSource: priceData.length >= 55 ? 'SUFFICIENT' : 'INSUFFICIENT'
      }
    };
    
    // 터틀 분석 로그
    console.log(`📊 터틀 분석 ${symbol}: 현재가 ${currentPrice}원 (일봉 ${priceData.length}일, 52주 ${highLowData?.dataPoints || 0}일)`);
    console.log(`   System 1 - 20일 최고가: ${indicators.high20}원 (${currentPrice > indicators.high20 ? '매수 돌파!' : '미달'})`);
    console.log(`   System 1 - 10일 최저가: ${indicators.low10}원 (${currentPrice < indicators.low10 ? '매도 신호!' : '안전'})`);
    console.log(`   System 2 - 52주 신고가: ${indicators.high52w}원 (${currentPrice > indicators.high52w ? '매수 돌파!' : '미달'})`);
    console.log(`   System 2 - 52주 신저가: ${indicators.low52w}원 (${currentPrice < indicators.low52w ? '매도 신호!' : '안전'})`);
    
    // 터틀 분석 로그를 전역 변수에 저장 (Make.com 응답용)
    if (!global.turtleAnalysisLogs) global.turtleAnalysisLogs = [];
    global.turtleAnalysisLogs.push(analysisLog);
    
    // 테스트 조건 제거 - 원래 터틀 트레이딩 조건만 사용
    
    // System 1: 20일 돌파 신호 (원래 조건)
    if (currentPrice > indicators.high20) {
      // 20일 고점 돌파 - 매수 신호
      const signal = {
        symbol,
        name,
        date: new Date(),
        signalType: 'BUY_20',
        currentPrice,
        breakoutPrice: indicators.high20,
        high20: indicators.high20,
        low10: indicators.low10,
        atr: indicators.atr,
        nValue: indicators.nValue,
        volume: indicators.volume,
        avgVolume20: indicators.avgVolume20,
        volumeRatio: indicators.volumeRatio,
        signalStrength: this.calculateSignalStrength(indicators),
        isPrimarySignal: true
      };
      
      // 추천 액션 계산
      signal.recommendedAction = this.calculateRecommendedAction('BUY', signal, indicators);
      
      signals.push(signal);
    }
    
    if (currentPrice < indicators.low10) {
      // 10일 저점 하향 돌파 - 매도 신호
      const signal = {
        symbol,
        name,
        date: new Date(),
        signalType: 'SELL_10',
        currentPrice,
        breakoutPrice: indicators.low10,
        high20: indicators.high20,
        low10: indicators.low10,
        atr: indicators.atr,
        nValue: indicators.nValue,
        volume: indicators.volume,
        avgVolume20: indicators.avgVolume20,
        volumeRatio: indicators.volumeRatio,
        signalStrength: this.calculateSignalStrength(indicators),
        isPrimarySignal: true
      };
      
      signal.recommendedAction = this.calculateRecommendedAction('SELL', signal, indicators);
      
      signals.push(signal);
    }
    
    // 중복 제거: 같은 종목에서 여러 신호 발생시 우선순위 적용
    if (signals.length > 1) {
      console.log(`⚠️ ${symbol}: ${signals.length}개 신호 발생, 첫 번째 신호만 반환`);
    }
    
    return signals.length > 0 ? signals[0] : null; // 하나의 신호만 반환
  }
  
  // 신호 강도 계산
  static calculateSignalStrength(indicators) {
    // 거래량 비율로 신호 강도 판단
    if (indicators.volumeRatio > 2.0) return 'strong';
    if (indicators.volumeRatio > 1.5) return 'medium';
    return 'weak';
  }
  
  // 추천 액션 계산 (사용자 설정 투자 기준)
  static calculateRecommendedAction(action, signal, indicators) {
    const totalInvestment = global.investmentBudget || 1000000; // 기본값: 100만원
    
    if (action === 'BUY') {
      const currentPrice = signal.currentPrice;
      let atr = indicators.atr;
      
      // ATR 값 검증 - 데이터 부족시 명시적 표시
      if (!atr || atr === null || isNaN(atr) || atr <= 0) {
        console.warn(`${signal.symbol}: 데이터 부족으로 투자금액 계산 불가 (ATR: ${atr})`);
        return {
          action: 'BUY',
          dataStatus: 'INSUFFICIENT_DATA',
          message: '데이터 부족',
          investment: {
            budget: totalInvestment,
            actualAmount: '데이터 부족',
            quantity: '데이터 부족',
            pricePerShare: currentPrice
          },
          risk: {
            maxRisk: totalInvestment * 0.02,
            actualRisk: '데이터 부족',
            riskPercent: 'N/A',
            stopLossPrice: '데이터 부족',
            stopLossDistance: '데이터 부족'
          },
          technical: {
            atr: '데이터 부족',
            nValue: '데이터 부족',
            breakoutPrice: signal.breakoutPrice,
            volumeRatio: indicators.volumeRatio ? indicators.volumeRatio.toFixed(2) : '1.00'
          },
          scenarios: {
            loss2N: '데이터 부족',
            breakeven: 0,
            profit1N: '데이터 부족',
            profit2N: '데이터 부족'
          },
          reasoning: `${signal.signalType} 신호 | 가격데이터 부족으로 투자금액 계산 불가`
        };
      }
      
      // 정상적인 계산 진행
      const maxRisk = totalInvestment * 0.02; // 최대 리스크: 2만원
      const stopLossDistance = atr * 2; // 2N (2 × ATR)
      
      // 스톱로스 거리 최소값 보장 (현재가의 1% 이상)
      const minStopLossDistance = currentPrice * 0.01;
      const safeStopLossDistance = Math.max(stopLossDistance, minStopLossDistance);
      
      const stopLossPrice = Math.round(currentPrice - safeStopLossDistance);
      
      // 포지션 사이징: 리스크 ÷ 스톱로스 거리
      const recommendedQuantity = Math.floor(maxRisk / safeStopLossDistance);
      
      // 최소 수량 보장 (1주 이상)
      const safeQuantity = Math.max(1, recommendedQuantity);
      
      const actualInvestment = safeQuantity * currentPrice;
      const actualRisk = safeQuantity * safeStopLossDistance;
      
      // 수익/손실 시나리오
      const profit1N = safeQuantity * atr;
      const profit2N = safeQuantity * (atr * 2);
      
      return {
        action: 'BUY',
        dataStatus: 'SUFFICIENT_DATA',
        investment: {
          budget: totalInvestment,
          actualAmount: Math.round(actualInvestment),
          quantity: safeQuantity,
          pricePerShare: currentPrice
        },
        risk: {
          maxRisk: maxRisk,
          actualRisk: Math.round(actualRisk),
          riskPercent: ((actualRisk / actualInvestment) * 100).toFixed(2),
          stopLossPrice: stopLossPrice,
          stopLossDistance: Math.round(safeStopLossDistance)
        },
        technical: {
          atr: Math.round(atr),
          nValue: Math.round(atr),
          breakoutPrice: signal.breakoutPrice,
          volumeRatio: indicators.volumeRatio ? indicators.volumeRatio.toFixed(2) : '1.00'
        },
        scenarios: {
          loss2N: -Math.round(actualRisk),
          breakeven: 0,
          profit1N: Math.round(profit1N),
          profit2N: Math.round(profit2N)
        },
        reasoning: `${signal.signalType} 신호 | 투자 ${(actualInvestment/10000).toFixed(0)}만원 | 수량 ${safeQuantity}주 | 손절 ${stopLossPrice.toLocaleString()}원 | 리스크 ${(actualRisk/10000).toFixed(1)}만원`
      };
    } else {
      return {
        action: 'SELL',
        quantity: 0,
        reasoning: '터틀 매도 신호 발생'
      };
    }
  }
  
  // 리스크 계산 (포지션 기반)
  static async calculateRisk(userId = 'default') {
    try {
      const portfolio = await Portfolio.findOne({ userId });
      
      if (!portfolio) {
        return {
          totalEquity: 0,
          currentRiskExposure: 0,
          availableRisk: 0,
          message: '포트폴리오가 설정되지 않았습니다.'
        };
      }
      
      const riskAnalysis = {
        totalEquity: portfolio.totalEquity,
        currentCash: portfolio.currentCash,
        currentRiskExposure: portfolio.currentRiskExposure,
        riskPercentage: (portfolio.currentRiskExposure / portfolio.totalEquity) * 100,
        availableRisk: (portfolio.totalEquity * 0.02) * 5, // 최대 5포지션 가정
        maxRiskPerTrade: portfolio.totalEquity * 0.02,
        positionCount: portfolio.positions.length,
        positions: portfolio.positions.map(pos => ({
          symbol: pos.symbol,
          name: pos.name,
          unrealizedPL: pos.unrealizedPL,
          riskAmount: pos.riskAmount
        }))
      };
      
      return riskAnalysis;
      
    } catch (error) {
      console.error('리스크 계산 실패:', error);
      throw error;
    }
  }
  
  // 관심종목 리스트 (터틀 트레이딩) - 캐시된 회사명 사용
  static async getWatchlist() {
    try {
      const StockListService = require('./stockListService');
      const StockNameCacheService = require('./stockNameCacheService');
      
      const stockCodes = StockListService.getUnifiedStockList();
      
      // 캐시에서 회사명 대량 조회
      const nameMap = await StockNameCacheService.getBulkStockNames(stockCodes);
      
      const watchlist = stockCodes.map(symbol => ({
        symbol: symbol,
        name: nameMap.get(symbol) || `ST_${symbol}` // 캐시된 이름 또는 fallback
      }));
      
      console.log(`📋 터틀 watchlist 준비: ${watchlist.length}개 종목 (캐시된 회사명 ${nameMap.size}개)`);
      
      return watchlist;
    } catch (error) {
      console.error('watchlist 조회 실패:', error.message);
      // fallback으로 기존 방식 사용
      const StockListService = require('./stockListService');
      return StockListService.getTurtleWatchlist();
    }
  }
  
  // 기존 하드코딩된 종목 리스트 (백업용)
  static async getLegacyWatchlist() {
    // 터틀 트레이딩: 코스피 + 코스닥 전체 주요 상장주식 (500개)
    const allStocks = [
      // === 코스피 주요 종목 (시가총액 상위 250개) ===
      '005930', '000660', '035420', '005380', '012330', '000270', '105560', '055550', '035720', '051910',
      '006400', '028260', '096770', '003550', '015760', '017670', '034730', '003490', '009150', '032830',
      '000810', '001570', '068270', '207940', '323410', '003670', '018260', '005935', '329180', '010950',
      '000720', '024110', '316140', '086790', '030200', '009540', '011200', '139480', '021240', '161390',
      '005490', '004020', '010140', '011070', '001450', '090430', '002790', '018880', '051900', '097950',
      '128940', '018670', '010130', '000100', '004170', '007070', '180640', '081660', '071050', '011780',
      '000120', '006360', '008770', '004000', '010620', '005830', '267250', '036460', '047040', '001040',
      '004490', '003240', '020150', '000080', '002320', '051600', '000150', '004560', '001800', '002380',
      '000430', '014680', '001440', '000880', '017800', '175330', '000230', '000370', '000240', '003000',
      '001680', '004800', '000910', '002700', '092230', '010060', '002600', '000070', '000040', '000140',
      '001520', '004410', '000210', '006650', '002310', '000500', '004690', '000670', '002220', '000830',
      '001740', '002030', '000390', '000290', '001430', '004840', '000860', '000350', '002900', '001420',
      '004980', '001260', '001390', '000590', '000020', '002000', '001500', '000300', '000520', '001200',
      '000250', '001340', '000780', '000680', '000340', '001630', '001940', '000180', '002140', '000540',
      '001230', '000970', '002360', '002710', '000650', '001770', '001820', '002840', '000760', '000950',
      '001250', '000450', '001460', '002350', '001210', '000480', '000560', '001790', '002270', '000400',
      '001880', '000280', '002450', '000470', '002200', '000320', '001510', '001470', '002720', '000110',
      '002020', '001360', '001550', '001040', '001840', '000440', '002860', '000900', '001140', '000160',
      '001310', '000990', '001560', '001380', '002100', '000820', '000580', '001000', '000460', '001720',
      '001080', '002470', '000410', '001350', '000530', '001270', '002080', '001010', '000190', '001150',
      '001930', '002240', '001590', '000600', '001660', '002880', '002580', '000740', '002520', '001100',
      '001780', '002570', '001490', '002330', '002040', '001240', '000850', '001890', '002180', '000690',
      '001320', '000570', '001020', '002160', '001870', '002560', '001530', '001290', '002010', '000920',
      '000870', '000170', '002050', '001300', '002110', '001750', '000610', '001650', '002170', '001900',
      '001540', '001600', '001850', '001480', '002300', '001030', '001090', '001280', '001110', '002150',
      
      // === 코스닥 주요 종목 (시가총액 상위 250개) ===
      '251270', '036570', '352820', '377300', '259960', '293490', '263750', '095660', '112040', '122870',
      '041510', '035900', '067160', '192080', '194480', '182360', '054780', '299900', '181710', '034120',
      '326030', '145020', '195940', '214150', '214450', '285130', '196170', '065660', '302440', '085660',
      '237690', '287410', '141080', '328130', '068760', '099190', '230240', '205470', '174900', '086900',
      '042700', '000990', '058470', '240810', '064290', '039030', '108860', '347860', '178920', '053610',
      '067310', '950160', '034590', '020000', '005300', '000500', '032350', '086890', '086790', '086960',
      '079170', '028050', '079430', '131390', '064960', '192820', '079370', '086450', '086520', '060310',
      '226330', '004000', '279600', '267290', '137400', '161000', '187660', '183300', '306200', '277880',
      '225570', '347000', '383310', '090460', '278280', '033500', '263770', '047920', '036620', '039200',
      '067630', '066700', '418550', '189300', '950170', '950140', '950210', '950130', '006280', '033240',
      '046390', '060720', '214370', '347890', '052020', '088350', '051600', '078600', '036810', '036540',
      '140610', '403870', '206640', '101160', '950200', '418550', '950220', '950180', '067260', '078340',
      '122640', '094170', '950190', '036830', '025540', '028670', '024900', '064820', '039570', '267270',
      '036200', '950230', '263920', '036830', '950250', '950260', '036200', '263920', '950270', '036830',
      '039440', '263930', '950280', '036840', '039450', '263940', '950290', '036850', '039460', '263950',
      '950300', '036860', '039470', '263960', '950310', '036870', '039480', '263970', '950320', '036880',
      '039490', '263980', '950330', '036890', '039500', '263990', '950340', '036900', '039510', '264000',
      '950350', '036910', '039520', '264010', '950360', '036920', '039530', '264020', '950370', '036930',
      '039540', '264030', '950380', '036940', '039550', '264040', '950390', '036950', '039560', '264050',
      '950400', '036960', '039570', '264060', '950410', '036970', '039580', '264070', '950420', '036980',
      '039590', '264080', '950430', '036990', '039600', '264090', '950440', '037000', '039610', '264100',
      '950450', '037010', '039620', '264110', '950460', '037020', '039630', '264120', '950470', '037030',
      '039640', '264130', '950480', '037040', '039650', '264140', '950490', '037050', '039660', '264150',
      '950500', '037060', '039670', '264160', '950510', '037070', '039680', '264170', '950520', '037080',
      '039690', '264180', '950530', '037090', '039700', '264190', '950540', '037100', '039710', '264200'
    ];
    
    console.log(`🐢 터틀 분석 대상: 전체 ${allStocks.length}개 상장주식 (코스피 250 + 코스닥 250)`);
    
    // 종목명을 병렬로 조회
    const stocksWithNames = await Promise.all(
      allStocks.map(async (symbol) => ({
        symbol: symbol,
        name: await this.getStockName(symbol)
      }))
    );
    
    return stocksWithNames;
  }
  
  // 종목명 반환 (StockNameCacheService 사용)
  static async getStockName(symbol) {
    try {
      const StockNameCacheService = require('./stockNameCacheService');
      const name = await StockNameCacheService.getStockName(symbol);
      return name;
    } catch (error) {
      console.error(`종목명 조회 실패 (${symbol}):`, error.message);
      return `종목${symbol}`;
    }
  }
  
  // 가격 데이터 가져오기 (키움 API 연동) - 시뮬레이션 데이터 필터링
  static async getPriceData(symbol, days = 55) {
    try {
      // 키움 서비스에서 일봉 데이터 가져오기
      const data = await KiwoomService.getDailyData(symbol, days);
      
      // 시뮬레이션 데이터 검증 - 실제 데이터만 허용
      if (data && data.length > 0) {
        // 시뮬레이션 데이터 패턴 감지:
        // 1. 매우 규칙적인 가격 패턴 (시뮬레이션 특징)
        // 2. 날짜가 너무 완벽한 순서 (실제 시장은 휴일 제외)
        const isSimulationData = this.detectSimulationData(data, symbol);
        
        if (isSimulationData) {
          console.log(`⚠️ ${symbol}: 시뮬레이션 데이터 감지됨, 실제 데이터만 사용`);
          return [];
        }
      }
      
      return data || [];
    } catch (error) {
      console.error(`${symbol} 가격 데이터 조회 실패:`, error);
      return [];
    }
  }

  // 시뮬레이션 데이터 감지 로직
  static detectSimulationData(data, symbol) {
    if (!data || data.length < 5) return false;
    
    // 1. 가격 데이터의 현실성 체크 - 현재가와 히스토리 가격 차이
    const latestClose = data[0]?.close;
    const historicalPrices = data.slice(0, 10).map(d => d.close);
    
    // 최근 10일 가격 중 현재가와 너무 큰 차이가 나는 경우 시뮬레이션 의심
    const maxHistoricalPrice = Math.max(...historicalPrices);
    const minHistoricalPrice = Math.min(...historicalPrices);
    
    // 가격 차이가 50% 이상 나면 시뮬레이션 데이터 의심
    if (latestClose > 0) {
      const priceVariation1 = Math.abs(maxHistoricalPrice - latestClose) / latestClose;
      const priceVariation2 = Math.abs(minHistoricalPrice - latestClose) / latestClose;
      
      if (priceVariation1 > 0.5 || priceVariation2 > 0.5) {
        console.log(`⚠️ ${symbol}: 가격 데이터 이상 감지 - 현재가 ${latestClose}원 vs 히스토리 ${minHistoricalPrice}-${maxHistoricalPrice}원`);
        return true;
      }
    }
    
    // 2. 날짜 패턴 체크 - 미래 날짜나 너무 오래된 날짜
    const today = new Date();
    const latestDate = new Date(data[0]?.date);
    const daysDiff = Math.abs(today - latestDate) / (1000 * 60 * 60 * 24);
    
    if (daysDiff > 90) {
      console.log(`⚠️ ${symbol}: 데이터가 너무 오래됨 - 최근 데이터: ${data[0]?.date}`);
      return true; // 90일 이상 오래된 데이터는 유효하지 않음
    }
    
    // 2. 데이터 패턴이 너무 인위적인지 체크
    const prices = data.slice(0, 10).map(d => d.close);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    
    // 변동성이 너무 일정한 경우 (실제 시장은 불규칙함)
    const volatilities = [];
    for (let i = 1; i < prices.length; i++) {
      volatilities.push(Math.abs(prices[i] - prices[i-1]) / prices[i-1]);
    }
    
    const avgVolatility = volatilities.reduce((a, b) => a + b, 0) / volatilities.length;
    const volatilityStdDev = Math.sqrt(
      volatilities.reduce((sum, v) => sum + Math.pow(v - avgVolatility, 2), 0) / volatilities.length
    );
    
    // 변동성이 너무 일정하면 시뮬레이션 데이터
    if (volatilityStdDev < avgVolatility * 0.3) {
      return true;
    }
    
    return false;
  }
  
  // 신호 저장
  static async saveSignals(signals) {
    try {
      for (const signal of signals) {
        await Signal.create(signal);
      }
    } catch (error) {
      console.error('신호 저장 실패:', error);
    }
  }
  
  // 매도 조건 확인 (보유 종목용)
  static async checkSellConditions(signal, position) {
    const currentPrice = position.currentPrice;
    const avgPrice = position.avgPrice;
    const unrealizedPL = position.unrealizedPL;
    const unrealizedPLPercent = (unrealizedPL / (avgPrice * position.quantity)) * 100;
    
    const indicators = signal.indicators || {};
    const sellConditions = {
      shouldSell: false,
      reason: '',
      urgency: 'LOW',
      conditions: {
        system1_sell: currentPrice < indicators.low10,     // 10일 최저가 하향돌파
        system2_sell: currentPrice < indicators.low52w,    // 52주 신저가 하향돌파
        turtle2N_stopLoss: false,                          // 터틀 2N 손절 (아래에서 계산)
        bigLoss: unrealizedPLPercent < -15                 // 15% 이상 큰 손실 (비상)
      }
    };
    
    // 터틀 2N 손절 계산 (핵심 룰)
    try {
      const priceData = await this.getPriceData(position.symbol, 25);
      if (priceData && priceData.length >= 21) {
        const atr = this.calculateATR(priceData.slice(0, 21));
        const twoN = atr * 2; // 2N = 2 × ATR
        const stopLossPrice = avgPrice - twoN;
        sellConditions.conditions.turtle2N_stopLoss = currentPrice <= stopLossPrice;
        sellConditions.stopLossPrice = stopLossPrice;
        
        console.log(`🐢 ${position.symbol} 터틀 2N 손절 체크: 매수가 ${avgPrice}원, ATR ${Math.round(atr)}원, 2N 손절가 ${Math.round(stopLossPrice)}원, 현재가 ${currentPrice}원, 손절 필요: ${sellConditions.conditions.turtle2N_stopLoss}`);
      }
    } catch (error) {
      console.error(`❌ ${position.symbol} 2N 손절가 계산 실패:`, error.message);
      // ATR 계산 실패시 백업: 매수가 대비 5% 하락을 2N으로 추정
      const backupStopLoss = avgPrice * 0.95;
      sellConditions.conditions.turtle2N_stopLoss = currentPrice <= backupStopLoss;
      sellConditions.stopLossPrice = backupStopLoss;
    }
    
    // 매도 신호 우선순위 (터틀 2N 룰 우선)
    if (sellConditions.conditions.turtle2N_stopLoss) {
      sellConditions.shouldSell = true;
      sellConditions.reason = `터틀 2N 손절 (매수가 ${avgPrice.toLocaleString()}원 → 손절가 ${Math.round(sellConditions.stopLossPrice).toLocaleString()}원)`;
      sellConditions.urgency = 'URGENT';
    } else if (sellConditions.conditions.bigLoss) {
      sellConditions.shouldSell = true;
      sellConditions.reason = '큰 손실 발생 (15% 이상)';
      sellConditions.urgency = 'HIGH';
    } else if (sellConditions.conditions.system1_sell) {
      sellConditions.shouldSell = true;
      sellConditions.reason = '터틀 System 1: 10일 최저가 하향돌파';
      sellConditions.urgency = 'MEDIUM';
    } else if (sellConditions.conditions.system2_sell) {
      sellConditions.shouldSell = true;
      sellConditions.reason = '터틀 System 2: 52주 신저가 하향돌파';
      sellConditions.urgency = 'MEDIUM';
    }
    
    console.log(`📊 ${position.symbol} 매도 조건: ${sellConditions.shouldSell ? sellConditions.reason : '보유 유지'} (손익: ${unrealizedPLPercent.toFixed(1)}%)`);
    
    return sellConditions;
  }
  
  // 재무건전성 체크 (터틀 신호에 재무 필터 추가)
  static async checkFinancialHealth(symbol, currentPrice, minRevenueGrowth = 10, maxPSR = 3.0) {
    try {
      console.log(`🔍 ${symbol} 재무건전성 체크 시작...`);
      
      // 캐시된 재무데이터 조회
      const financialData = await FinancialDataCacheService.getCachedFinancialData(symbol);
      
      if (!financialData) {
        console.log(`⚠️ ${symbol} 재무데이터 없음, 재무 필터 통과 (기술적 신호만)`);
        return { passed: true, score: 'NO_DATA', reason: '재무데이터 없음' };
      }
      
      // PSR 계산
      let psr = null;
      if (financialData.sharesOutstanding && financialData.revenue > 0) {
        const marketCap = currentPrice * financialData.sharesOutstanding;
        const revenueInWon = financialData.revenue * 100000000;
        psr = marketCap / revenueInWon;
      }
      
      // 재무건전성 조건 체크
      const revenueGrowthPass = financialData.revenueGrowth3Y >= minRevenueGrowth;
      const psrPass = psr === null || psr <= maxPSR;
      
      const passed = revenueGrowthPass && psrPass;
      
      console.log(`📊 ${symbol} 재무건전성: 매출성장률 ${financialData.revenueGrowth3Y}% (${revenueGrowthPass ? '✅' : '❌'}), PSR ${psr?.toFixed(3) || 'N/A'} (${psrPass ? '✅' : '❌'})`);
      
      return {
        passed: passed,
        score: passed ? 'HEALTHY' : 'WEAK',
        reason: passed ? '재무건전성 양호' : '재무건전성 미달',
        details: {
          revenueGrowth3Y: financialData.revenueGrowth3Y,
          netIncomeGrowth3Y: financialData.netIncomeGrowth3Y,
          psr: psr,
          dataSource: financialData.dataSource
        }
      };
      
    } catch (error) {
      console.error(`재무건전성 체크 실패 (${symbol}):`, error);
      return { passed: true, score: 'ERROR', reason: '재무 체크 오류' };
    }
  }
}

module.exports = TurtleAnalyzer;