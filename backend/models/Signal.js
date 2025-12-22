const mongoose = require('mongoose');

// 터틀 트레이딩 신호 기록
const signalSchema = new mongoose.Schema({
  // 기본 정보
  symbol: { type: String, required: true },      // 종목코드
  name: { type: String, required: true },        // 종목명
  date: { type: Date, required: true },          // 신호 발생일
  
  // 신호 정보
  signalType: {
    type: String,
    enum: ['BUY_20', 'SELL_10', 'BUY_55', 'SELL_20'],
    required: true
  },
  
  // 가격 정보
  currentPrice: { type: Number, required: true }, // 현재가
  breakoutPrice: { type: Number, required: true }, // 돌파가격
  
  // 기술적 지표
  high20: { type: Number, required: true },       // 20일 최고가
  low10: { type: Number, required: true },        // 10일 최저가
  high55: { type: Number },                       // 55일 최고가 (시스템2)
  low20: { type: Number },                        // 20일 최저가 (시스템2)
  
  atr: { type: Number, required: true },          // ATR (변동성)
  nValue: { type: Number, required: true },       // N값 (20일 ATR)
  
  // 볼륨 정보
  volume: { type: Number, required: true },       // 거래량
  avgVolume20: { type: Number, required: true },  // 20일 평균거래량
  volumeRatio: { type: Number, required: true },  // 거래량 비율
  
  // 신호 강도
  signalStrength: {
    type: String,
    enum: ['weak', 'medium', 'strong'],
    required: true
  },
  
  // 필터 조건
  isPrimarySignal: { type: Boolean, default: true }, // 주 신호 여부
  lastSignalProfit: { type: Number },                // 직전 신호 수익
  filterApplied: { type: Boolean, default: false },  // 필터 적용 여부
  
  // 추천 액션
  recommendedAction: {
    action: { type: String, enum: ['BUY', 'SELL', 'HOLD', 'WATCH'] },
    quantity: { type: Number },                     // 추천 매매량
    riskAmount: { type: Number },                   // 예상 리스크
    stopLossPrice: { type: Number },                // 손절가격
    reasoning: { type: String }                     // 추천 사유
  },
  
  // 시장 컨텍스트
  marketContext: {
    kospiIndex: { type: Number },
    kospiChange: { type: Number },
    sectorPerformance: { type: String },            // 섹터 성과
    marketTrend: { 
      type: String, 
      enum: ['bull', 'bear', 'sideways'],
      default: 'sideways'
    }
  },
  
  // 처리 상태
  status: {
    type: String,
    enum: ['generated', 'sent', 'executed', 'ignored'],
    default: 'generated'
  },
  
  // 실행 결과 (나중에 업데이트)
  executionResult: {
    executed: { type: Boolean, default: false },
    executionPrice: { type: Number },
    executionQuantity: { type: Number },
    executionDate: { type: Date },
    notes: { type: String }
  }
}, {
  timestamps: true
});

// 인덱스 설정
signalSchema.index({ symbol: 1, date: -1 });
signalSchema.index({ signalType: 1, date: -1 });
signalSchema.index({ status: 1, date: -1 });

module.exports = mongoose.model('Signal', signalSchema);