const mongoose = require('mongoose');

const financialDataSchema = new mongoose.Schema({
  // 기본 정보
  stockCode: {
    type: String,
    required: true
  },
  corpCode: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  
  // 연도별 재무 데이터
  year: {
    type: Number,
    required: true
  },
  
  // 재무 지표 (단위: 억원)
  revenue: {
    type: Number,
    default: 0
  },
  netIncome: {
    type: Number,
    default: 0
  },
  operatingIncome: {
    type: Number,
    default: 0
  },
  totalAssets: {
    type: Number,
    default: 0
  },
  
  // 상장주식수 (단위: 주)
  sharesOutstanding: {
    type: Number,
    default: 0
  },
  
  // 성장률 (%) - 3개년 기준
  revenueGrowth3Y: {
    type: Number,
    default: 0
  },
  netIncomeGrowth3Y: {
    type: Number,
    default: 0
  },
  
  // 데이터 소스 및 품질
  dataSource: {
    type: String,
    enum: ['DART', 'HARDCODED', 'ESTIMATED'],
    default: 'DART'
  },
  
  // 데이터 수집 정보
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  dataYear: {
    type: Number, // 데이터가 수집된 년도 (2024년에 2023년 데이터 수집)
    required: true
  },
  
  // 추가 메타데이터
  isValidated: {
    type: Boolean,
    default: false
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true,
  collection: 'financialData'
});

// 복합 인덱스 (성능 최적화)
financialDataSchema.index({ stockCode: 1, year: -1 }); // 종목별 최신년도 순
financialDataSchema.index({ stockCode: 1, dataYear: -1 }); // 종목별 데이터 수집년도 순
financialDataSchema.index({ dataYear: -1, lastUpdated: -1 }); // 수집년도별 최신순

// 정적 메서드: 특정 종목의 최신 재무데이터 조회
financialDataSchema.statics.getLatestFinancialData = async function(stockCode) {
  try {
    // 가장 최근 데이터년도의 데이터 조회
    const latestData = await this.findOne({ 
      stockCode: stockCode 
    }).sort({ 
      dataYear: -1, 
      year: -1 
    });
    
    if (!latestData) {
      return null;
    }
    
    // 같은 dataYear의 3개년 데이터 모두 조회
    const allYearsData = await this.find({ 
      stockCode: stockCode,
      dataYear: latestData.dataYear
    }).sort({ year: -1 });
    
    return {
      latest: latestData,
      allYears: allYearsData,
      hasFullData: allYearsData.length >= 3
    };
    
  } catch (error) {
    console.error(`재무데이터 조회 실패 (${stockCode}):`, error);
    return null;
  }
};

// 정적 메서드: 특정 년도에 수집된 모든 재무데이터 조회
financialDataSchema.statics.getDataByCollectionYear = async function(dataYear) {
  try {
    return await this.find({ 
      dataYear: dataYear 
    }).sort({ 
      stockCode: 1, 
      year: -1 
    });
  } catch (error) {
    console.error(`${dataYear}년 수집 데이터 조회 실패:`, error);
    return [];
  }
};

// 정적 메서드: 재무데이터 일괄 저장/업데이트
financialDataSchema.statics.saveFinancialData = async function(stockCode, corpCode, name, yearlyData, dataYear) {
  try {
    const operations = [];
    
    for (const data of yearlyData) {
      operations.push({
        updateOne: {
          filter: { 
            stockCode: stockCode, 
            year: data.year,
            dataYear: dataYear 
          },
          update: {
            $set: {
              corpCode: corpCode,
              name: name,
              revenue: data.revenue || 0,
              netIncome: data.netIncome || 0,
              operatingIncome: data.operatingIncome || 0,
              totalAssets: data.totalAssets || 0,
              sharesOutstanding: data.sharesOutstanding || 0,
              revenueGrowth3Y: data.revenueGrowth3Y || 0,
              netIncomeGrowth3Y: data.netIncomeGrowth3Y || 0,
              dataSource: data.dataSource || 'DART',
              lastUpdated: new Date(),
              isValidated: data.isValidated || false,
              notes: data.notes || ''
            }
          },
          upsert: true
        }
      });
    }
    
    const result = await this.bulkWrite(operations);
    console.log(`✅ ${stockCode} 재무데이터 저장 완료: ${yearlyData.length}개년, 수집년도: ${dataYear}`);
    
    return result;
    
  } catch (error) {
    console.error(`재무데이터 저장 실패 (${stockCode}):`, error);
    throw error;
  }
};

// 인스턴스 메서드: PSR 계산 (현재가 필요)
financialDataSchema.methods.calculatePSR = function(currentPrice) {
  if (!this.sharesOutstanding || !this.revenue || this.revenue <= 0) {
    return null;
  }
  
  const marketCap = currentPrice * this.sharesOutstanding;
  const revenueInWon = this.revenue * 100000000; // 억원 → 원
  const psr = marketCap / revenueInWon;
  
  return Math.round(psr * 1000) / 1000; // 소수점 3자리
};

// 인스턴스 메서드: 슈퍼스톡스 조건 검사
financialDataSchema.methods.meetsSuperstocksConditions = function(currentPrice, minRevenueGrowth = 15, minNetIncomeGrowth = 15, maxPSR = 0.75) {
  const psr = this.calculatePSR(currentPrice);
  
  if (psr === null) {
    return false;
  }
  
  return (
    this.revenueGrowth3Y >= minRevenueGrowth &&
    this.netIncomeGrowth3Y >= minNetIncomeGrowth &&
    psr <= maxPSR
  );
};

const FinancialData = mongoose.model('FinancialData', financialDataSchema);

module.exports = FinancialData;