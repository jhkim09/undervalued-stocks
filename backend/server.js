const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
require('dotenv').config();

// 라우트 임포트
const financialDataRoutes = require('./routes/financialData');
const stockNamesRoutes = require('./routes/stockNames');
const undervaluedRoutes = require('./routes/undervalued');

const app = express();
const PORT = process.env.PORT || 5000;

// 미들웨어
app.use(cors());
app.use(express.json());

// MongoDB 연결 (연결 실패해도 서버는 동작)
const mongoOptions = {
  writeConcern: {
    w: 'majority',
    j: true,
    wtimeout: 1000
  }
};

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/undervalued-stocks', mongoOptions)
.then(async () => {
  console.log('📊 MongoDB 연결 성공!');
  console.log('Database: undervalued-stocks');
  
  // 서버 시작시 DART API 기업코드 미리 로딩 (속도 개선)
  try {
    console.log('📦 DART API 기업코드 ZIP 파일 미리 로딩 시작...');
    const DartService = require('./services/dartService');
    await DartService.loadAllCorpCodes();
    console.log('✅ DART API 기업코드 미리 로딩 완료');
  } catch (err) {
    console.log('⚠️ DART API 기업코드 미리 로딩 실패:', err.message);
  }
})
.catch(err => {
  console.log('❌ MongoDB 연결 실패 - 메모리 모드로 실행');
  console.log('💡 나중에 MongoDB 설정하여 데이터 영구 저장 가능');
});

// API 라우트
app.use('/api/financial-data', financialDataRoutes);
app.use('/api/stock-names', stockNamesRoutes);
app.use('/api/undervalued', undervaluedRoutes);

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    const StockListService = require('./services/stockListService');
    const stats = StockListService.getStatistics();

    res.json({
      status: 'OK',
      message: '저평가주식 분석 API 서버 실행 중',
      system: {
        mode: 'VALUE_INVESTING',
        unifiedStocks: stats.total,
        breakdown: `코스피 ${stats.kospi} + 코스닥 ${stats.kosdaq}`
      },
      criteria: {
        PSR: '≤ 0.5',
        grahamNumber: 'PER × PBR ≤ 22.5',
        nonCurrentAssets: '10년 이상 보유 자산'
      },
      endpoints: {
        analyze: '/api/undervalued/analyze/:stockCode?price=현재가',
        bulkAnalyze: 'POST /api/undervalued/bulk-analyze',
        screen: '/api/undervalued/screen',
        criteria: '/api/undervalued/criteria'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      status: 'OK',
      message: '저평가주식 분석 API 서버 실행 중',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 연 1회 재무데이터 업데이트 (4월 1일 오전 6시)
// 사업보고서가 3월 말에 공시되므로 4월에 최신 데이터 수집
cron.schedule('0 6 1 4 *', async () => {
  console.log('📅 연간 재무데이터 업데이트 시작 (4월 1일)...');
  try {
    const FinancialDataCacheService = require('./services/financialDataCacheService');

    // 1. 데이터 년도 업데이트 체크
    const yearUpdated = FinancialDataCacheService.checkDataYearUpdate();
    if (yearUpdated) {
      console.log('📊 새로운 재무데이터 수집년도로 업데이트됨');
    }

    // 2. 통합 종목 재무데이터 일괄 수집
    const StockListService = require('./services/stockListService');
    const stockCodes = StockListService.getUnifiedStockList();
    const stats = StockListService.getStatistics();

    console.log(`📊 대상 종목: ${stats.total}개 (코스피 ${stats.kospi}개 + 코스닥 ${stats.kosdaq}개)`);
    const results = await FinancialDataCacheService.bulkCollectFinancialData(stockCodes, 6);

    // 3. 오래된 캐시 데이터 정리 (2년 이상)
    const cleanedCount = await FinancialDataCacheService.cleanupOldCache(2);

    console.log(`✅ 연간 재무데이터 업데이트 완료: ${results.success}개 수집, ${cleanedCount}개 정리`);

  } catch (error) {
    console.error('❌ 연간 재무데이터 업데이트 실패:', error);
  }
}, {
  timezone: "Asia/Seoul"
});

app.listen(PORT, () => {
  console.log(`🚀 저평가주식 분석 서버 실행 중: port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`💰 저평가 분석: http://localhost:${PORT}/api/undervalued/criteria`);
  console.log(`🔄 Server start: ${new Date().toISOString()}`);
});