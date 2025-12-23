/**
 * 저평가주식 분석기
 * - PSR 0.5 이하
 * - PER × PBR ≤ 22.5 (벤저민 그레이엄 공식)
 * - 비유동자산 분석 (10년 이상 보유 자산)
 */

const axios = require('axios');
const dartService = require('./dartService');

class UndervaluedStocksAnalyzer {
  constructor() {
    this.baseURL = 'https://opendart.fss.or.kr/api';
    this.apiKey = process.env.DART_API_KEY || '';

    // 저평가 기준
    this.criteria = {
      maxPSR: 0.5,           // PSR 0.5 이하
      maxGrahamNumber: 22.5, // PER × PBR ≤ 22.5
      minAssetAge: 10        // 비유동자산 최소 보유 연수
    };

    this.rateLimitDelay = 200;
  }

  /**
   * 저평가주식 분석 (단일 종목)
   */
  async analyzeStock(stockCode, currentPrice) {
    try {
      console.log(`\n📊 ${stockCode} 저평가 분석 시작...`);

      // 1. 기업코드 조회
      const corpInfo = await dartService.getCorpCode(stockCode);
      if (!corpInfo) {
        return { stockCode, error: '기업코드 없음' };
      }

      // 2. 상장주식수 조회
      const sharesOutstanding = await dartService.getSharesOutstanding(stockCode);
      if (!sharesOutstanding) {
        return { stockCode, error: '상장주식수 조회 실패' };
      }

      // 3. 재무제표 조회 (자본총계, 매출액, 당기순이익)
      const financialData = await this.getDetailedFinancials(corpInfo.corpCode);
      if (!financialData) {
        return { stockCode, error: '재무데이터 조회 실패' };
      }

      // 4. 시가총액 계산
      const marketCap = currentPrice * sharesOutstanding;
      const marketCapBillion = marketCap / 100000000; // 억원 단위

      // 5. 가치 지표 계산
      const valuationMetrics = this.calculateValuationMetrics(
        marketCapBillion,
        financialData
      );

      // 6. 비유동자산 분석 (10년 이상 자산)
      const assetAnalysis = await this.analyzeNonCurrentAssets(corpInfo.corpCode);

      // 7. 저평가 조건 체크
      const isUndervalued = this.checkUndervaluedCriteria(valuationMetrics);

      const result = {
        stockCode,
        name: corpInfo.corpName,
        currentPrice,
        marketCap: marketCapBillion,
        sharesOutstanding,

        // 재무 데이터
        revenue: financialData.revenue,
        netIncome: financialData.netIncome,
        totalEquity: financialData.totalEquity,
        nonCurrentAssets: financialData.nonCurrentAssets,

        // 가치 지표
        PSR: valuationMetrics.PSR,
        PER: valuationMetrics.PER,
        PBR: valuationMetrics.PBR,
        grahamNumber: valuationMetrics.grahamNumber, // PER × PBR

        // 비유동자산 분석
        assetAnalysis,

        // 저평가 판정
        isUndervalued,
        undervaluedReasons: this.getUndervaluedReasons(valuationMetrics, assetAnalysis),

        analyzedAt: new Date().toISOString()
      };

      console.log(`✅ ${stockCode} 분석 완료: PSR=${valuationMetrics.PSR?.toFixed(2)}, PER×PBR=${valuationMetrics.grahamNumber?.toFixed(2)}`);

      return result;

    } catch (error) {
      console.error(`❌ ${stockCode} 분석 실패:`, error.message);
      return { stockCode, error: error.message };
    }
  }

  /**
   * 상세 재무데이터 조회 (비유동자산 포함)
   */
  async getDetailedFinancials(corpCode, year = 2024) {
    try {
      await this.delay(this.rateLimitDelay);

      const response = await axios.get(`${this.baseURL}/fnlttSinglAcnt.json`, {
        params: {
          crtfc_key: this.apiKey,
          corp_code: corpCode,
          bsns_year: year.toString(),
          reprt_code: '11011', // 사업보고서
          fs_div: 'CFS' // 연결재무제표
        },
        timeout: 10000
      });

      if (response.data.status === '013' && year === 2024) {
        // 2024년 없으면 2023년 시도
        return await this.getDetailedFinancials(corpCode, 2023);
      }

      if (response.data.status !== '000' || !response.data.list) {
        return null;
      }

      const dataList = response.data.list;
      const result = {
        revenue: 0,
        netIncome: 0,
        totalEquity: 0,
        totalAssets: 0,
        nonCurrentAssets: 0,
        tangibleAssets: 0,     // 유형자산
        intangibleAssets: 0,   // 무형자산
        investmentAssets: 0,   // 투자자산
        land: 0,               // 토지
        buildings: 0,          // 건물
        interestIncome: 0      // 이자수익 (금융회사용)
      };

      const seenAccounts = new Set();

      dataList.forEach(item => {
        const accountName = item.account_nm || '';
        const accountId = item.account_id || '';
        const amount = parseInt(item.thstrm_amount?.replace(/,/g, '') || '0');
        const amountBillion = amount / 100000000; // 억원

        // 매출액 (영업수익 포함 - 금융/보험사는 이자수익 사용)
        if (!seenAccounts.has('revenue') &&
            (accountName === '매출액' || accountName === '영업수익' || accountName === '수익(매출액)')) {
          result.revenue = amountBillion;
          seenAccounts.add('revenue');
        }
        // 금융회사 대체: 이자수익 (매출액이 없는 경우만)
        else if (accountName === '이자수익' && !seenAccounts.has('revenue') && !seenAccounts.has('interestIncome')) {
          result.interestIncome = amountBillion;
          seenAccounts.add('interestIncome');
        }
        // 당기순이익 (다양한 표현 처리)
        else if (!seenAccounts.has('netIncome') && amountBillion !== 0 &&
                 (accountName === '당기순이익' ||
                  accountName === '당기순이익(손실)' ||
                  accountName === '분기순이익' ||
                  accountName === '반기순이익' ||
                  accountName.includes('지배기업') && accountName.includes('순이익') ||
                  (accountName.includes('당기순') && !accountName.includes('기타')))) {
          result.netIncome = amountBillion;
          seenAccounts.add('netIncome');
        }
        // 자본총계
        else if ((accountName === '자본총계' || accountName === '자본 총계') && !seenAccounts.has('totalEquity')) {
          result.totalEquity = amountBillion;
          seenAccounts.add('totalEquity');
        }
        // 자산총계
        else if ((accountName === '자산총계' || accountName === '자산 총계') && !seenAccounts.has('totalAssets')) {
          result.totalAssets = amountBillion;
          seenAccounts.add('totalAssets');
        }
        // 비유동자산
        else if ((accountName === '비유동자산' || accountName === '비유동 자산') && !seenAccounts.has('nonCurrentAssets')) {
          result.nonCurrentAssets = amountBillion;
          seenAccounts.add('nonCurrentAssets');
        }
        // 유형자산
        else if ((accountName === '유형자산' || accountName === '유형 자산') && !seenAccounts.has('tangibleAssets')) {
          result.tangibleAssets = amountBillion;
          seenAccounts.add('tangibleAssets');
        }
        // 무형자산
        else if ((accountName === '무형자산' || accountName === '무형 자산') && !seenAccounts.has('intangibleAssets')) {
          result.intangibleAssets = amountBillion;
          seenAccounts.add('intangibleAssets');
        }
        // 토지
        else if (accountName === '토지' && !seenAccounts.has('land')) {
          result.land = amountBillion;
          seenAccounts.add('land');
        }
        // 건물
        else if ((accountName === '건물' || accountName === '건물및구축물') && !seenAccounts.has('buildings')) {
          result.buildings = amountBillion;
          seenAccounts.add('buildings');
        }
      });

      // 금융회사: 매출액이 없으면 이자수익으로 대체
      if (result.revenue === 0 && result.interestIncome > 0) {
        result.revenue = result.interestIncome;
        result.revenueSource = 'interestIncome';
        console.log(`💰 금융회사: 이자수익 ${result.interestIncome.toLocaleString()}억을 매출액으로 사용`);
      }

      console.log(`📋 재무데이터: 매출 ${result.revenue.toLocaleString()}억, 순이익 ${result.netIncome.toLocaleString()}억, 자본 ${result.totalEquity.toLocaleString()}억`);
      console.log(`📋 비유동자산: ${result.nonCurrentAssets.toLocaleString()}억 (유형 ${result.tangibleAssets.toLocaleString()}억, 토지 ${result.land.toLocaleString()}억)`);

      return result;

    } catch (error) {
      console.error('재무데이터 조회 실패:', error.message);
      return null;
    }
  }

  /**
   * 가치 지표 계산 (PSR, PER, PBR, 그레이엄 넘버)
   */
  calculateValuationMetrics(marketCapBillion, financialData) {
    const metrics = {
      PSR: null,
      PER: null,
      PBR: null,
      grahamNumber: null
    };

    // PSR = 시가총액 / 매출액
    if (financialData.revenue > 0) {
      metrics.PSR = marketCapBillion / financialData.revenue;
    }

    // PER = 시가총액 / 당기순이익
    if (financialData.netIncome > 0) {
      metrics.PER = marketCapBillion / financialData.netIncome;
    }

    // PBR = 시가총액 / 자본총계
    if (financialData.totalEquity > 0) {
      metrics.PBR = marketCapBillion / financialData.totalEquity;
    }

    // 그레이엄 넘버 = PER × PBR (22.5 이하면 저평가)
    if (metrics.PER !== null && metrics.PBR !== null &&
        metrics.PER > 0 && metrics.PBR > 0) {
      metrics.grahamNumber = metrics.PER * metrics.PBR;
    }

    return metrics;
  }

  /**
   * 비유동자산 분석 (10년 이상 보유 자산 추정)
   * - 전체 계정과목 API로 세부 자산 정보 조회
   * - 감가상각누계액 / 취득원가 비율로 자산 연한 추정
   * - 토지는 감가상각하지 않으므로 장기보유 자산으로 판정
   */
  async analyzeNonCurrentAssets(corpCode, year = 2024) {
    try {
      await this.delay(this.rateLimitDelay);

      // 전체 계정과목 API 사용 (세부 항목 포함)
      const response = await axios.get(`${this.baseURL}/fnlttSinglAcntAll.json`, {
        params: {
          crtfc_key: this.apiKey,
          corp_code: corpCode,
          bsns_year: year.toString(),
          reprt_code: '11011',
          fs_div: 'CFS'
        },
        timeout: 15000
      });

      // 2024년 데이터 없으면 2023년 시도
      if (response.data.status === '013' && year === 2024) {
        return await this.analyzeNonCurrentAssets(corpCode, 2023);
      }

      if (response.data.status !== '000') {
        return { hasOldAssets: null, reason: `DART API 오류: ${response.data.message}` };
      }

      const dataList = response.data.list || [];

      // 자산 관련 데이터 추출
      const analysis = {
        hasOldAssets: false,
        landValue: 0,
        buildingGross: 0,        // 건물 취득원가
        buildingNet: 0,          // 건물 장부가액
        buildingDepreciation: 0, // 건물 감가상각누계액
        machineryGross: 0,       // 기계장치 취득원가
        machineryNet: 0,         // 기계장치 장부가액
        machineryDepreciation: 0,
        totalDepreciation: 0,    // 총 감가상각누계액
        tangibleAssets: 0,       // 유형자산 총액
        depreciationRatio: 0,
        estimatedBuildingAge: null,
        estimatedMachineryAge: null,
        assetDetails: [],
        reason: ''
      };

      // 재무상태표(BS) 항목만 필터링
      const bsItems = dataList.filter(item => item.sj_div === 'BS');

      bsItems.forEach(item => {
        const accountName = item.account_nm || '';
        const amount = parseInt(item.thstrm_amount?.replace(/,/g, '') || '0') / 100000000;

        // 토지
        if (accountName === '토지' || accountName.includes('토지')) {
          if (amount > 0 && analysis.landValue === 0) {
            analysis.landValue = amount;
            analysis.assetDetails.push({ type: '토지', value: amount, note: '감가상각 없음 (장기보유)' });
          }
        }
        // 건물 (장부가액)
        else if ((accountName === '건물' || accountName === '건물및구축물' || accountName.includes('건물'))
                 && !accountName.includes('감가상각') && !accountName.includes('누계')) {
          if (amount > 0 && analysis.buildingNet === 0) {
            analysis.buildingNet = amount;
          }
        }
        // 건물 감가상각누계액
        else if (accountName.includes('건물') && accountName.includes('감가상각누계액')) {
          analysis.buildingDepreciation = Math.abs(amount);
        }
        // 기계장치 (장부가액)
        else if ((accountName === '기계장치' || accountName.includes('기계'))
                 && !accountName.includes('감가상각') && !accountName.includes('누계')) {
          if (amount > 0 && analysis.machineryNet === 0) {
            analysis.machineryNet = amount;
          }
        }
        // 기계장치 감가상각누계액
        else if (accountName.includes('기계') && accountName.includes('감가상각누계액')) {
          analysis.machineryDepreciation = Math.abs(amount);
        }
        // 유형자산 총계
        else if (accountName === '유형자산') {
          analysis.tangibleAssets = amount;
        }
        // 총 감가상각누계액
        else if (accountName.includes('감가상각누계액') && !accountName.includes('건물') && !accountName.includes('기계')) {
          analysis.totalDepreciation += Math.abs(amount);
        }
      });

      // 건물 취득원가 및 연한 계산 (내용연수 40년 가정)
      if (analysis.buildingNet > 0 || analysis.buildingDepreciation > 0) {
        analysis.buildingGross = analysis.buildingNet + analysis.buildingDepreciation;
        if (analysis.buildingGross > 0) {
          const buildingDepRatio = (analysis.buildingDepreciation / analysis.buildingGross) * 100;
          analysis.estimatedBuildingAge = Math.round(buildingDepRatio * 0.4); // 40년 * 비율
          if (analysis.estimatedBuildingAge >= 10) {
            analysis.assetDetails.push({
              type: '건물',
              grossValue: analysis.buildingGross,
              netValue: analysis.buildingNet,
              depreciation: analysis.buildingDepreciation,
              depreciationRatio: buildingDepRatio.toFixed(1) + '%',
              estimatedAge: analysis.estimatedBuildingAge + '년',
              note: '내용연수 40년 기준'
            });
          }
        }
      }

      // 기계장치 취득원가 및 연한 계산 (내용연수 10년 가정)
      if (analysis.machineryNet > 0 || analysis.machineryDepreciation > 0) {
        analysis.machineryGross = analysis.machineryNet + analysis.machineryDepreciation;
        if (analysis.machineryGross > 0) {
          const machineryDepRatio = (analysis.machineryDepreciation / analysis.machineryGross) * 100;
          analysis.estimatedMachineryAge = Math.round(machineryDepRatio * 0.1); // 10년 * 비율
          if (analysis.estimatedMachineryAge >= 5) {
            analysis.assetDetails.push({
              type: '기계장치',
              grossValue: analysis.machineryGross,
              netValue: analysis.machineryNet,
              depreciation: analysis.machineryDepreciation,
              depreciationRatio: machineryDepRatio.toFixed(1) + '%',
              estimatedAge: analysis.estimatedMachineryAge + '년',
              note: '내용연수 10년 기준'
            });
          }
        }
      }

      // 전체 감가상각 비율 계산
      if (analysis.tangibleAssets > 0 && analysis.totalDepreciation > 0) {
        const grossTotal = analysis.tangibleAssets + analysis.totalDepreciation;
        analysis.depreciationRatio = (analysis.totalDepreciation / grossTotal) * 100;
      }

      // 10년 이상 보유 자산 판정
      const reasons = [];

      // 토지가 있으면 장기보유 자산
      if (analysis.landValue > 0) {
        analysis.hasOldAssets = true;
        reasons.push(`토지 ${analysis.landValue.toLocaleString()}억원 (장기보유 자산)`);
      }

      // 건물 10년 이상
      if (analysis.estimatedBuildingAge && analysis.estimatedBuildingAge >= 10) {
        analysis.hasOldAssets = true;
        reasons.push(`건물 추정 ${analysis.estimatedBuildingAge}년 보유 (취득원가 ${analysis.buildingGross.toLocaleString()}억)`);
      }

      // 기계장치 5년 이상 (기계는 내용연수가 짧으므로 5년 이상이면 오래된 것)
      if (analysis.estimatedMachineryAge && analysis.estimatedMachineryAge >= 5) {
        analysis.hasOldAssets = true;
        reasons.push(`기계장치 추정 ${analysis.estimatedMachineryAge}년 보유`);
      }

      analysis.reason = reasons.join(', ') || '10년 이상 보유 자산 미확인';

      console.log(`🏭 비유동자산 분석: ${analysis.reason}`);
      if (analysis.assetDetails.length > 0) {
        console.log(`📋 자산 상세:`, JSON.stringify(analysis.assetDetails, null, 2));
      }

      return analysis;

    } catch (error) {
      console.error('비유동자산 분석 실패:', error.message);
      return { hasOldAssets: null, reason: error.message, assetDetails: [] };
    }
  }

  /**
   * 저평가 조건 체크
   */
  checkUndervaluedCriteria(metrics) {
    const criteria = {
      PSR: metrics.PSR !== null && metrics.PSR <= this.criteria.maxPSR,
      grahamNumber: metrics.grahamNumber !== null && metrics.grahamNumber <= this.criteria.maxGrahamNumber
    };

    // PSR 또는 그레이엄 넘버 중 하나라도 만족하면 저평가
    return criteria.PSR || criteria.grahamNumber;
  }

  /**
   * 저평가 사유 생성
   */
  getUndervaluedReasons(metrics, assetAnalysis) {
    const reasons = [];

    if (metrics.PSR !== null && metrics.PSR <= this.criteria.maxPSR) {
      reasons.push(`PSR ${metrics.PSR.toFixed(2)} ≤ ${this.criteria.maxPSR} (매출 대비 저평가)`);
    }

    if (metrics.grahamNumber !== null && metrics.grahamNumber <= this.criteria.maxGrahamNumber) {
      reasons.push(`PER×PBR = ${metrics.grahamNumber.toFixed(2)} ≤ ${this.criteria.maxGrahamNumber} (그레이엄 기준)`);
    }

    if (assetAnalysis?.hasOldAssets) {
      reasons.push(`장기 보유 자산: ${assetAnalysis.reason}`);
    }

    return reasons;
  }

  /**
   * 여러 종목 일괄 분석 (주가 데이터 필요)
   */
  async analyzeBulk(stocksWithPrice, options = {}) {
    const { batchSize = 10, onProgress } = options;

    // 중복 종목 제거 (stockCode 기준)
    const seenCodes = new Set();
    const uniqueStocks = stocksWithPrice.filter(s => {
      if (seenCodes.has(s.stockCode)) return false;
      seenCodes.add(s.stockCode);
      return true;
    });

    console.log(`\n🚀 저평가주식 일괄 분석 시작: ${uniqueStocks.length}개 종목 (중복 ${stocksWithPrice.length - uniqueStocks.length}개 제거)`);

    const results = [];
    const undervalued = [];
    const failed = [];
    const analyzedCodes = new Set(); // 분석 완료된 종목 추적

    for (let i = 0; i < uniqueStocks.length; i += batchSize) {
      const batch = uniqueStocks.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(uniqueStocks.length / batchSize);

      console.log(`\n📦 배치 ${batchNum}/${totalBatches} (${batch.length}개 종목)`);

      for (const { stockCode, price } of batch) {
        const result = await this.analyzeStock(stockCode, price);

        if (result.error) {
          failed.push(result);
        } else {
          results.push(result);
          if (result.isUndervalued) {
            undervalued.push(result);
          }
        }

        if (onProgress) {
          onProgress({
            current: results.length + failed.length,
            total: uniqueStocks.length,
            undervalued: undervalued.length
          });
        }
      }

      // 배치 간 대기
      if (i + batchSize < uniqueStocks.length) {
        await this.delay(1000);
      }
    }

    // 저평가 종목 정렬 (그레이엄 넘버 낮은 순)
    undervalued.sort((a, b) => (a.grahamNumber || 999) - (b.grahamNumber || 999));

    const summary = {
      total: uniqueStocks.length,
      analyzed: results.length,
      failed: failed.length,
      undervalued: undervalued.length,
      criteria: this.criteria
    };

    console.log(`\n✅ 분석 완료!`);
    console.log(`   - 분석 성공: ${summary.analyzed}개`);
    console.log(`   - 저평가 발견: ${summary.undervalued}개`);
    console.log(`   - 분석 실패: ${summary.failed}개`);

    return {
      summary,
      undervalued,
      all: results,
      failed
    };
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new UndervaluedStocksAnalyzer();
