/**
 * 저평가주식 분석 API
 * - PSR ≤ 0.5
 * - PER × PBR ≤ 22.5 (그레이엄 공식)
 * - 비유동자산 10년 이상 보유
 */

const express = require('express');
const router = express.Router();
const undervaluedAnalyzer = require('../services/undervaluedStocksAnalyzer');
const stockListService = require('../services/stockListService');
const kiwoomService = require('../services/kiwoomService');

/**
 * GET /api/undervalued/analyze/:stockCode
 * 단일 종목 저평가 분석
 * Query: price (현재가, 선택 - 없으면 키움 API로 자동 조회)
 */
router.get('/analyze/:stockCode', async (req, res) => {
  try {
    const { stockCode } = req.params;
    let { price } = req.query;

    // 가격이 없으면 키움 API로 자동 조회
    if (!price || isNaN(price)) {
      console.log(`📊 ${stockCode} 현재가 자동 조회 중 (키움 API)...`);

      const currentPrice = await kiwoomService.getCurrentPrice(stockCode);

      if (currentPrice && currentPrice > 0) {
        price = currentPrice;
        console.log(`✅ ${stockCode} 현재가: ${price}원 (키움 API)`);
      } else {
        return res.status(400).json({
          success: false,
          error: '현재가 조회 실패. 직접 입력해주세요. 예: ?price=50000',
          hint: '키움 API 인증 키 확인 필요'
        });
      }
    }

    console.log(`📊 저평가 분석 요청: ${stockCode}, 현재가: ${price}원`);

    const result = await undervaluedAnalyzer.analyzeStock(stockCode, parseInt(price));

    if (result.error) {
      return res.status(400).json({
        success: false,
        error: result.error,
        stockCode
      });
    }

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('저평가 분석 API 오류:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/undervalued/price/:stockCode
 * 키움 API로 현재가만 조회
 */
router.get('/price/:stockCode', async (req, res) => {
  try {
    const { stockCode } = req.params;

    console.log(`📊 ${stockCode} 현재가 조회 (키움 API)...`);

    const currentPrice = await kiwoomService.getCurrentPrice(stockCode);

    if (!currentPrice || currentPrice <= 0) {
      return res.status(400).json({
        success: false,
        error: '현재가 조회 실패',
        stockCode
      });
    }

    res.json({
      success: true,
      data: {
        stockCode,
        currentPrice,
        dataSource: 'KIWOOM_API',
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('현재가 조회 API 오류:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/undervalued/bulk-analyze
 * 여러 종목 일괄 분석
 * Body: { stocks: [{ stockCode, price }, ...] }
 */
router.post('/bulk-analyze', async (req, res) => {
  try {
    const { stocks } = req.body;

    if (!stocks || !Array.isArray(stocks) || stocks.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'stocks 배열이 필요합니다. 예: { stocks: [{ stockCode: "005930", price: 70000 }] }'
      });
    }

    // 유효성 검사
    const validStocks = stocks.filter(s => s.stockCode && s.price && !isNaN(s.price));

    if (validStocks.length === 0) {
      return res.status(400).json({
        success: false,
        error: '유효한 종목 데이터가 없습니다. stockCode와 price가 필요합니다.'
      });
    }

    console.log(`📊 저평가 일괄 분석 요청: ${validStocks.length}개 종목`);

    const result = await undervaluedAnalyzer.analyzeBulk(validStocks);

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('저평가 일괄 분석 API 오류:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/undervalued/screen
 * 저평가 주식 스크리닝 (주가 데이터 자동 수집)
 * Query:
 *   - limit: 분석할 종목 수 (기본 50)
 *   - market: KOSPI, KOSDAQ, ALL (기본 ALL)
 */
router.get('/screen', async (req, res) => {
  try {
    const { limit = 50, market = 'ALL' } = req.query;

    console.log(`📊 저평가 스크리닝 시작: ${market}, 최대 ${limit}개`);

    // 종목 리스트 가져오기
    let stockList = stockListService.getUnifiedStockList();

    if (market !== 'ALL') {
      stockList = stockList.filter(code => {
        const firstDigit = code.charAt(0);
        if (market === 'KOSPI') return ['0', '1'].includes(firstDigit);
        if (market === 'KOSDAQ') return ['2', '3'].includes(firstDigit);
        return true;
      });
    }

    // 제한 적용
    stockList = stockList.slice(0, parseInt(limit));

    res.json({
      success: true,
      message: `${stockList.length}개 종목 분석 준비됨`,
      note: '주가 데이터와 함께 /bulk-analyze로 요청해주세요',
      stockCodes: stockList,
      criteria: undervaluedAnalyzer.criteria
    });

  } catch (error) {
    console.error('스크리닝 API 오류:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/undervalued/criteria
 * 현재 저평가 기준 조회
 */
router.get('/criteria', (req, res) => {
  res.json({
    success: true,
    criteria: {
      PSR: {
        threshold: 0.5,
        description: 'PSR(주가매출비율) 0.5 이하 = 매출 대비 저평가'
      },
      grahamNumber: {
        threshold: 22.5,
        formula: 'PER × PBR',
        description: '벤저민 그레이엄의 가치투자 공식. 22.5 이하면 저평가'
      },
      nonCurrentAssets: {
        minAge: 10,
        description: '10년 이상 보유한 비유동자산 (토지, 건물 등) 보유 여부'
      }
    },
    explanation: {
      PSR: '시가총액 / 연간 매출액. 0.5 이하는 매출의 절반도 안 되는 시가총액',
      PER: '시가총액 / 당기순이익. 낮을수록 수익 대비 저평가',
      PBR: '시가총액 / 자본총계. 1 미만이면 청산가치보다 낮은 주가',
      grahamNumber: 'PER과 PBR을 곱한 값. 그레이엄은 15×1.5=22.5를 기준으로 제시'
    }
  });
});

/**
 * GET /api/undervalued/test-dart-shares/:stockCode
 * DART stockTotqySttus API 테스트 (상장주식수)
 */
router.get('/test-dart-shares/:stockCode', async (req, res) => {
  try {
    const { stockCode } = req.params;
    const { year = '2024' } = req.query;
    const axios = require('axios');
    const dartService = require('../services/dartService');

    console.log(`🧪 DART stockTotqySttus 테스트: ${stockCode}, year=${year}`);

    // 1. 기업코드 조회
    const corpInfo = await dartService.getCorpCode(stockCode);
    if (!corpInfo) {
      return res.status(400).json({
        success: false,
        error: '기업코드 조회 실패',
        stockCode
      });
    }

    console.log(`✅ 기업코드: ${corpInfo.corpCode}, ${corpInfo.corpName}`);

    // 2. DART stockTotqySttus API 직접 호출
    const apiKey = process.env.DART_API_KEY;
    const url = `https://opendart.fss.or.kr/api/stockTotqySttus.json`;

    const response = await axios.get(url, {
      params: {
        crtfc_key: apiKey,
        corp_code: corpInfo.corpCode,
        bsns_year: year,
        reprt_code: '11011'
      }
    });

    console.log(`📋 DART API 응답:`, JSON.stringify(response.data, null, 2));

    res.json({
      success: true,
      stockCode,
      corpCode: corpInfo.corpCode,
      corpName: corpInfo.corpName,
      year,
      dartResponse: response.data
    });

  } catch (error) {
    console.error('DART shares 테스트 오류:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/undervalued/test-financials/:stockCode
 * DART 재무제표 계정명 전체 조회 (디버깅용)
 */
router.get('/test-financials/:stockCode', async (req, res) => {
  try {
    const { stockCode } = req.params;
    const { year = '2024' } = req.query;
    const axios = require('axios');
    const dartService = require('../services/dartService');

    const corpInfo = await dartService.getCorpCode(stockCode);
    if (!corpInfo) {
      return res.status(400).json({ success: false, error: '기업코드 없음' });
    }

    const apiKey = process.env.DART_API_KEY;
    const response = await axios.get('https://opendart.fss.or.kr/api/fnlttSinglAcnt.json', {
      params: {
        crtfc_key: apiKey,
        corp_code: corpInfo.corpCode,
        bsns_year: year,
        reprt_code: '11011',
        fs_div: 'CFS'
      }
    });

    // 계정명만 추출
    const accounts = response.data.list?.map(item => ({
      name: item.account_nm,
      id: item.account_id,
      amount: item.thstrm_amount,
      sj_nm: item.sj_nm  // 재무제표 구분 (재무상태표, 손익계산서 등)
    })) || [];

    res.json({
      success: true,
      stockCode,
      corpCode: corpInfo.corpCode,
      corpName: corpInfo.corpName,
      year,
      status: response.data.status,
      accountCount: accounts.length,
      accounts
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/undervalued/test-kiwoom/:stockCode
 * 키움 ka10001 API 테스트 (상장주식수 포함)
 */
router.get('/test-kiwoom/:stockCode', async (req, res) => {
  try {
    const { stockCode } = req.params;

    console.log(`🧪 키움 ka10001 테스트: ${stockCode}`);

    const stockInfo = await kiwoomService.getStockInfo(stockCode);

    if (stockInfo) {
      res.json({
        success: true,
        data: stockInfo,
        note: 'ka10001 API 응답'
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'ka10001 API 응답 없음',
        stockCode
      });
    }

  } catch (error) {
    console.error('ka10001 테스트 오류:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
