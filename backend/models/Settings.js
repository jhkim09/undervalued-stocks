const mongoose = require('mongoose');

// 사용자 설정 및 환경설정
const settingsSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  
  // 키움 API 설정
  kiwoom: {
    accountNumber: { type: String, required: true }, // 계좌번호
    password: { type: String },                       // 계좌비밀번호 (암호화)
    isLive: { type: Boolean, default: false },        // 실계좌 여부
    isConnected: { type: Boolean, default: false },   // 연결 상태
    lastConnected: { type: Date }                     // 마지막 연결시간
  },
  
  // 터틀 트레이딩 설정
  turtle: {
    system1: {
      enabled: { type: Boolean, default: true },     // 시스템1 (20일) 활성화
      entryPeriod: { type: Number, default: 20 },    // 진입 기간
      exitPeriod: { type: Number, default: 10 }      // 청산 기간
    },
    system2: {
      enabled: { type: Boolean, default: true },     // 시스템2 (55일) 활성화  
      entryPeriod: { type: Number, default: 55 },    // 진입 기간
      exitPeriod: { type: Number, default: 20 }      // 청산 기간
    },
    riskManagement: {
      maxRiskPerTrade: { type: Number, default: 0.02 },  // 2% 룰
      maxPositions: { type: Number, default: 10 },       // 최대 보유 종목수
      atrPeriod: { type: Number, default: 20 },          // ATR 계산 기간
      stopLossMultiple: { type: Number, default: 2 }     // 손절 배수 (2N)
    }
  },
  
  // 관심 종목 리스트
  watchlist: [{
    symbol: { type: String, required: true },     // 종목코드
    name: { type: String, required: true },       // 종목명
    priority: { 
      type: String, 
      enum: ['high', 'medium', 'low'], 
      default: 'medium' 
    },
    addedDate: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true }
  }],
  
  // 알람 설정
  notifications: {
    makeWebhookUrl: { type: String },             // Make.com webhook URL
    isEnabled: { type: Boolean, default: true },  // 알람 활성화
    
    schedule: {
      morningReport: { 
        time: { type: String, default: '08:00' },  // 아침 리포트 시간
        enabled: { type: Boolean, default: true }
      },
      instantAlerts: { type: Boolean, default: true }, // 즉시 알람
      weekendAlerts: { type: Boolean, default: false } // 주말 알람
    },
    
    channels: {
      email: { type: String },                    // 이메일 주소
      telegram: { type: String },                 // 텔레그램 chat_id
      kakao: { type: String },                    // 카카오톡 설정
      sms: { type: String }                       // SMS 번호
    }
  },
  
  // 시장 데이터 설정
  market: {
    updateInterval: { type: Number, default: 60 }, // 업데이트 간격(초)
    tradingHours: {
      start: { type: String, default: '09:00' },
      end: { type: String, default: '15:30' }
    },
    holidays: [{ type: Date }]                    // 휴장일 목록
  },
  
  // UI 설정
  display: {
    theme: { type: String, enum: ['light', 'dark'], default: 'light' },
    currency: { type: String, default: 'KRW' },
    dateFormat: { type: String, default: 'YYYY-MM-DD' },
    timezone: { type: String, default: 'Asia/Seoul' }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Settings', settingsSchema);