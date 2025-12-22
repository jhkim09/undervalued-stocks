/**
 * 터틀 피라미딩 (추가매수) 전담 모듈
 * 
 * 역할:
 * 1. 보유종목의 추가매수 타이밍 계산
 * 2. 유닛별 진입가 관리
 * 3. 손절가 업데이트
 * 4. 다음 추가매수 목표가 계산
 */

class TurtlePyramiding {
  
  /**
   * 추가매수 신호 체크
   * @param {Object} position - 현재 포지션 정보
   * @param {number} currentPrice - 현재가
   * @returns {Object|null} - 추가매수 신호 또는 null
   */
  static checkAddSignal(position, currentPrice) {
    try {
      // 필수 데이터 검증
      if (!this.validatePosition(position)) {
        return null;
      }
      
      // 최대 유닛 수 체크
      if (position.currentUnits >= position.maxUnits) {
        console.log(`📊 ${position.symbol}: 최대 유닛(${position.maxUnits}) 도달, 추가매수 불가`);
        return null;
      }
      
      // 다음 추가매수 목표가 계산
      const nextAddPrice = this.calculateNextAddPrice(position);
      
      // 현재가가 목표가에 도달했는지 체크
      if (currentPrice >= nextAddPrice) {
        const signal = {
          symbol: position.symbol,
          name: position.name,
          signalType: 'TURTLE_ADD',
          currentPrice: currentPrice,
          targetPrice: nextAddPrice,
          addLevel: position.currentUnits + 1,
          unitSize: position.unitSize,
          originalN: position.originalN,
          currentStopLoss: this.calculateCurrentStopLoss(position),
          
          // 추가매수 후 예상 상태
          afterAdd: {
            totalUnits: position.currentUnits + 1,
            newAveragePrice: this.calculateNewAveragePrice(position, currentPrice),
            newStopLoss: this.calculateNewStopLossAfterAdd(position, currentPrice),
            nextAddPrice: this.calculateNextAddPriceAfterAdd(position)
          },
          
          // 투자 정보
          investment: {
            addAmount: position.unitSize * currentPrice,
            totalInvestment: (position.totalQuantity + position.unitSize) * this.calculateNewAveragePrice(position, currentPrice),
            riskAmount: this.calculateRiskAfterAdd(position, currentPrice)
          },
          
          timestamp: new Date().toISOString()
        };
        
        console.log(`🚀 ${position.symbol} 추가매수 신호! Level ${signal.addLevel} at ${currentPrice.toLocaleString()}원`);
        return signal;
      }
      
      return null;
      
    } catch (error) {
      console.error(`추가매수 신호 체크 실패 (${position?.symbol}):`, error.message);
      return null;
    }
  }
  
  /**
   * 포지션 데이터 유효성 검사
   */
  static validatePosition(position) {
    const required = ['symbol', 'originalEntryPrice', 'originalN', 'currentUnits', 'maxUnits', 'unitSize', 'totalQuantity'];
    
    for (const field of required) {
      if (!position[field] && position[field] !== 0) {
        console.log(`⚠️ ${position?.symbol || 'unknown'}: 필수 필드 누락 - ${field}`);
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * 다음 추가매수 목표가 계산
   * 규칙: 마지막 진입가 + 0.5N
   */
  static calculateNextAddPrice(position) {
    const lastEntryPrice = this.getLastEntryPrice(position);
    return Math.round(lastEntryPrice + (position.originalN * 0.5));
  }
  
  /**
   * 마지막 진입가 조회
   * 유닛별 진입가가 있으면 마지막 것, 없으면 최초 진입가
   */
  static getLastEntryPrice(position) {
    if (position.unitEntries && position.unitEntries.length > 0) {
      return position.unitEntries[position.unitEntries.length - 1].price;
    }
    return position.originalEntryPrice;
  }
  
  /**
   * 현재 손절가 계산
   * 규칙: 평균가 - 2N
   */
  static calculateCurrentStopLoss(position) {
    const avgPrice = this.calculateCurrentAveragePrice(position);
    return Math.round(avgPrice - (position.originalN * 2));
  }
  
  /**
   * 현재 평균가 계산
   */
  static calculateCurrentAveragePrice(position) {
    if (position.unitEntries && position.unitEntries.length > 0) {
      const totalCost = position.unitEntries.reduce((sum, entry) => {
        return sum + (entry.price * entry.quantity);
      }, 0);
      return Math.round(totalCost / position.totalQuantity);
    }
    return position.originalEntryPrice;
  }
  
  /**
   * 추가매수 후 새로운 평균가 계산
   */
  static calculateNewAveragePrice(position, addPrice) {
    const currentCost = position.totalQuantity * this.calculateCurrentAveragePrice(position);
    const addCost = position.unitSize * addPrice;
    const newTotalQuantity = position.totalQuantity + position.unitSize;
    
    return Math.round((currentCost + addCost) / newTotalQuantity);
  }
  
  /**
   * 추가매수 후 새로운 손절가 계산
   */
  static calculateNewStopLossAfterAdd(position, addPrice) {
    const newAvgPrice = this.calculateNewAveragePrice(position, addPrice);
    return Math.round(newAvgPrice - (position.originalN * 2));
  }
  
  /**
   * 추가매수 후 다음 추가매수 목표가 계산
   */
  static calculateNextAddPriceAfterAdd(position) {
    // 추가매수 가격에서 + 0.5N
    return Math.round(position.currentPrice + (position.originalN * 0.5));
  }
  
  /**
   * 추가매수 후 리스크 금액 계산
   */
  static calculateRiskAfterAdd(position, addPrice) {
    const newTotalQuantity = position.totalQuantity + position.unitSize;
    const newStopLoss = this.calculateNewStopLossAfterAdd(position, addPrice);
    const newAvgPrice = this.calculateNewAveragePrice(position, addPrice);
    
    return newTotalQuantity * (newAvgPrice - newStopLoss);
  }
  
  /**
   * 포지션 업데이트 (추가매수 실행 후)
   */
  static updatePositionAfterAdd(position, addPrice) {
    const newUnits = position.currentUnits + 1;
    const newTotalQuantity = position.totalQuantity + position.unitSize;
    const newAvgPrice = this.calculateNewAveragePrice(position, addPrice);
    
    // 유닛 진입 기록 업데이트
    const updatedUnitEntries = [...(position.unitEntries || [])];
    updatedUnitEntries.push({
      level: newUnits,
      price: addPrice,
      quantity: position.unitSize,
      timestamp: new Date().toISOString()
    });
    
    return {
      ...position,
      currentUnits: newUnits,
      totalQuantity: newTotalQuantity,
      currentAveragePrice: newAvgPrice,
      currentStopLoss: this.calculateNewStopLossAfterAdd(position, addPrice),
      nextAddPrice: newUnits < position.maxUnits ? 
        Math.round(addPrice + (position.originalN * 0.5)) : null,
      unitEntries: updatedUnitEntries,
      lastUpdateTime: new Date().toISOString()
    };
  }
  
  /**
   * 손절 신호 체크
   */
  static checkStopLossSignal(position, currentPrice) {
    const stopLossPrice = this.calculateCurrentStopLoss(position);
    
    if (currentPrice <= stopLossPrice) {
      return {
        symbol: position.symbol,
        name: position.name,
        signalType: 'TURTLE_STOP_LOSS',
        currentPrice: currentPrice,
        stopLossPrice: stopLossPrice,
        totalQuantity: position.totalQuantity,
        avgPrice: this.calculateCurrentAveragePrice(position),
        lossAmount: position.totalQuantity * (this.calculateCurrentAveragePrice(position) - currentPrice),
        urgency: 'HIGH',
        timestamp: new Date().toISOString()
      };
    }
    
    return null;
  }
  
  /**
   * 포지션 상태 요약
   */
  static getPositionSummary(position) {
    return {
      symbol: position.symbol,
      name: position.name,
      currentUnits: position.currentUnits,
      maxUnits: position.maxUnits,
      totalQuantity: position.totalQuantity,
      avgPrice: this.calculateCurrentAveragePrice(position),
      stopLoss: this.calculateCurrentStopLoss(position),
      nextAddPrice: position.currentUnits < position.maxUnits ? 
        this.calculateNextAddPrice(position) : null,
      originalN: position.originalN,
      canAddMore: position.currentUnits < position.maxUnits
    };
  }
  
  /**
   * 독립 테스트용 - 모의 포지션 생성
   */
  static createMockPosition(symbol, entryPrice, atr) {
    return {
      symbol: symbol,
      name: `테스트종목_${symbol}`,
      originalEntryPrice: entryPrice,
      originalN: atr,
      currentUnits: 1,
      maxUnits: 4,
      unitSize: 100, // 100주씩 추가매수
      totalQuantity: 100,
      unitEntries: [{
        level: 1,
        price: entryPrice,
        quantity: 100,
        timestamp: new Date().toISOString()
      }]
    };
  }
  
  /**
   * 독립 테스트 실행
   */
  static runTest() {
    console.log('🧪 터틀 피라미딩 모듈 테스트 시작...');
    
    // 테스트 케이스 1: 삼성전자 가상 포지션
    const position = this.createMockPosition('005930', 70000, 2000);
    console.log('📊 초기 포지션:', this.getPositionSummary(position));
    
    // 테스트 케이스 2: 다양한 현재가에서 신호 체크
    const testPrices = [69000, 71000, 72000, 73500, 75000];
    
    testPrices.forEach(price => {
      const addSignal = this.checkAddSignal(position, price);
      const stopSignal = this.checkStopLossSignal(position, price);
      
      console.log(`\n💰 현재가 ${price.toLocaleString()}원:`);
      console.log('  추가매수:', addSignal ? '✅ 신호 발생' : '❌ 신호 없음');
      console.log('  손절매:', stopSignal ? '⚠️ 손절 신호!' : '✅ 안전');
      
      if (addSignal) {
        console.log(`  → Level ${addSignal.addLevel} 추가매수`);
        console.log(`  → 신규 평균가: ${addSignal.afterAdd.newAveragePrice.toLocaleString()}원`);
        console.log(`  → 신규 손절가: ${addSignal.afterAdd.newStopLoss.toLocaleString()}원`);
      }
    });
    
    console.log('\n✅ 터틀 피라미딩 모듈 테스트 완료!');
  }
}

module.exports = TurtlePyramiding;