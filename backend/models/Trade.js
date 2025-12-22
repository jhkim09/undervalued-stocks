const mongoose = require('mongoose');

// 매매 거래 기록
const tradeSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  
  // 거래 기본 정보
  symbol: { type: String, required: true },      // 종목코드
  name: { type: String, required: true },        // 종목명
  action: { 
    type: String, 
    enum: ['BUY', 'SELL'], 
    required: true 
  },
  
  // 거래 상세
  quantity: { type: Number, required: true },    // 거래량
  price: { type: Number, required: true },       // 체결가격
  totalAmount: { type: Number, required: true }, // 총 거래금액
  commission: { type: Number, default: 0 },      // 수수료
  tax: { type: Number, default: 0 },            // 세금
  netAmount: { type: Number, required: true },   // 순 거래금액
  
  // 터틀 트레이딩 정보
  signal: {
    type: String,
    enum: ['20day_breakout', '10day_breakdown', '55day_breakout', '20day_breakdown', 'stop_loss'],
    required: true
  },
  
  atr: { type: Number, required: true },         // 거래시점 ATR
  nValue: { type: Number, required: true },      // N값 (20일 ATR)
  riskAmount: { type: Number, required: true },  // 해당 거래의 리스크
  
  // 포지션 정보 (매수시)
  stopLossPrice: { type: Number },              // 손절가격
  targetProfit: { type: Number },               // 목표수익
  
  // 매도시 성과 (매도 거래일 경우)
  entryPrice: { type: Number },                 // 평균매수가
  realizedPL: { type: Number },                 // 실현손익
  holdingDays: { type: Number },                // 보유일수
  rMultiple: { type: Number },                  // R배수 (수익/리스크)
  
  // 시장 상황
  marketCondition: {
    kospiIndex: { type: Number },               // 코스피 지수
    kospiChange: { type: Number },              // 코스피 변동률
    marketTrend: { 
      type: String, 
      enum: ['bullish', 'bearish', 'sideways'],
      default: 'sideways'
    }
  },
  
  // 메모 및 분석
  notes: { type: String, default: '' },         // 거래 메모
  isSuccessful: { type: Boolean },              // 성공 거래 여부
  reason: { type: String },                     // 매도 사유
  
  // 시스템 정보
  tradeDate: { type: Date, required: true },    // 거래일
  recordedAt: { type: Date, default: Date.now } // 기록일시
}, {
  timestamps: true
});

// 인덱스 설정
tradeSchema.index({ userId: 1, tradeDate: -1 });
tradeSchema.index({ symbol: 1, tradeDate: -1 });
tradeSchema.index({ action: 1, signal: 1 });

// 수수료 자동 계산 미들웨어
tradeSchema.pre('save', function(next) {
  // 한국 주식 수수료 계산 (매수: 0.015%, 매도: 0.015% + 세금 0.23%)
  if (this.action === 'BUY') {
    this.commission = Math.round(this.totalAmount * 0.00015);
    this.tax = 0;
  } else if (this.action === 'SELL') {
    this.commission = Math.round(this.totalAmount * 0.00015);
    this.tax = Math.round(this.totalAmount * 0.0023); // 증권거래세
  }
  
  // 순 거래금액 계산
  if (this.action === 'BUY') {
    this.netAmount = this.totalAmount + this.commission;
  } else {
    this.netAmount = this.totalAmount - this.commission - this.tax;
  }
  
  next();
});

module.exports = mongoose.model('Trade', tradeSchema);