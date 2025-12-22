const axios = require('axios');

class NotificationService {
  
  // 매일 아침 종합 리포트 발송
  static async sendDailyReport(signals, riskAnalysis) {
    try {
      console.log('📱 일일 리포트 발송 시작...');
      
      // 리포트 메시지 생성
      const message = this.generateDailyMessage(signals, riskAnalysis);
      
      // Make.com webhook으로 발송
      await this.sendToMake(message);
      
      console.log('✅ 일일 리포트 발송 완료');
      
    } catch (error) {
      console.error('❌ 리포트 발송 실패:', error);
      throw error;
    }
  }
  
  // 즉시 신호 알람
  static async sendInstantAlert(signal) {
    try {
      const message = this.generateSignalMessage(signal);
      await this.sendToMake(message);
      console.log(`🚨 즉시 알람 발송: ${signal.symbol} ${signal.signalType}`);
    } catch (error) {
      console.error('❌ 즉시 알람 실패:', error);
    }
  }
  
  // 일일 메시지 생성
  static generateDailyMessage(signals, riskAnalysis) {
    const today = new Date().toLocaleDateString('ko-KR');
    const buySignals = signals.filter(s => s.signalType.startsWith('BUY'));
    const sellSignals = signals.filter(s => s.signalType.startsWith('SELL'));
    
    let message = `🐢 터틀 신호 (${today})\n`;
    message += `💰 총 자산: ${this.formatWon(riskAnalysis.totalEquity)}\n`;
    message += `💵 가용 현금: ${this.formatWon(riskAnalysis.currentCash)}\n`;
    message += `⚡ 현재 리스크: ${riskAnalysis.riskPercentage?.toFixed(1) || 0}%\n\n`;
    
    // 매수 신호
    if (buySignals.length > 0) {
      message += `🔥 매수 신호 (${buySignals.length}개):\n`;
      buySignals.forEach(signal => {
        message += `• ${signal.name} (${signal.symbol})\n`;
        message += `  └ 20일 돌파: ${this.formatPrice(signal.currentPrice)}원\n`;
        if (signal.recommendedAction) {
          message += `  └ 추천량: ${signal.recommendedAction.quantity}주\n`;
          message += `  └ 리스크: ${this.formatWon(signal.recommendedAction.riskAmount)}\n`;
        }
      });
      message += '\n';
    }
    
    // 매도 신호
    if (sellSignals.length > 0) {
      message += `⚡ 매도 신호 (${sellSignals.length}개):\n`;
      sellSignals.forEach(signal => {
        message += `• ${signal.name} (${signal.symbol})\n`;
        message += `  └ 10일 하향돌파: ${this.formatPrice(signal.currentPrice)}원\n`;
      });
      message += '\n';
    }
    
    // 현재 포지션 요약
    if (riskAnalysis.positions && riskAnalysis.positions.length > 0) {
      message += `📊 보유 포지션 (${riskAnalysis.positions.length}개):\n`;
      riskAnalysis.positions.forEach(pos => {
        const plSign = pos.unrealizedPL >= 0 ? '+' : '';
        message += `• ${pos.name}: ${plSign}${this.formatWon(pos.unrealizedPL)}\n`;
      });
    } else {
      message += `📊 현재 보유 포지션 없음\n`;
    }
    
    return message;
  }
  
  // 개별 신호 메시지 생성
  static generateSignalMessage(signal) {
    const action = signal.signalType.startsWith('BUY') ? '🔥 매수' : '⚡ 매도';
    
    let message = `${action} 긴급 신호!\n\n`;
    message += `📈 ${signal.name} (${signal.symbol})\n`;
    message += `💰 현재가: ${this.formatPrice(signal.currentPrice)}원\n`;
    
    if (signal.signalType.startsWith('BUY')) {
      message += `🔺 20일 고점: ${this.formatPrice(signal.high20)}원 돌파\n`;
      if (signal.recommendedAction) {
        message += `📊 추천량: ${signal.recommendedAction.quantity}주\n`;
        message += `🎯 손절가: ${this.formatPrice(signal.recommendedAction.stopLossPrice)}원\n`;
      }
    } else {
      message += `🔻 10일 저점: ${this.formatPrice(signal.low10)}원 하향돌파\n`;
    }
    
    message += `📊 신호강도: ${signal.signalStrength}`;
    
    return message;
  }
  
  // Make.com webhook 발송
  static async sendToMake(message) {
    try {
      const webhookUrl = process.env.MAKE_WEBHOOK_URL;
      
      if (!webhookUrl) {
        console.log('⚠️ Make.com webhook URL이 설정되지 않았습니다.');
        console.log('📱 메시지 미리보기:');
        console.log(message);
        return;
      }
      
      const payload = {
        message: message,
        timestamp: new Date().toISOString(),
        source: 'TurtleInvest'
      };
      
      const response = await axios.post(webhookUrl, payload);
      
      if (response.status === 200) {
        console.log('✅ Make.com 발송 성공');
      } else {
        console.log('⚠️ Make.com 발송 실패:', response.status);
      }
      
    } catch (error) {
      console.error('❌ Make.com 발송 오류:', error.message);
      // 실패해도 메시지는 콘솔에 표시
      console.log('📱 메시지 내용:');
      console.log(message);
    }
  }
  
  // 숫자 포맷 함수들
  static formatWon(amount) {
    if (!amount) return '0원';
    return new Intl.NumberFormat('ko-KR').format(Math.round(amount)) + '원';
  }
  
  static formatPrice(price) {
    return new Intl.NumberFormat('ko-KR').format(Math.round(price));
  }
}

module.exports = NotificationService;