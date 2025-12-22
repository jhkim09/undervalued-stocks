/**
 * 포트폴리오 추적 모듈
 * 
 * 역할:
 * 1. 키움증권 실제 잔고와 터틀 포지션 매칭
 * 2. 터틀 포지션 상태 관리
 * 3. 포지션별 ATR, 손절가, 추가매수 타이밍 추적
 * 4. 포트폴리오 리스크 모니터링
 */

const KiwoomService = require('./kiwoomService');
const Trade = require('../models/Trade');
const Signal = require('../models/Signal');

class PortfolioTracker {
  
  constructor() {
    this.turtlePositions = new Map(); // symbol -> position data
    this.lastSyncTime = null;
  }
  
  /**
   * 키움 잔고와 터틀 포지션 동기화
   */
  async syncWithKiwoomAccount() {
    try {
      console.log('🔄 키움 잔고와 터틀 포지션 동기화 시작...');
      
      // 1. 키움 계좌 잔고 조회
      const accountData = await KiwoomService.getAccountBalance();
      
      if (!accountData.positions || accountData.positions.length === 0) {
        console.log('📊 키움 계좌에 보유종목 없음');
        return {
          kiwoomPositions: [],
          turtlePositions: [],
          syncedPositions: [],
          unmatchedPositions: []
        };
      }
      
      console.log(`📊 키움 보유종목 ${accountData.positions.length}개 발견`);
      
      // 2. 각 보유종목에 대해 터틀 포지션 데이터 생성/업데이트
      const syncResults = {
        kiwoomPositions: accountData.positions,
        turtlePositions: [],
        syncedPositions: [],
        unmatchedPositions: []
      };
      
      for (const kiwoomPos of accountData.positions) {
        const turtlePos = await this.createOrUpdateTurtlePosition(kiwoomPos);
        
        if (turtlePos) {
          syncResults.turtlePositions.push(turtlePos);
          syncResults.syncedPositions.push({
            symbol: kiwoomPos.symbol,
            name: kiwoomPos.name,
            kiwoomData: kiwoomPos,
            turtleData: turtlePos
          });
        } else {
          syncResults.unmatchedPositions.push(kiwoomPos);
        }
      }
      
      this.lastSyncTime = new Date().toISOString();
      
      console.log(`✅ 동기화 완료: ${syncResults.syncedPositions.length}개 매칭, ${syncResults.unmatchedPositions.length}개 미매칭`);
      
      return syncResults;
      
    } catch (error) {
      console.error('❌ 키움 잔고 동기화 실패:', error.message);
      throw error;
    }
  }
  
  /**
   * 종목코드 정규화 (A122870 → 122870)
   */
  normalizeSymbol(symbol) {
    if (typeof symbol === 'string' && symbol.startsWith('A') && symbol.length === 7) {
      return symbol.substring(1); // A 접두사 제거
    }
    return symbol;
  }

  /**
   * 터틀 매수 이력 확인
   */
  async checkTurtleBuyHistory(symbol) {
    try {
      // 종목코드 정규화 (키움: A122870 → DB: 122870)
      const normalizedSymbol = this.normalizeSymbol(symbol);
      console.log(`🔍 터틀 이력 확인: ${symbol} → ${normalizedSymbol}`);
      
      // Trade 컬렉션에서 터틀 매수 기록 확인 (모든 사용자 포함)
      const turtleBuyTrades = await Trade.find({
        symbol: normalizedSymbol,
        action: 'BUY',
        signal: { $in: ['20day_breakout', '55day_breakout'] },
        userId: { $in: ['default', 'manual_turtle_user'] }
      }).sort({ tradeDate: -1 }).limit(5);

      // Signal 컬렉션에서 터틀 매수 신호 기록 확인
      const turtleBuySignals = await Signal.find({
        symbol: normalizedSymbol,
        signalType: { $in: ['BUY_20', 'BUY_55'] },
        status: { $in: ['executed', 'sent'] }
      }).sort({ date: -1 }).limit(5);

      return {
        hasTurtleHistory: turtleBuyTrades.length > 0 || turtleBuySignals.length > 0,
        tradeHistory: turtleBuyTrades,
        signalHistory: turtleBuySignals,
        lastTurtleBuy: turtleBuyTrades.length > 0 ? turtleBuyTrades[0] : null
      };
    } catch (error) {
      console.error(`터틀 매수 이력 확인 실패 (${symbol}):`, error.message);
      return {
        hasTurtleHistory: false,
        tradeHistory: [],
        signalHistory: [],
        lastTurtleBuy: null
      };
    }
  }

  /**
   * 키움 포지션을 기반으로 터틀 포지션 데이터 생성/업데이트
   */
  async createOrUpdateTurtlePosition(kiwoomPosition) {
    try {
      const symbol = kiwoomPosition.symbol;
      
      // 터틀 매수 이력 확인
      const turtleHistory = await this.checkTurtleBuyHistory(symbol);
      
      // 터틀 매수 이력이 없으면 터틀 포지션으로 관리하지 않음
      if (!turtleHistory.hasTurtleHistory) {
        console.log(`⚠️ ${symbol}: 터틀 매수 이력 없음, 터틀 포지션 제외`);
        return null;
      }
      
      console.log(`✅ ${symbol}: 터틀 매수 이력 확인됨 (거래 ${turtleHistory.tradeHistory.length}개, 신호 ${turtleHistory.signalHistory.length}개)`);
      
      // 기존 터틀 포지션이 있는지 확인
      let turtlePos = this.turtlePositions.get(symbol);
      
      if (!turtlePos) {
        // 신규 터틀 포지션 생성 - 터틀 기록 기반
        turtlePos = this.createTurtlePositionFromHistory(kiwoomPosition, turtleHistory);
        
        if (turtlePos) {
          this.turtlePositions.set(symbol, turtlePos);
          console.log(`🆕 ${symbol} 신규 터틀 포지션 생성 (기록 기반)`);
        }
      } else {
        // 기존 포지션 업데이트 (N값 재계산 포함)
        turtlePos = await this.updateExistingTurtlePosition(turtlePos, kiwoomPosition);
        turtlePos.turtleHistory = turtleHistory;
        this.turtlePositions.set(symbol, turtlePos);
        console.log(`🔄 ${symbol} 터틀 포지션 업데이트`);
      }
      
      return turtlePos;
      
    } catch (error) {
      console.error(`터틀 포지션 생성 실패 (${kiwoomPosition.symbol}):`, error.message);
      return null;
    }
  }
  
  /**
   * 신규 터틀 포지션 생성 (ATR 계산 포함)
   */
  async createNewTurtlePosition(kiwoomPosition) {
    try {
      const symbol = kiwoomPosition.symbol;
      
      // 터틀 매수 이력에서 N값 가져오기
      const turtleHistory = await this.checkTurtleBuyHistory(symbol);
      let atr = 0;
      
      if (turtleHistory.lastTurtleBuy && turtleHistory.lastTurtleBuy.nValue) {
        atr = turtleHistory.lastTurtleBuy.nValue;
        console.log(`📊 ${symbol}: 터틀 기록에서 N값 사용 = ${atr}원`);
      } else {
        // ATR 계산을 위한 일봉 데이터 조회 (fallback)
        const priceData = await KiwoomService.getDailyData(symbol, 25);
        
        if (priceData.length < 20) {
          // 일봉 데이터도 없으면 키움 평균가의 2%를 임시 N값으로 사용
          atr = Math.round(kiwoomPosition.avgPrice * 0.02);
          console.log(`⚠️ ${symbol}: 일봉 데이터 부족, 임시 N값 = ${atr}원 (평균가 ${kiwoomPosition.avgPrice}원의 2%)`);
        } else {
          // ATR 계산
          atr = this.calculateATR(priceData, 20);
          console.log(`📊 ${symbol}: 일봉 데이터로 N값 계산 = ${atr}원`);
        }
      }
      
      // 유닛 사이즈 추정 (임의로 현재 수량을 기준으로)
      const estimatedUnitSize = Math.floor(kiwoomPosition.quantity / 1) || kiwoomPosition.quantity;
      const estimatedUnits = Math.ceil(kiwoomPosition.quantity / estimatedUnitSize);
      
      const turtlePosition = {
        // 기본 정보
        symbol: symbol,
        name: kiwoomPosition.name,
        
        // 키움 데이터 (현재 상태)
        totalQuantity: kiwoomPosition.quantity,
        currentPrice: kiwoomPosition.currentPrice,
        avgPrice: kiwoomPosition.avgPrice,
        unrealizedPL: kiwoomPosition.unrealizedPL,
        
        // 터틀 추적 데이터
        originalEntryPrice: kiwoomPosition.avgPrice, // 평균가를 원래 진입가로 가정
        originalN: Math.round(atr),
        currentUnits: estimatedUnits,
        maxUnits: 4, // 터틀 기본값
        unitSize: estimatedUnitSize,
        
        // 계산된 값들
        currentStopLoss: Math.round(kiwoomPosition.avgPrice - (atr * 2)),
        nextAddPrice: estimatedUnits < 4 ? 
          Math.round(kiwoomPosition.avgPrice + (atr * 0.5 * estimatedUnits)) : null,
        
        // 메타데이터
        createdAt: new Date().toISOString(),
        lastSyncAt: new Date().toISOString(),
        syncSource: 'KIWOOM_AUTO_CREATE',
        
        // 리스크 정보
        riskAmount: kiwoomPosition.quantity * (atr * 2),
        riskPercent: ((atr * 2) / kiwoomPosition.avgPrice * 100).toFixed(2)
      };
      
      console.log(`📊 ${symbol} 터틀 데이터: N=${Math.round(atr)}, 손절=${turtlePosition.currentStopLoss.toLocaleString()}원, 다음추가=${turtlePosition.nextAddPrice?.toLocaleString() || 'N/A'}원`);
      
      return turtlePosition;
      
    } catch (error) {
      console.error(`신규 터틀 포지션 생성 실패 (${kiwoomPosition.symbol}):`, error.message);
      return null;
    }
  }
  
  /**
   * 터틀 기록 기반으로 포지션 생성 (일봉 데이터 불필요)
   */
  createTurtlePositionFromHistory(kiwoomPosition, turtleHistory) {
    try {
      const symbol = this.normalizeSymbol(kiwoomPosition.symbol);
      
      // 터틀 기록에서 N값 추출
      let nValue = 0;
      if (turtleHistory.lastTurtleBuy && turtleHistory.lastTurtleBuy.nValue) {
        nValue = turtleHistory.lastTurtleBuy.nValue;
        console.log(`📊 ${symbol}: 터틀 기록 N값 = ${nValue}원`);
      } else {
        // 임시 N값: 키움 평균가의 2%
        nValue = Math.round(kiwoomPosition.avgPrice * 0.02);
        console.log(`⚠️ ${symbol}: 임시 N값 = ${nValue}원 (평균가 ${kiwoomPosition.avgPrice}원의 2%)`);
      }
      
      // 유닛 사이즈와 단계 추정
      const estimatedUnitSize = kiwoomPosition.quantity;
      const estimatedUnits = 1; // 기본 1단계로 가정
      
      const turtlePosition = {
        // 기본 정보
        symbol: symbol,
        name: kiwoomPosition.name,
        
        // 키움 데이터 (현재 상태)
        totalQuantity: kiwoomPosition.quantity,
        currentPrice: kiwoomPosition.currentPrice,
        avgPrice: kiwoomPosition.avgPrice,
        unrealizedPL: kiwoomPosition.unrealizedPL,
        
        // 터틀 추적 데이터
        originalEntryPrice: kiwoomPosition.avgPrice,
        originalN: nValue,
        currentUnits: estimatedUnits,
        maxUnits: 4,
        unitSize: estimatedUnitSize,
        
        // 계산된 값들
        currentStopLoss: Math.round(kiwoomPosition.avgPrice - (nValue * 2)),
        nextAddPrice: estimatedUnits < 4 ? 
          Math.round(kiwoomPosition.avgPrice + (nValue * 0.5)) : null,
        
        // 메타데이터
        createdAt: new Date().toISOString(),
        lastSyncAt: new Date().toISOString(),
        syncSource: 'TURTLE_HISTORY_BASED',
        
        // 리스크 정보
        riskAmount: kiwoomPosition.quantity * (nValue * 2),
        riskPercent: ((nValue * 2) / kiwoomPosition.avgPrice * 100).toFixed(2),
        
        // 터틀 이력
        turtleHistory: turtleHistory
      };
      
      console.log(`📊 ${symbol} 터틀 데이터 생성: N=${nValue}, 손절=${turtlePosition.currentStopLoss.toLocaleString()}원, 다음추가=${turtlePosition.nextAddPrice?.toLocaleString() || 'N/A'}원`);
      
      return turtlePosition;
      
    } catch (error) {
      console.error(`터틀 기록 기반 포지션 생성 실패 (${kiwoomPosition.symbol}):`, error.message);
      return null;
    }
  }
  
  /**
   * 기존 터틀 포지션 업데이트 (N값 매일 재계산 포함)
   */
  async updateExistingTurtlePosition(turtlePosition, kiwoomPosition) {
    try {
      const symbol = kiwoomPosition.symbol;
      
      // 최신 ATR(N값) 재계산
      const priceData = await KiwoomService.getDailyData(symbol, 25);
      let newN = turtlePosition.originalN; // 기본값: 기존 N값
      
      if (priceData.length >= 20) {
        newN = Math.round(this.calculateATR(priceData, 20));
        console.log(`🔄 ${symbol} N값 업데이트: ${turtlePosition.originalN} → ${newN}`);
      }
      
      // 키움 데이터로 현재 상태 업데이트
      return {
        ...turtlePosition,
        
        // 현재 상태 업데이트
        totalQuantity: kiwoomPosition.quantity,
        currentPrice: kiwoomPosition.currentPrice,
        avgPrice: kiwoomPosition.avgPrice,
        unrealizedPL: kiwoomPosition.unrealizedPL,
        
        // 최신 N값으로 업데이트
        originalN: newN,
        currentStopLoss: Math.round(kiwoomPosition.avgPrice - (newN * 2)),
        nextAddPrice: turtlePosition.currentUnits < 4 ? 
          Math.round(kiwoomPosition.avgPrice + (newN * 0.5 * turtlePosition.currentUnits)) : null,
        
        // 리스크 정보 재계산
        riskAmount: kiwoomPosition.quantity * (newN * 2),
        riskPercent: ((newN * 2) / kiwoomPosition.avgPrice * 100).toFixed(2),
        
        // 수량 변화 감지
        quantityChanged: turtlePosition.totalQuantity !== kiwoomPosition.quantity,
        
        // 동기화 시간
        lastSyncAt: new Date().toISOString(),
        syncSource: 'KIWOOM_UPDATE_WITH_NEW_N'
      };
    } catch (error) {
      console.error(`N값 업데이트 실패 (${kiwoomPosition.symbol}):`, error.message);
      
      // 에러시 기존 방식으로 업데이트
      return {
        ...turtlePosition,
        totalQuantity: kiwoomPosition.quantity,
        currentPrice: kiwoomPosition.currentPrice,
        avgPrice: kiwoomPosition.avgPrice,
        unrealizedPL: kiwoomPosition.unrealizedPL,
        quantityChanged: turtlePosition.totalQuantity !== kiwoomPosition.quantity,
        lastSyncAt: new Date().toISOString(),
        syncSource: 'KIWOOM_UPDATE_FALLBACK'
      };
    }
  }
  
  /**
   * ATR (Average True Range) 계산
   */
  calculateATR(priceData, period = 20) {
    const trueRanges = [];
    
    for (let i = 1; i < priceData.length; i++) {
      const current = priceData[i];
      const previous = priceData[i - 1];
      
      const tr1 = current.high - current.low;
      const tr2 = Math.abs(current.high - previous.close);
      const tr3 = Math.abs(current.low - previous.close);
      
      trueRanges.push(Math.max(tr1, tr2, tr3));
    }
    
    const avgTR = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;
    return avgTR;
  }
  
  /**
   * 모든 터틀 포지션 조회
   */
  getAllTurtlePositions() {
    return Array.from(this.turtlePositions.values());
  }
  
  /**
   * 특정 종목의 터틀 포지션 조회
   */
  getTurtlePosition(symbol) {
    return this.turtlePositions.get(symbol);
  }
  
  /**
   * 포트폴리오 리스크 요약
   */
  getPortfolioRiskSummary() {
    const positions = this.getAllTurtlePositions();
    
    if (positions.length === 0) {
      return {
        totalPositions: 0,
        totalRiskAmount: 0,
        averageRiskPercent: 0,
        positions: []
      };
    }
    
    const totalRiskAmount = positions.reduce((sum, pos) => sum + (pos.riskAmount || 0), 0);
    const avgRiskPercent = positions.reduce((sum, pos) => sum + parseFloat(pos.riskPercent || 0), 0) / positions.length;
    
    return {
      totalPositions: positions.length,
      totalRiskAmount: Math.round(totalRiskAmount),
      averageRiskPercent: avgRiskPercent.toFixed(2),
      lastSyncTime: this.lastSyncTime,
      positions: positions.map(pos => ({
        symbol: pos.symbol,
        name: pos.name,
        currentUnits: pos.currentUnits,
        maxUnits: pos.maxUnits,
        riskAmount: pos.riskAmount,
        riskPercent: pos.riskPercent,
        canAddMore: pos.currentUnits < pos.maxUnits
      }))
    };
  }
  
  /**
   * 독립 테스트용 - 모의 키움 계좌 데이터
   */
  createMockKiwoomAccount() {
    return {
      cash: 10000000,
      totalAsset: 15000000,
      positions: [
        {
          symbol: '005930',
          name: '삼성전자',
          quantity: 150,
          avgPrice: 71000,
          currentPrice: 72500,
          unrealizedPL: 225000,
          totalValue: 10875000
        },
        {
          symbol: '000660',
          name: 'SK하이닉스',
          quantity: 50,
          avgPrice: 180000,
          currentPrice: 185000,
          unrealizedPL: 250000,
          totalValue: 9250000
        }
      ]
    };
  }
  
  /**
   * 독립 테스트 실행
   */
  async runTest() {
    console.log('🧪 포트폴리오 트래커 모듈 테스트 시작...');
    
    // 모의 키움 계좌 데이터로 테스트
    const mockAccount = this.createMockKiwoomAccount();
    
    console.log('📊 모의 키움 계좌:', mockAccount);
    
    // 각 포지션에 대해 터틀 데이터 생성
    for (const kiwoomPos of mockAccount.positions) {
      const turtlePos = await this.createNewTurtlePosition(kiwoomPos);
      
      if (turtlePos) {
        console.log(`\n✅ ${turtlePos.symbol} 터틀 포지션 생성:`);
        console.log(`  원래 N값: ${turtlePos.originalN}`);
        console.log(`  현재 유닛: ${turtlePos.currentUnits}/${turtlePos.maxUnits}`);
        console.log(`  손절가: ${turtlePos.currentStopLoss.toLocaleString()}원`);
        console.log(`  다음 추가매수: ${turtlePos.nextAddPrice?.toLocaleString() || 'N/A'}원`);
        console.log(`  리스크: ${(turtlePos.riskAmount/10000).toFixed(0)}만원 (${turtlePos.riskPercent}%)`);
      }
    }
    
    // 포트폴리오 리스크 요약
    const riskSummary = this.getPortfolioRiskSummary();
    console.log('\n📊 포트폴리오 리스크 요약:', riskSummary);
    
    console.log('\n✅ 포트폴리오 트래커 모듈 테스트 완료!');
  }
}

module.exports = PortfolioTracker;