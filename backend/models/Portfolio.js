const mongoose = require('mongoose');

// 포트폴리오 및 잔고 관리
const portfolioSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  
  // 잔고 정보
  initialBalance: {
    type: Number,
    required: true,
    default: 0
  },
  
  currentCash: {
    type: Number,
    required: true,
    default: 0
  },
  
  totalEquity: {
    type: Number,
    required: true,
    default: 0
  },
  
  // 현재 보유 포지션들
  positions: [{
    symbol: { type: String, required: true },        // 종목코드
    name: { type: String, required: true },          // 종목명
    quantity: { type: Number, required: true },      // 보유수량
    avgPrice: { type: Number, required: true },      // 평균매수가
    currentPrice: { type: Number, default: 0 },      // 현재가
    unrealizedPL: { type: Number, default: 0 },      // 평가손익
    stopLossPrice: { type: Number, required: true }, // 손절가격
    entryDate: { type: Date, required: true },       // 진입일
    entrySignal: { 
      type: String, 
      enum: ['20day_breakout', '55day_breakout'], 
      required: true 
    },
    atr: { type: Number, required: true },           // 진입시점 ATR
    riskAmount: { type: Number, required: true }     // 해당 포지션 리스크금액
  }],
  
  // 리스크 관리 설정
  riskSettings: {
    maxRiskPerTrade: { type: Number, default: 0.02 }, // 거래당 최대 리스크 (2%)
    maxTotalRisk: { type: Number, default: 0.10 },    // 총 리스크 한도 (10%)
    minCashReserve: { type: Number, default: 0.20 }   // 최소 현금 보유 (20%)
  },
  
  // 통계
  stats: {
    totalTrades: { type: Number, default: 0 },
    winningTrades: { type: Number, default: 0 },
    totalProfit: { type: Number, default: 0 },
    totalLoss: { type: Number, default: 0 },
    largestWin: { type: Number, default: 0 },
    largestLoss: { type: Number, default: 0 },
    winRate: { type: Number, default: 0 },
    profitFactor: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

// 가상 필드 - 현재 포트폴리오 가치
portfolioSchema.virtual('portfolioValue').get(function() {
  const positionValue = this.positions.reduce((sum, pos) => 
    sum + (pos.currentPrice * pos.quantity), 0);
  return this.currentCash + positionValue;
});

// 가상 필드 - 총 수익률
portfolioSchema.virtual('totalReturn').get(function() {
  if (this.initialBalance === 0) return 0;
  return ((this.portfolioValue - this.initialBalance) / this.initialBalance) * 100;
});

// 가상 필드 - 현재 리스크 노출
portfolioSchema.virtual('currentRiskExposure').get(function() {
  return this.positions.reduce((sum, pos) => sum + pos.riskAmount, 0);
});

module.exports = mongoose.model('Portfolio', portfolioSchema);