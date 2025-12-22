/**
 * 터틀 통합 알림 모듈
 * 
 * 역할:
 * 1. 신규 진입 + 추가매수 신호 통합 알림
 * 2. Make.com 연동으로 슬랙/텔레그램 알림
 * 3. 일일 모니터링 리포트 생성
 * 4. 알림 우선순위 및 중복 제거
 */

const TurtlePyramiding = require('./turtlePyramiding');
const PortfolioTracker = require('./portfolioTracker');

class TurtleNotification {
  
  constructor() {
    this.portfolioTracker = new PortfolioTracker();
    this.lastNotificationTime = null;
    this.notificationHistory = [];
  }
  
  /**
   * 일일 터틀 신호 종합 분석 및 알림
   * @param {Object} customBalance - 선택적 계좌잔고 정보
   * @param {number} customBalance.accountBalance - 총 계좌잔고
   * @param {number} customBalance.totalEquity - 총 자산
   */
  async analyzeDailySignals(customBalance = null) {
    try {
      console.log('🔔 일일 터틀 신호 분석 시작...');
      
      const results = {
        timestamp: new Date().toISOString(),
        newEntrySignals: [],
        addPositionSignals: [],
        stopLossSignals: [],
        portfolioStatus: null,
        notifications: [],
        accountInfo: null
      };
      
      // 0. 계좌잔고 설정 (입력값 우선, 없으면 키움에서 조회)
      let accountBalance = null;
      if (customBalance?.accountBalance) {
        accountBalance = customBalance.accountBalance;
        console.log(`💰 입력된 계좌잔고: ${(accountBalance/10000).toFixed(0)}만원`);
        results.accountInfo = {
          source: 'INPUT',
          balance: accountBalance,
          totalEquity: customBalance.totalEquity || accountBalance
        };
      } else {
        try {
          const KiwoomService = require('./kiwoomService');
          const kiwoomAccount = await KiwoomService.getAccountBalance();
          if (kiwoomAccount?.totalAsset) {
            accountBalance = kiwoomAccount.totalAsset;
            console.log(`💰 키움에서 조회한 계좌잔고: ${(accountBalance/10000).toFixed(0)}만원`);
            results.accountInfo = {
              source: 'KIWOOM',
              balance: accountBalance,
              totalEquity: kiwoomAccount.totalAsset,
              cash: kiwoomAccount.cash
            };
          }
        } catch (error) {
          console.warn('키움 계좌 조회 실패, 기본값 사용:', error.message);
          accountBalance = 1000000; // 기본값: 100만원
          results.accountInfo = {
            source: 'DEFAULT',
            balance: accountBalance,
            note: '키움 연결 실패'
          };
        }
      }
      
      // 전역 투자 예산 설정 (터틀 분석기에서 사용)
      global.investmentBudget = accountBalance;
      
      // 1. 기존 터틀 분석기에서 신규 진입 신호 조회 (계좌잔고 반영됨)
      const TurtleAnalyzer = require('./turtleAnalyzer');
      results.newEntrySignals = await TurtleAnalyzer.analyzeMarket();
      
      // 2. 키움 잔고와 동기화하여 현재 포지션 파악
      const syncResults = await this.portfolioTracker.syncWithKiwoomAccount();
      results.portfolioStatus = syncResults;
      
      // 3. 각 보유종목에 대해 추가매수 및 손절 신호 체크
      if (syncResults.turtlePositions.length > 0) {
        console.log(`📊 ${syncResults.turtlePositions.length}개 터틀 포지션 분석...`);
        
        for (const position of syncResults.turtlePositions) {
          // 현재가 업데이트 (실시간 가격)
          const KiwoomService = require('./kiwoomService');
          const currentPrice = await KiwoomService.getCurrentPrice(position.symbol) || position.currentPrice;
          
          // 추가매수 신호 체크
          const addSignal = TurtlePyramiding.checkAddSignal(position, currentPrice);
          if (addSignal) {
            results.addPositionSignals.push(addSignal);
          }
          
          // 손절 신호 체크
          const stopSignal = TurtlePyramiding.checkStopLossSignal(position, currentPrice);
          if (stopSignal) {
            results.stopLossSignals.push(stopSignal);
          }
        }
      }
      
      // 4. 알림 메시지 생성
      results.notifications = this.generateNotificationMessages(results);
      
      // 5. Make.com으로 알림 전송
      if (results.notifications.length > 0) {
        await this.sendNotifications(results.notifications);
      }
      
      // 6. 히스토리 저장
      this.saveNotificationHistory(results);
      
      console.log(`✅ 일일 터틀 신호 분석 완료: 신규진입 ${results.newEntrySignals.length}개, 추가매수 ${results.addPositionSignals.length}개, 손절 ${results.stopLossSignals.length}개`);
      
      return results;
      
    } catch (error) {
      console.error('❌ 일일 터틀 신호 분석 실패:', error.message);
      throw error;
    }
  }
  
  /**
   * 알림 메시지 생성 (우선순위별)
   */
  generateNotificationMessages(analysisResults) {
    const messages = [];
    
    // 1. 긴급 손절 알림 (최우선)
    if (analysisResults.stopLossSignals.length > 0) {
      const stopLossMsg = this.createStopLossMessage(analysisResults.stopLossSignals);
      messages.push({
        type: 'STOP_LOSS',
        priority: 'URGENT',
        title: '🚨 터틀 손절 신호 발생!',
        message: stopLossMsg,
        urgency: 'HIGH'
      });
    }
    
    // 2. 추가매수 알림
    if (analysisResults.addPositionSignals.length > 0) {
      const addPositionMsg = this.createAddPositionMessage(analysisResults.addPositionSignals);
      messages.push({
        type: 'ADD_POSITION',
        priority: 'HIGH',
        title: '📈 터틀 추가매수 타이밍!',
        message: addPositionMsg,
        urgency: 'MEDIUM'
      });
    }
    
    // 3. 신규 진입 알림 (20개씩 분할)
    if (analysisResults.newEntrySignals.length > 0) {
      const newEntryMessages = this.createNewEntryMessages(analysisResults.newEntrySignals);
      newEntryMessages.forEach(msgData => {
        messages.push({
          type: 'NEW_ENTRY',
          priority: 'MEDIUM',
          title: msgData.title,
          message: msgData.message,
          urgency: 'LOW'
        });
      });
    }
    
    // 4. 일일 포트폴리오 상태 리포트
    const portfolioMsg = this.createPortfolioStatusMessage(analysisResults.portfolioStatus);
    if (portfolioMsg) {
      messages.push({
        type: 'PORTFOLIO_STATUS',
        priority: 'LOW',
        title: '📊 터틀 포트폴리오 현황',
        message: portfolioMsg,
        urgency: 'LOW'
      });
    }
    
    return messages.sort((a, b) => this.getPriorityValue(a.priority) - this.getPriorityValue(b.priority));
  }
  
  /**
   * 손절 메시지 생성
   */
  createStopLossMessage(stopLossSignals) {
    let message = `⚠️ ${stopLossSignals.length}개 종목 손절 신호 발생!\n\n`;
    
    stopLossSignals.forEach(signal => {
      const lossAmount = (signal.lossAmount / 10000).toFixed(0);
      message += `📉 ${signal.name}(${signal.symbol})\n`;
      message += `   현재가: ${signal.currentPrice.toLocaleString()}원\n`;
      message += `   손절가: ${signal.stopLossPrice.toLocaleString()}원\n`;
      message += `   예상손실: ${lossAmount}만원\n`;
      message += `   수량: ${signal.totalQuantity.toLocaleString()}주\n\n`;
    });
    
    message += '💡 즉시 매도를 고려하세요!';
    return message;
  }
  
  /**
   * 추가매수 메시지 생성
   */
  createAddPositionMessage(addPositionSignals) {
    let message = `🚀 ${addPositionSignals.length}개 종목 추가매수 타이밍!\n\n`;
    
    addPositionSignals.forEach(signal => {
      const addAmount = (signal.investment.addAmount / 10000).toFixed(0);
      message += `📈 ${signal.name}(${signal.symbol}) - Level ${signal.addLevel}\n`;
      message += `   현재가: ${signal.currentPrice.toLocaleString()}원\n`;
      message += `   추가매수량: ${signal.unitSize}주\n`;
      message += `   투자금액: ${addAmount}만원\n`;
      message += `   신규평균가: ${signal.afterAdd.newAveragePrice.toLocaleString()}원\n`;
      message += `   신규손절가: ${signal.afterAdd.newStopLoss.toLocaleString()}원\n\n`;
    });
    
    message += '💡 0.5N 상승 돌파 확인 후 매수하세요!';
    return message;
  }
  
  /**
   * 신규 진입 메시지 생성 (20개씩 분할)
   */
  createNewEntryMessages(newEntrySignals) {
    const messages = [];
    const chunkSize = 20;
    const totalSignals = newEntrySignals.length;

    // 20개씩 나누어 처리
    for (let i = 0; i < totalSignals; i += chunkSize) {
      const chunk = newEntrySignals.slice(i, i + chunkSize);
      const currentPage = Math.floor(i / chunkSize) + 1;
      const totalPages = Math.ceil(totalSignals / chunkSize);

      let message = `🐢 터틀 신규 진입 신호 (${currentPage}/${totalPages})\n`;
      message += `📊 총 ${totalSignals}개 중 ${chunk.length}개 종목\n\n`;

      chunk.forEach(signal => {
        const investment = signal.recommendedAction?.investment?.actualAmount;
        const investmentDisplay = investment && !isNaN(investment) && investment !== 'NaN' ? (investment / 10000).toFixed(0) : '데이터부족';
        const stopLossPrice = signal.recommendedAction?.risk?.stopLossPrice;
        const stopLossDisplay = stopLossPrice && !isNaN(stopLossPrice) && stopLossPrice !== 'N/A' && stopLossPrice !== '데이터 부족' ? stopLossPrice.toLocaleString() : '데이터부족';

        message += `💰 ${signal.name}(${signal.symbol})\n`;
        message += `   현재가: ${signal.currentPrice.toLocaleString()}원\n`;
        message += `   돌파가: ${signal.breakoutPrice.toLocaleString()}원\n`;
        message += `   추천투자: ${investmentDisplay}만원\n`;
        message += `   손절가: ${stopLossDisplay}원\n\n`;
      });

      message += '💡 20일 고점 돌파 확인 후 진입하세요!';

      messages.push({
        title: `🐢 터틀 신규 진입 신호! (${currentPage}/${totalPages})`,
        message: message
      });
    }

    return messages;
  }

  /**
   * 신규 진입 메시지 생성 (기존 호환성용)
   */
  createNewEntryMessage(newEntrySignals) {
    return this.createNewEntryMessages(newEntrySignals)[0]?.message || '';
  }
  
  /**
   * 포트폴리오 상태 메시지 생성
   */
  createPortfolioStatusMessage(portfolioStatus) {
    if (!portfolioStatus || portfolioStatus.turtlePositions.length === 0) {
      return '📊 현재 터틀 포지션 없음';
    }
    
    const riskSummary = this.portfolioTracker.getPortfolioRiskSummary();
    
    let message = `📊 터틀 포트폴리오 현황 (${riskSummary.totalPositions}개 포지션)\n\n`;
    message += `💰 총 리스크: ${(riskSummary.totalRiskAmount / 10000).toFixed(0)}만원\n`;
    message += `📈 평균 리스크: ${riskSummary.averageRiskPercent}%\n\n`;
    
    message += '🎯 보유 포지션:\n';
    riskSummary.positions.forEach(pos => {
      const status = pos.canAddMore ? '✅ 추가매수 가능' : '⭕ 만량';
      message += `  ${pos.name}: ${pos.currentUnits}/${pos.maxUnits} 유닛 ${status}\n`;
    });
    
    return message;
  }
  
  /**
   * Make.com으로 알림 전송
   */
  async sendNotifications(notifications) {
    try {
      // Make.com webhook URL (환경변수에서 가져와야 함)
      const webhookUrl = process.env.MAKE_WEBHOOK_URL_TURTLE_NOTIFICATION;
      
      if (!webhookUrl) {
        console.log('⚠️ Make.com webhook URL 미설정, 로컬 출력으로 대체');
        this.logNotificationsLocally(notifications);
        return;
      }
      
      const axios = require('axios');
      
      // 각 알림별로 개별 전송 (우선순위 순서)
      for (const notification of notifications) {
        const payload = {
          type: notification.type,
          priority: notification.priority,
          urgency: notification.urgency,
          title: notification.title,
          message: notification.message,
          timestamp: new Date().toISOString(),
          source: 'TURTLE_PYRAMIDING_SYSTEM'
        };
        
        console.log(`📤 Make.com 알림 전송: ${notification.title}`);
        
        const response = await axios.post(webhookUrl, payload, {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (response.status === 200) {
          console.log(`✅ ${notification.type} 알림 전송 성공`);
        }
        
        // 연속 호출 방지를 위한 짧은 대기
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      this.lastNotificationTime = new Date().toISOString();
      
    } catch (error) {
      console.error('❌ Make.com 알림 전송 실패:', error.message);
      // 실패시 로컬 출력으로 fallback
      this.logNotificationsLocally(notifications);
    }
  }
  
  /**
   * 로컬 콘솔에 알림 출력 (Make.com 실패시 fallback)
   */
  logNotificationsLocally(notifications) {
    console.log('\n' + '='.repeat(50));
    console.log('📢 터틀 트레이딩 일일 알림');
    console.log('='.repeat(50));
    
    notifications.forEach(notification => {
      console.log(`\n${notification.title}`);
      console.log('-'.repeat(30));
      console.log(notification.message);
    });
    
    console.log('\n' + '='.repeat(50));
  }
  
  /**
   * 알림 히스토리 저장
   */
  saveNotificationHistory(analysisResults) {
    this.notificationHistory.push({
      timestamp: analysisResults.timestamp,
      newEntryCount: analysisResults.newEntrySignals.length,
      addPositionCount: analysisResults.addPositionSignals.length,
      stopLossCount: analysisResults.stopLossSignals.length,
      notificationCount: analysisResults.notifications.length,
      portfolioPositions: analysisResults.portfolioStatus?.turtlePositions.length || 0
    });
    
    // 최근 30일만 보관
    if (this.notificationHistory.length > 30) {
      this.notificationHistory = this.notificationHistory.slice(-30);
    }
  }
  
  /**
   * 우선순위 값 변환
   */
  getPriorityValue(priority) {
    const priorityMap = {
      'URGENT': 1,
      'HIGH': 2,
      'MEDIUM': 3,
      'LOW': 4
    };
    return priorityMap[priority] || 5;
  }
  
  /**
   * 알림 히스토리 조회
   */
  getNotificationHistory() {
    return this.notificationHistory;
  }
  
  /**
   * 독립 테스트 실행
   */
  async runTest() {
    console.log('🧪 터틀 통합 알림 모듈 테스트 시작...');
    
    // 모의 분석 결과 생성
    const mockResults = {
      timestamp: new Date().toISOString(),
      newEntrySignals: [{
        symbol: '005930',
        name: '삼성전자',
        signalType: 'BUY_20',
        currentPrice: 72500,
        breakoutPrice: 72000,
        recommendedAction: {
          investment: { actualAmount: 1000000 },
          risk: { stopLossPrice: 70000 }
        }
      }],
      addPositionSignals: [{
        symbol: '000660',
        name: 'SK하이닉스',
        signalType: 'TURTLE_ADD',
        currentPrice: 185000,
        addLevel: 2,
        unitSize: 50,
        investment: { addAmount: 9250000 },
        afterAdd: { 
          newAveragePrice: 182500,
          newStopLoss: 178500
        }
      }],
      stopLossSignals: [],
      portfolioStatus: {
        turtlePositions: [
          { symbol: '005930', name: '삼성전자' },
          { symbol: '000660', name: 'SK하이닉스' }
        ]
      }
    };
    
    // 알림 메시지 생성 테스트
    const notifications = this.generateNotificationMessages(mockResults);
    
    console.log(`📊 생성된 알림: ${notifications.length}개`);
    
    notifications.forEach(notification => {
      console.log(`\n📢 ${notification.title} (${notification.priority})`);
      console.log(notification.message.slice(0, 200) + '...');
    });
    
    console.log('\n✅ 터틀 통합 알림 모듈 테스트 완료!');
  }
}

module.exports = TurtleNotification;