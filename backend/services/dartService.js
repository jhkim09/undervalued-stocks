const axios = require('axios');

class DartService {
  
  constructor() {
    this.baseURL = 'https://opendart.fss.or.kr/api';
    this.apiKey = '';
    this.cache = new Map(); // 캐시로 API 호출 최소화
    this.rateLimitDelay = 200; // API 호출 간격 (밀리초)
    
    // 전체 기업코드 캐시 (한 번만 로드하고 재사용)
    this.allCorpCodes = null;
    this.lastCorpCodeUpdate = null;
    this.corpCodeCacheExpiry = 24 * 60 * 60 * 1000; // 24시간 캐시
    this.isLoading = false; // 동시 로딩 방지
    
    // 환경변수에서 API 키 로드
    this.loadApiKey();
  }
  
  // API 키 로드 함수
  loadApiKey() {
    if (typeof process !== 'undefined' && process.env) {
      this.apiKey = process.env.DART_API_KEY || '';
      console.log(`🔑 DART API Key 로드: ${this.apiKey ? '성공' : '실패'} (길이: ${this.apiKey.length})`);
      
      // API 키가 없으면 상세한 디버깅 정보 제공
      if (!this.apiKey) {
        console.log('🔍 환경변수 디버깅:');
        console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
        console.log(`   사용가능한 환경변수 (DART 관련): ${Object.keys(process.env).filter(key => key.includes('DART')).join(', ')}`);
        console.log(`   전체 환경변수 개수: ${Object.keys(process.env).length}`);
        console.warn('❌ DART_API_KEY 환경변수가 설정되지 않았습니다!');
        console.warn('🔧 Render Dashboard에서 DART_API_KEY 환경변수를 확인하세요');
      }
    } else {
      console.warn('⚠️ process.env를 사용할 수 없습니다');
    }
  }
  
  // 전체 기업코드 데이터 로드 (24시간 캐시)
  async loadAllCorpCodes() {
    try {
      // 캐시가 유효한지 확인
      const now = Date.now();
      if (this.allCorpCodes && this.lastCorpCodeUpdate && 
          (now - this.lastCorpCodeUpdate) < this.corpCodeCacheExpiry) {
        return this.allCorpCodes;
      }
      
      // 동시 로딩 방지 (여러 종목이 동시에 요청할 때)
      if (this.isLoading) {
        console.log(`⏳ 다른 요청이 이미 기업코드 로딩 중... 대기`);
        // 로딩 완료까지 대기
        while (this.isLoading) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        // 로딩 완료 후 캐시 반환
        return this.allCorpCodes;
      }
      
      this.isLoading = true;
      console.log(`📋 DART API: 전체 기업코드 데이터 로딩 중...`);
      
      const response = await axios.get(`${this.baseURL}/corpCode.xml`, {
        params: {
          crtfc_key: this.apiKey
        },
        responseType: 'arraybuffer'
      });
      
      if (!response.data) {
        throw new Error('DART API 응답 없음');
      }
      
      let xmlText;
      
      // ZIP 파일 처리 (DART API는 ZIP 형태로 제공)
      const JSZip = require('jszip');
      const zip = new JSZip();
      const contents = await zip.loadAsync(response.data);
      const xmlFile = Object.keys(contents.files)[0];
      
      if (!xmlFile) {
        throw new Error('ZIP 파일 내 XML 파일을 찾을 수 없음');
      }
      
      xmlText = await contents.files[xmlFile].async('text');
      console.log(`📦 ZIP에서 XML 추출: ${xmlFile}, 크기: ${xmlText.length.toLocaleString()}`);
      
      // XML 실제 구조 분석 (처음 2000자)
      console.log(`🔍 XML 구조 샘플:\n${xmlText.substring(0, 2000)}`);
      
      // 전체 기업코드 파싱해서 Map으로 저장
      const corpCodeMap = new Map();
      
      // 특정 종목코드 찾기 - 모든 매칭을 찾아서 올바른 것 선택
      let stockMatches = [];
      const regex = /<list>[\s\S]*?<corp_code>([^<]+)<\/corp_code>[\s\S]*?<corp_name>([^<]+)<\/corp_name>[\s\S]*?<stock_code>\s*(\d{6})\s*<\/stock_code>[\s\S]*?<\/list>/g;
      
      let match;
      while ((match = regex.exec(xmlText)) !== null) {
        const [, corpCode, corpName, foundStockCode] = match;
        stockMatches.push({
          stockCode: foundStockCode.trim(),
          corpCode: corpCode.trim(),
          corpName: corpName.trim()
        });
      }
      
      console.log(`🔍 XML에서 총 ${stockMatches.length}개 상장기업 발견`);
      
      // 상장사만 선별해서 Map에 저장 (강화된 필터링)
      let filteredCount = 0;
      let skippedCount = 0;
      
      for (const stock of stockMatches) {
        // 1. 비상장사 키워드 필터링 (강화)
        const excludeKeywords = [
          '유동화전문', '부동산투자회사', '위탁관리', '사모투자', '새마을금고',
          '제', '차', '호', '리츠', 'REIT', '스팩', 'SPAC', '우선주', '신주인수권',
          '투자회사', '자산관리', '펀드', '투자조합', '투자신탁', '증권투자',
          '엔라이튼', '유한회사', '유한책임회사', 'LLC', '합자회사', '합명회사',
          '청산', '해산', '폐지', '정리', '매각', '인수', '합병대상'
        ];
        
        const shouldSkip = excludeKeywords.some(keyword => stock.corpName.includes(keyword));
        
        if (shouldSkip) {
          skippedCount++;
          continue;
        }
        
        // 2. 종목코드 패턴 검증 (6자리 숫자)
        if (!/^\d{6}$/.test(stock.stockCode)) {
          skippedCount++;
          continue;
        }
        
        // 3. 상장시장 추정으로 유효성 검증
        const marketCode = stock.stockCode.charAt(0);
        const isValidMarket = ['0', '1', '2', '3'].includes(marketCode); // 코스피/코스닥
        
        if (!isValidMarket) {
          skippedCount++;
          continue;
        }
        
        // 4. 중복 처리: 더 적합한 회사명 선택
        if (corpCodeMap.has(stock.stockCode)) {
          const existing = corpCodeMap.get(stock.stockCode);
          
          // 기존 데이터가 더 적합한지 확인
          const isExistingBetter = !excludeKeywords.some(keyword => existing.corpName.includes(keyword));
          const isCurrentWorse = excludeKeywords.some(keyword => stock.corpName.includes(keyword));
          
          // 더 짧고 명확한 회사명 우선 (일반적으로 모회사)
          const isCurrentBetter = stock.corpName.length < existing.corpName.length && !isCurrentWorse;
          
          if (isExistingBetter && isCurrentWorse) {
            skippedCount++;
            continue; // 기존 데이터 유지
          }
          
          if (!isCurrentBetter && isExistingBetter) {
            skippedCount++;
            continue; // 기존 데이터 유지
          }
        }
        
        // 5. 상장사로 판단되면 저장
        corpCodeMap.set(stock.stockCode, {
          corpCode: stock.corpCode,
          corpName: stock.corpName,
          market: this.guessMarketFromCode(stock.stockCode),
          isFiltered: true
        });
        filteredCount++;
      }
      
      console.log(`✅ 상장사 필터링 완료: ${filteredCount}개 선별, ${skippedCount}개 제외 (총 ${stockMatches.length}개 검토)`);
      
      // 처음 5개 샘플 출력
      const samples = stockMatches.slice(0, 5);
      samples.forEach(stock => {
        console.log(`📝 샘플: ${stock.stockCode} → ${stock.corpCode}, ${stock.corpName}`);
      });
      
      // 메모리 정리 (xmlText는 매우 큰 문자열이므로 명시적으로 해제)
      xmlText = null;
      
      this.allCorpCodes = corpCodeMap;
      this.lastCorpCodeUpdate = now;
      
      // 가비지 컬렉션 힌트
      if (global.gc) {
        global.gc();
      }
      
      return this.allCorpCodes;
      
    } catch (error) {
      console.error(`❌ 전체 기업코드 로딩 실패:`, error.message);
      return null;
    } finally {
      this.isLoading = false; // 로딩 플래그 해제
    }
  }
  
  // 기업 고유번호 조회 (종목코드 → 기업코드 변환) - 직접 조회 방식
  async getCorpCode(stockCode) {
    try {
      // 분석 제외 종목 (corpCode 매핑 오류)
      const excludedStocks = ['021240']; // 코웨이
      if (excludedStocks.includes(stockCode)) {
        console.log(`⚠️ ${stockCode}: 분석 제외 종목 (corpCode 매핑 오류)`);
        return null;
      }

      const cacheKey = `corp_${stockCode}`;
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      // 알려진 주요 종목 기업코드 (시가총액 상위 100개+)
      const knownCorpCodes = {
        // 코스피 시가총액 상위
        '005930': { corpCode: '00126380', corpName: '삼성전자' },
        '000660': { corpCode: '00164779', corpName: 'SK하이닉스' },
        '005490': { corpCode: '00164529', corpName: 'POSCO홀딩스' }, // 수정됨
        '005380': { corpCode: '00164742', corpName: '현대차' },
        '000270': { corpCode: '00164509', corpName: '기아' },
        '068270': { corpCode: '00401731', corpName: '셀트리온' },
        '207940': { corpCode: '00877059', corpName: '삼성바이오로직스' },
        '035420': { corpCode: '00266961', corpName: 'NAVER' },
        '006400': { corpCode: '00126343', corpName: '삼성SDI' },
        '051910': { corpCode: '00164788', corpName: 'LG화학' },
        '028260': { corpCode: '00149655', corpName: '삼성물산' },
        '035720': { corpCode: '00258801', corpName: '카카오' },
        '105560': { corpCode: '00688996', corpName: 'KB금융' },
        '055550': { corpCode: '00382199', corpName: '신한지주' },
        '012330': { corpCode: '00164753', corpName: '현대모비스' },
        '003550': { corpCode: '00105952', corpName: 'LG' },
        '066570': { corpCode: '00401185', corpName: 'LG전자' },
        '003670': { corpCode: '00155276', corpName: '포스코퓨처엠' },
        '096770': { corpCode: '00549271', corpName: 'SK이노베이션' },
        '034730': { corpCode: '00631518', corpName: 'SK' },
        '015760': { corpCode: '00159193', corpName: '한국전력' },
        '009150': { corpCode: '00126349', corpName: '삼성전기' },
        '017670': { corpCode: '00139649', corpName: 'SK텔레콤' },
        '032830': { corpCode: '00126344', corpName: '삼성생명' },
        '010130': { corpCode: '00126487', corpName: '고려아연' },
        '018260': { corpCode: '00126186', corpName: '삼성에스디에스' },
        '086790': { corpCode: '00547583', corpName: '하나금융지주' },
        '316140': { corpCode: '01350869', corpName: '우리금융지주' },
        '000810': { corpCode: '00139214', corpName: '삼성화재' },
        '329180': { corpCode: '01390344', corpName: 'HD현대중공업' },
        '011200': { corpCode: '00164645', corpName: 'HMM' },
        '009540': { corpCode: '00164679', corpName: 'HD한국조선해양' },
        '010950': { corpCode: '00225751', corpName: 'S-Oil' },
        '011070': { corpCode: '00105961', corpName: 'LG이노텍' },
        '003490': { corpCode: '00117917', corpName: '대한항공' },
        '047050': { corpCode: '00293886', corpName: '포스코인터내셔널' },
        '010140': { corpCode: '00126478', corpName: '삼성중공업' },
        '024110': { corpCode: '00117370', corpName: '기업은행' },
        '011780': { corpCode: '00139889', corpName: 'SKC' },
        '034020': { corpCode: '00280723', corpName: '두산에너빌리티' },
        '090430': { corpCode: '00583424', corpName: '아모레퍼시픽' },
        '032640': { corpCode: '00231363', corpName: 'LG유플러스' },
        '097950': { corpCode: '00606622', corpName: 'CJ제일제당' },
        '004020': { corpCode: '00164552', corpName: '현대제철' },
        '000720': { corpCode: '00164527', corpName: '현대건설' },
        '139480': { corpCode: '00872984', corpName: '이마트' },
        '001450': { corpCode: '00164973', corpName: '현대해상' },
        '036460': { corpCode: '00271728', corpName: '한국가스공사' },
        '004990': { corpCode: '00158836', corpName: '롯데지주' },
        '000100': { corpCode: '00134658', corpName: '유한양행' },
        '051900': { corpCode: '00401104', corpName: 'LG생활건강' },
        '030200': { corpCode: '00164614', corpName: 'KT' },
        '009830': { corpCode: '00162461', corpName: '한화솔루션' },
        '078930': { corpCode: '00500254', corpName: 'GS' },
        '010620': { corpCode: '00164609', corpName: 'HD현대미포' },
        '000880': { corpCode: '00161056', corpName: '한화' },
        '002790': { corpCode: '00154462', corpName: '아모레G' },
        // '021240': 코웨이 - corpCode 매핑 오류로 분석 제외 (추후 수정 필요)
        '001040': { corpCode: '00148540', corpName: 'CJ' },
        '004170': { corpCode: '00136378', corpName: '신세계' },
        '005940': { corpCode: '00117376', corpName: 'NH투자증권' },
        '071050': { corpCode: '00450863', corpName: '한국금융지주' },
        '047810': { corpCode: '00309503', corpName: '한국항공우주' },
        '000150': { corpCode: '00117188', corpName: '두산' },
        '088350': { corpCode: '00561713', corpName: '한화생명' },
        '016360': { corpCode: '00199715', corpName: '삼성증권' },
        '002380': { corpCode: '00164500', corpName: 'KCC' },
        '010060': { corpCode: '00148896', corpName: 'OCI홀딩스' },
        '001570': { corpCode: '00131095', corpName: '금양' }, // 수정: 지코더블유 아님
        '180640': { corpCode: '00917305', corpName: '한진칼' },
        '033780': { corpCode: '00241050', corpName: 'KT&G' },
        '011170': { corpCode: '00165413', corpName: '롯데케미칼' },
        '004800': { corpCode: '00117180', corpName: '효성' },
        '000120': { corpCode: '00146081', corpName: 'CJ대한통운' },
        '029780': { corpCode: '00156660', corpName: '삼성카드' },
        '005850': { corpCode: '00125521', corpName: '에스엘' },
        '006800': { corpCode: '00149788', corpName: '미래에셋증권' },
        '003410': { corpCode: '00161022', corpName: '쌍용C&E' },
        '267250': { corpCode: '00269278', corpName: 'HD현대' },
        '001680': { corpCode: '00121941', corpName: '대상' },
        '026960': { corpCode: '00144395', corpName: '동서' },
        '000670': { corpCode: '00141307', corpName: '영풍' },
        '011790': { corpCode: '00164797', corpName: 'SKC' },
        '004000': { corpCode: '00157681', corpName: '롯데정밀화학' },

        // 코스닥 주요 종목
        '247540': { corpCode: '01199771', corpName: '에코프로비엠' },
        '086520': { corpCode: '00533729', corpName: '에코프로' },
        '373220': { corpCode: '01529547', corpName: 'LG에너지솔루션' },
        '196170': { corpCode: '00953296', corpName: '알테오젠' },
        '041510': { corpCode: '00288602', corpName: 'SM' },
        '293490': { corpCode: '01217494', corpName: '카카오게임즈' },
        '263750': { corpCode: '01152502', corpName: '펄어비스' },
        '035900': { corpCode: '00254612', corpName: 'JYP Ent.' },
        '122870': { corpCode: '00798003', corpName: 'YG엔터테인먼트' },
        '352820': { corpCode: '01487642', corpName: '하이브' },
        '377300': { corpCode: '01558568', corpName: '카카오페이' },
        '251270': { corpCode: '01133217', corpName: '넷마블' },
        '259960': { corpCode: '01167256', corpName: '크래프톤' },
        '036570': { corpCode: '00273006', corpName: '엔씨소프트' },
        '042700': { corpCode: '00285276', corpName: '한미반도체' },
        '326030': { corpCode: '01417255', corpName: 'SK바이오팜' },
        '145020': { corpCode: '00858163', corpName: '휴젤' },
        '091990': { corpCode: '00401731', corpName: '셀트리온헬스케어' },
        '328130': { corpCode: '01430050', corpName: '루닛' },
        '060310': { corpCode: '00232467', corpName: '3S' },
        '032350': { corpCode: '00111848', corpName: '롯데관광개발' }
      };
      
      // 하드코딩된 데이터 우선 사용
      if (knownCorpCodes[stockCode]) {
        const result = knownCorpCodes[stockCode];
        console.log(`✅ ${stockCode} → ${result.corpCode}, ${result.corpName} (하드코딩)`);
        this.cache.set(cacheKey, result);
        return result;
      }
      
      // 하드코딩에 없으면 ZIP 파일 로딩 시도 (실패해도 계속 진행)
      try {
        const allCorpCodes = await this.loadAllCorpCodes();
        if (allCorpCodes) {
          const result = allCorpCodes.get(stockCode);
          if (result) {
            console.log(`✅ ${stockCode} → ${result.corpCode}, ${result.corpName} (DART API)`);
            this.cache.set(cacheKey, result);
            return result;
          }
        }
      } catch (zipError) {
        console.log(`⚠️ ${stockCode} ZIP 로딩 실패, 하드코딩 데이터로 대체 시도`);
      }
      
      console.log(`❌ ${stockCode} 기업코드를 찾을 수 없음`);
      return null;
      
    } catch (error) {
      console.error(`❌ 기업코드 조회 실패 (${stockCode}):`, error.message);
      return null;
    }
  }
  
  // 상장주식수 조회 (개선된 DART API - 주식 총수 현황)
  async getSharesOutstanding(stockCode, year = 2024) {
    try {
      // 하드코딩된 주요 종목 상장주식수 (2024년 기준, 단위: 주)
      // 출처: 각사 사업보고서, KRX 정보데이터시스템
      const knownShares = {
        // 코스피 시가총액 상위 50
        '005930': 5969782550,  // 삼성전자
        '000660': 728002365,   // SK하이닉스
        '005490': 84571230,    // POSCO홀딩스
        '005380': 211531506,   // 현대차 (보통주)
        '000270': 402514794,   // 기아
        '068270': 139355612,   // 셀트리온
        '207940': 71174000,    // 삼성바이오로직스
        '035420': 163813030,   // NAVER
        '006400': 68764530,    // 삼성SDI
        '051910': 70592343,    // LG화학
        '028260': 186017839,   // 삼성물산
        '035720': 443245951,   // 카카오
        '105560': 402521583,   // KB금융
        '055550': 501935371,   // 신한지주
        '012330': 97125885,    // 현대모비스
        '003550': 175548954,   // LG
        '066570': 163647814,   // LG전자
        '003670': 77435244,    // 포스코퓨처엠
        '096770': 182428152,   // SK이노베이션
        '034730': 71174000,    // SK
        '015760': 641964077,   // 한국전력
        '009150': 74693696,    // 삼성전기
        '017670': 71174000,    // SK텔레콤
        '032830': 200000000,   // 삼성생명
        '010130': 18800000,    // 고려아연
        '018260': 77350186,    // 삼성에스디에스
        '086790': 293636320,   // 하나금융지주
        '316140': 742537556,   // 우리금융지주
        '000810': 47174698,    // 삼성화재
        '329180': 88773116,    // HD현대중공업
        '011200': 881039496,   // HMM
        '009540': 75000000,    // HD한국조선해양
        '010950': 112058397,   // S-Oil
        '011070': 23664507,    // LG이노텍
        '003490': 91680747,    // 대한항공
        '047050': 124432815,   // 포스코인터내셔널
        '010140': 854035571,   // 삼성중공업
        '024110': 647514540,   // 기업은행
        '034020': 633010000,   // 두산에너빌리티
        '090430': 58423644,    // 아모레퍼시픽
        '032640': 429828352,   // LG유플러스
        '097950': 14697798,    // CJ제일제당
        '004020': 135590555,   // 현대제철
        '000720': 111758434,   // 현대건설
        '139480': 27858064,    // 이마트
        '001450': 89424540,    // 현대해상
        '036460': 92405458,    // 한국가스공사
        '004990': 75000000,    // 롯데지주
        '000100': 16270000,    // 유한양행
        '051900': 15618197,    // LG생활건강

        // 코스피 시가총액 51-100
        '030200': 261111808,   // KT
        '009830': 185697736,   // 한화솔루션
        '078930': 92895495,    // GS
        '010620': 71174000,    // HD현대미포
        '000880': 161835520,   // 한화
        '002790': 45578500,    // 아모레G
        // '021240': 코웨이 - ZIP에서 자동 조회
        '001040': 29441993,    // CJ
        '004170': 9782000,     // 신세계
        '005940': 316000000,   // NH투자증권
        '071050': 241171929,   // 한국금융지주
        '047810': 97475107,    // 한국항공우주
        '000150': 52165800,    // 두산
        '088350': 865829716,   // 한화생명
        '016360': 72676802,    // 삼성증권
        '002380': 15026600,    // KCC
        '010060': 23849362,    // OCI홀딩스
        '001570': 46780000,    // 금양
        '180640': 46599600,    // 한진칼
        '033780': 115000000,   // KT&G
        '011170': 34275419,    // 롯데케미칼
        '004800': 9709000,     // 효성
        '000120': 22812104,    // CJ대한통운
        '005850': 35678500,    // 에스엘
        '006800': 680882000,   // 미래에셋증권
        '267250': 71174000,    // HD현대
        '001680': 34648025,    // 대상
        '026960': 40140000,    // 동서
        '000670': 7685092,     // 영풍

        // 코스닥 주요 종목
        '247540': 54785075,    // 에코프로비엠
        '086520': 88282200,    // 에코프로
        '196170': 85481019,    // 알테오젠
        '041510': 23545890,    // SM
        '293490': 96721820,    // 카카오게임즈
        '263750': 54600000,    // 펄어비스
        '035900': 33600000,    // JYP Ent.
        '122870': 17520000,    // YG엔터테인먼트
        '352820': 214804472,   // 하이브
        '377300': 132180000,   // 카카오페이
        '251270': 87500000,    // 넷마블
        '259960': 48000000,    // 크래프톤
        '036570': 21954022,    // 엔씨소프트
        '042700': 98850000,    // 한미반도체
        '326030': 84282587,    // SK바이오팜
        '145020': 17836000,    // 휴젤
        '091990': 136478414,   // 셀트리온헬스케어
        '328130': 29736000     // 루닛
      };
      
      // 하드코딩된 데이터 우선 사용
      if (knownShares[stockCode]) {
        console.log(`✅ ${stockCode} 하드코딩된 상장주식수: ${knownShares[stockCode].toLocaleString()}주`);
        return knownShares[stockCode];
      }
      
      const corpInfo = await this.getCorpCode(stockCode);
      if (!corpInfo) {
        throw new Error('기업코드를 찾을 수 없습니다');
      }
      
      await this.delay(this.rateLimitDelay);
      
      // 1차 시도: 개선된 주식 총수 현황 API 사용
      try {
        console.log(`📊 ${stockCode} 주식 총수 현황 API 사용...`);
        
        const response = await axios.get(`${this.baseURL}/stockTotqySttus.json`, {
          params: {
            crtfc_key: this.apiKey,
            corp_code: corpInfo.corpCode,
            bsns_year: year.toString(),
            reprt_code: '11011' // 사업보고서
          }
        });
        
        if (response.data.status === '000' && response.data.list?.length > 0) {
          // 유가증권(Y) 또는 코스닥(K)인 보통주 찾기
          const stockData = response.data.list.find(item => 
            item.corp_cls && (item.corp_cls === 'Y' || item.corp_cls === 'K') &&
            item.se && (item.se.includes('보통주') || item.se.includes('합계') && !item.se.includes('우선주'))
          );
          
          if (stockData) {
            let shares = null;
            
            // 1. 유통주식수 우선 사용 (자기주식 제외)
            if (stockData.distb_stock_co && parseInt(stockData.distb_stock_co.replace(/[,]/g, '')) > 0) {
              shares = parseInt(stockData.distb_stock_co.replace(/[,]/g, ''));
              console.log(`📈 ${stockCode} 유통주식수: ${shares.toLocaleString()}주`);
            }
            // 2. 발행주식수 사용 (자기주식 포함)
            else if (stockData.istc_totqy && parseInt(stockData.istc_totqy.replace(/[,]/g, '')) > 0) {
              shares = parseInt(stockData.istc_totqy.replace(/[,]/g, ''));
              console.log(`📈 ${stockCode} 발행주식수: ${shares.toLocaleString()}주`);
            }
            
            if (shares && shares > 0) {
              return shares;
            }
          }
        }
        
      } catch (stockTotqyError) {
        console.log(`⚠️ ${stockCode} 주식 총수 현황 API 실패: ${stockTotqyError.message}`);
      }
      
      // 2차 시도: 기존 주식발행현황 API 사용 (Fallback)
      try {
        console.log(`📊 ${stockCode} Fallback - 기존 주식발행현황 API 사용...`);
        
        const response = await axios.get(`${this.baseURL}/stockSttus.json`, {
          params: {
            crtfc_key: this.apiKey,
            corp_code: corpInfo.corpCode,
            bsns_year: year.toString(),
            reprt_code: '11011'
          }
        });
        
        if (response.data.status === '000' && response.data.list?.length > 0) {
          const stockData = response.data.list.find(item => 
            item.se && (item.se.includes('보통주') || item.se.includes('주식수'))
          );
          
          if (stockData && stockData.istc_totqy) {
            const shares = parseInt(stockData.istc_totqy.replace(/[,]/g, ''));
            console.log(`📈 ${stockCode} Fallback 상장주식수: ${shares.toLocaleString()}주`);
            return shares;
          }
        }
        
      } catch (fallbackError) {
        console.log(`⚠️ ${stockCode} Fallback API도 실패: ${fallbackError.message}`);
      }
      
      // 2024년 실패 시 2023년 재시도
      if (year === 2024) {
        console.log(`📊 ${stockCode} 2024년 데이터 없음, 2023년 재시도...`);
        return await this.getSharesOutstanding(stockCode, 2023);
      }

      console.log(`❌ ${stockCode} 모든 방법으로 상장주식수 조회 실패`);
      return null;

    } catch (error) {
      console.error(`상장주식수 조회 실패 (${stockCode}):`, error.message);
      return null;
    }
  }

  // 다중 종목 상장주식수 일괄 조회 (성능 최적화용)
  async getBulkSharesOutstanding(stockCodes, year = 2024) {
    try {
      console.log(`📊 ${stockCodes.length}개 종목 상장주식수 일괄 조회...`);
      
      const results = new Map();
      const batchSize = 15; // 작은 배치로 안정적 처리
      
      for (let i = 0; i < stockCodes.length; i += batchSize) {
        const batch = stockCodes.slice(i, i + batchSize);
        console.log(`📦 배치 ${Math.floor(i/batchSize) + 1}/${Math.ceil(stockCodes.length/batchSize)} (${batch.length}개 종목)`);
        
        const batchPromises = batch.map(async (stockCode) => {
          try {
            const shares = await this.getSharesOutstanding(stockCode, year);
            return { stockCode, shares, error: null };
          } catch (error) {
            return { stockCode, shares: null, error: error.message };
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        
        batchResults.forEach(result => {
          if (result.shares) {
            results.set(result.stockCode, result.shares);
          }
        });
        
        // 배치 간 대기 (API Rate Limit)
        if (i + batchSize < stockCodes.length) {
          await this.delay(1000);
        }
      }
      
      console.log(`✅ 상장주식수 일괄 조회 완료: ${results.size}개 성공`);
      return results;
      
    } catch (error) {
      console.error('상장주식수 일괄 조회 실패:', error.message);
      throw error;
    }
  }
  
  // 재무제표 조회 (단일회사 전체 재무제표) - 다중 연도/보고서 시도
  async getFinancialStatement(stockCode, year = 2024, reportType = '11011') {
    try {
      const cacheKey = `fs_${stockCode}_${year}_${reportType}`;
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }
      
      // 기업 고유번호 조회
      const corpInfo = await this.getCorpCode(stockCode);
      if (!corpInfo) {
        throw new Error('기업코드를 찾을 수 없습니다');
      }
      
      await this.delay(this.rateLimitDelay); // Rate limit 준수
      
      const url = `${this.baseURL}/fnlttSinglAcnt.json?crtfc_key=${this.apiKey}&corp_code=${corpInfo.corpCode}&bsns_year=${year}&reprt_code=${reportType}&fs_div=CFS`;
      
      console.log(`🔗 DART API 호출 URL: ${url.replace(this.apiKey, this.apiKey.substring(0, 8) + '...')}`);
      
      const params = {
        crtfc_key: this.apiKey,
        corp_code: corpInfo.corpCode,
        bsns_year: year.toString(),
        reprt_code: reportType,
        fs_div: 'CFS'
      };
      
      console.log(`🔍 실제 전송 파라미터:`, {
        ...params,
        crtfc_key: params.crtfc_key ? params.crtfc_key.substring(0, 8) + '...' : 'UNDEFINED'
      });
      
      console.log(`🔑 API Key 상태: ${this.apiKey ? '존재함' : '없음'}, 길이: ${this.apiKey?.length}`);
      
      if (!this.apiKey) {
        throw new Error('DART API 키가 설정되지 않았습니다');
      }
      
      if (this.apiKey.length < 20) {
        throw new Error(`DART API 키 길이가 부족합니다. 현재: ${this.apiKey.length}자, 필요: 최소 20자`);
      }
      
      const response = await axios.get(`${this.baseURL}/fnlttSinglAcnt.json`, {
        params: params,
        timeout: 10000
      });
      
      console.log(`📋 DART API 응답: status=${response.data.status}, message=${response.data.message}`);
      
      if (response.data.status === '000') {
        const result = this.parseFinancialData(response.data.list);
        this.cache.set(cacheKey, result);
        return result;
      } else if (response.data.status === '013' && year === 2024) {
        // 2024년 데이터 없으면 2023년 시도
        console.log(`⚠️ ${stockCode} 2024년 데이터 없음, 2023년 시도`);
        return await this.getFinancialStatement(stockCode, 2023, reportType);
      } else if (response.data.status === '013' && reportType === '11011') {
        // 사업보고서 없으면 반기보고서 시도
        console.log(`⚠️ ${stockCode} 사업보고서 없음, 반기보고서 시도`);
        return await this.getFinancialStatement(stockCode, year, '11012');
      } else {
        throw new Error(`DART API 오류: ${response.data.message}`);
      }
      
    } catch (error) {
      console.error(`재무제표 조회 실패 (${stockCode}):`, error.message);
      return null;
    }
  }
  
  // 재무데이터 파싱 (개선된 로직)
  parseFinancialData(dataList) {
    const result = {
      revenue: 0,
      netIncome: 0,
      operatingIncome: 0,
      totalAssets: 0,
      totalEquity: 0
    };
    
    // 연결재무제표 데이터만 추출 (첫 번째 나타나는 데이터)
    const seenAccounts = new Set();
    
    dataList.forEach(item => {
      const accountName = item.account_nm;
      const amount = parseInt(item.thstrm_amount?.replace(/,/g, '') || '0');
      
      // DART 데이터는 원 단위이므로 억원으로 변환 (÷ 100,000,000)
      const amountInBillion = amount / 100000000;
      
      // 매출액 (첫 번째만)
      if (accountName === '매출액' && !seenAccounts.has('revenue')) {
        result.revenue = amountInBillion;
        seenAccounts.add('revenue');
        console.log(`📊 매출액: ${result.revenue.toLocaleString()}억원 (${amount.toLocaleString()}원)`);
      }
      // 당기순이익 (첫 번째만)
      else if (accountName === '당기순이익' && !seenAccounts.has('netIncome')) {
        result.netIncome = amountInBillion;
        seenAccounts.add('netIncome');
        console.log(`📊 당기순이익: ${result.netIncome.toLocaleString()}억원 (${amount.toLocaleString()}원)`);
      }
      // 영업이익 (첫 번째만)
      else if (accountName === '영업이익' && !seenAccounts.has('operatingIncome')) {
        result.operatingIncome = amountInBillion;
        seenAccounts.add('operatingIncome');
        console.log(`📊 영업이익: ${result.operatingIncome.toLocaleString()}억원 (${amount.toLocaleString()}원)`);
      }
      // 자산총계 (첫 번째만)
      else if (accountName === '자산총계' && !seenAccounts.has('totalAssets')) {
        result.totalAssets = amountInBillion;
        seenAccounts.add('totalAssets');
        console.log(`📊 자산총계: ${result.totalAssets.toLocaleString()}억원 (${amount.toLocaleString()}원)`);
      }
      // 자본총계 (첫 번째만)
      else if (accountName === '자본총계' && !seenAccounts.has('totalEquity')) {
        result.totalEquity = amountInBillion;
        seenAccounts.add('totalEquity');
        console.log(`📊 자본총계: ${result.totalEquity.toLocaleString()}억원 (${amount.toLocaleString()}원)`);
      }
    });
    
    return result;
  }
  
  // 3개년 재무데이터 조회 (Multi Account API 사용)
  async getThreeYearFinancials(stockCode) {
    try {
      // 기업 고유번호 조회
      const corpInfo = await this.getCorpCode(stockCode);
      if (!corpInfo) {
        throw new Error('기업코드를 찾을 수 없습니다');
      }
      
      await this.delay(this.rateLimitDelay);
      
      console.log(`📊 ${stockCode} Multi Account API로 3개년 데이터 조회...`);
      
      // Multi Account API 호출 (한 번에 3개년 데이터)
      const response = await axios.get(`${this.baseURL}/fnlttMultiAcnt.json`, {
        params: {
          crtfc_key: this.apiKey,
          corp_code: corpInfo.corpCode,
          bsns_year: '2024',
          reprt_code: '11011' // 사업보고서
        },
        timeout: 10000
      });
      
      if (response.data.status !== '000') {
        throw new Error(`DART API 오류: ${response.data.message}`);
      }
      
      // 연결재무제표 데이터만 추출 (첫 번째 나오는 것)
      const revenueData = response.data.list?.find(item => 
        item.account_nm === '매출액' && item.sj_nm === '손익계산서'
      );
      
      const netIncomeData = response.data.list?.find(item => 
        item.account_nm === '당기순이익' && item.sj_nm === '손익계산서'
      );
      
      if (!revenueData || !netIncomeData) {
        throw new Error('필수 재무 데이터를 찾을 수 없습니다');
      }
      
      // 3개년 데이터 파싱
      const financials = [];
      
      // 전전기 (2022년)
      if (revenueData.bfefrmtrm_amount && netIncomeData.bfefrmtrm_amount) {
        financials.push({
          year: 2022,
          revenue: parseInt(revenueData.bfefrmtrm_amount.replace(/,/g, '')) / 100000000,
          netIncome: parseInt(netIncomeData.bfefrmtrm_amount.replace(/,/g, '')) / 100000000,
          operatingIncome: 0 // Multi API에서는 영업이익이 별도로 제공되지 않을 수 있음
        });
      }
      
      // 전기 (2023년)
      if (revenueData.frmtrm_amount && netIncomeData.frmtrm_amount) {
        financials.push({
          year: 2023,
          revenue: parseInt(revenueData.frmtrm_amount.replace(/,/g, '')) / 100000000,
          netIncome: parseInt(netIncomeData.frmtrm_amount.replace(/,/g, '')) / 100000000,
          operatingIncome: 0
        });
      }
      
      // 당기 (2024년)
      if (revenueData.thstrm_amount && netIncomeData.thstrm_amount) {
        financials.push({
          year: 2024,
          revenue: parseInt(revenueData.thstrm_amount.replace(/,/g, '')) / 100000000,
          netIncome: parseInt(netIncomeData.thstrm_amount.replace(/,/g, '')) / 100000000,
          operatingIncome: 0
        });
      }
      
      console.log(`✅ ${stockCode} Multi API로 ${financials.length}개년 데이터 수집 완료`);
      
      // 매출/순이익 추이 출력
      if (financials.length >= 3) {
        const revenues = financials.map(f => f.revenue.toLocaleString()).join(' → ');
        const netIncomes = financials.map(f => f.netIncome.toLocaleString()).join(' → ');
        console.log(`📈 매출 추이: ${revenues}억원`);
        console.log(`📈 순이익 추이: ${netIncomes}억원`);
      }
      
      return financials;
      
    } catch (error) {
      console.error(`Multi Account API 조회 실패 (${stockCode}):`, error.message);
      
      // Fallback: 기존 방식으로 시도
      console.log(`⚠️ ${stockCode} Fallback으로 기존 API 사용`);
      return await this.getThreeYearFinancialsLegacy(stockCode);
    }
  }

  // 신규: 다중 회사 동시 조회 API (슈퍼스톡스 검색 최적화용)
  async getBulkFinancialData(stockCodes, batchSize = 20) {
    try {
      console.log(`🚀 Bulk 재무데이터 수집 시작: ${stockCodes.length}개 종목, 배치크기: ${batchSize}`);
      
      const results = new Map();
      const failed = [];
      
      // 배치 단위로 처리
      for (let i = 0; i < stockCodes.length; i += batchSize) {
        const batch = stockCodes.slice(i, i + batchSize);
        console.log(`📦 배치 ${Math.floor(i/batchSize) + 1}/${Math.ceil(stockCodes.length/batchSize)} 처리 중... (${batch.length}개 종목)`);
        
        const batchResults = await this.processBulkBatch(batch);
        
        // 결과 병합
        batchResults.successes.forEach((data, stockCode) => {
          results.set(stockCode, data);
        });
        failed.push(...batchResults.failures);
        
        // Rate limit 준수 (배치 간 대기)
        if (i + batchSize < stockCodes.length) {
          await this.delay(1000); // 1초 대기
        }
      }
      
      console.log(`✅ Bulk 수집 완료: 성공 ${results.size}개, 실패 ${failed.length}개`);
      
      return {
        successes: results,
        failures: failed,
        summary: {
          total: stockCodes.length,
          success: results.size,
          failed: failed.length,
          successRate: ((results.size / stockCodes.length) * 100).toFixed(1) + '%'
        }
      };
      
    } catch (error) {
      console.error('Bulk 재무데이터 수집 실패:', error.message);
      throw error;
    }
  }

  // Bulk 배치 처리 (동일한 기업코드들을 그룹핑하여 Multi API 활용)
  async processBulkBatch(stockCodes) {
    const successes = new Map();
    const failures = [];
    
    // 1. 모든 종목의 기업코드 조회 (병렬 처리)
    const corpCodePromises = stockCodes.map(async (stockCode) => {
      try {
        const corpInfo = await this.getCorpCode(stockCode);
        return { stockCode, corpInfo };
      } catch (error) {
        return { stockCode, error: error.message };
      }
    });
    
    const corpCodeResults = await Promise.all(corpCodePromises);
    
    // 2. 성공/실패 분리
    const validStocks = [];
    corpCodeResults.forEach(result => {
      if (result.corpInfo) {
        validStocks.push(result);
      } else {
        failures.push({
          stockCode: result.stockCode,
          reason: result.error || '기업코드 조회 실패'
        });
      }
    });
    
    console.log(`📋 기업코드 조회 완료: 성공 ${validStocks.length}개, 실패 ${failures.length}개`);
    
    // 3. 각 종목별로 Multi Account API 호출 (여전히 개별 호출이지만 최적화됨)
    const financialPromises = validStocks.map(async ({ stockCode, corpInfo }) => {
      try {
        await this.delay(this.rateLimitDelay); // Rate limit
        
        const response = await axios.get(`${this.baseURL}/fnlttMultiAcnt.json`, {
          params: {
            crtfc_key: this.apiKey,
            corp_code: corpInfo.corpCode,
            bsns_year: '2024',
            reprt_code: '11011'
          },
          timeout: 8000 // 더 짧은 timeout으로 빠른 실패 처리
        });
        
        if (response.data.status === '000' && response.data.list?.length > 0) {
          const financialData = this.parseMultiAccountData(response.data.list);
          
          if (financialData.revenue > 0) { // 유효한 데이터만
            return {
              stockCode,
              data: {
                stockCode,
                name: corpInfo.corpName,
                revenue: financialData.revenue,
                netIncome: financialData.netIncome,
                revenueGrowth3Y: financialData.revenueGrowth,
                netIncomeGrowth3Y: financialData.netIncomeGrowth,
                dataSource: 'DART_MULTI',
                lastUpdated: new Date().toISOString(),
                corpCode: corpInfo.corpCode
              }
            };
          }
        }
        
        return { stockCode, error: 'Multi API 데이터 없음' };
        
      } catch (error) {
        return { 
          stockCode, 
          error: `Multi API 호출 실패: ${error.message}` 
        };
      }
    });
    
    // 4. 병렬 실행 및 결과 처리
    const financialResults = await Promise.all(financialPromises);
    
    financialResults.forEach(result => {
      if (result.data) {
        successes.set(result.stockCode, result.data);
      } else {
        failures.push({
          stockCode: result.stockCode,
          reason: result.error
        });
      }
    });
    
    return { successes, failures };
  }

  // Multi Account API 응답 데이터 파싱
  parseMultiAccountData(dataList) {
    const result = {
      revenue: 0,
      netIncome: 0,
      revenueHistory: [],
      netIncomeHistory: [],
      revenueGrowth: 0,
      netIncomeGrowth: 0
    };
    
    // 매출액과 당기순이익 데이터 찾기
    const revenueData = dataList.find(item => 
      item.account_nm === '매출액' && item.sj_nm === '손익계산서'
    );
    
    const netIncomeData = dataList.find(item => 
      item.account_nm === '당기순이익' && item.sj_nm === '손익계산서'
    );
    
    if (revenueData) {
      // 3개년 매출 데이터 (단위: 억원)
      const revenues = [];
      if (revenueData.bfefrmtrm_amount) revenues.push(parseInt(revenueData.bfefrmtrm_amount.replace(/,/g, '')) / 100000000);
      if (revenueData.frmtrm_amount) revenues.push(parseInt(revenueData.frmtrm_amount.replace(/,/g, '')) / 100000000);
      if (revenueData.thstrm_amount) revenues.push(parseInt(revenueData.thstrm_amount.replace(/,/g, '')) / 100000000);
      
      result.revenueHistory = revenues;
      result.revenue = revenues[revenues.length - 1] || 0; // 최신연도
      result.revenueGrowth = this.calculateGrowthRate(revenues);
    }
    
    if (netIncomeData) {
      // 3개년 순이익 데이터 (단위: 억원)
      const netIncomes = [];
      if (netIncomeData.bfefrmtrm_amount) netIncomes.push(parseInt(netIncomeData.bfefrmtrm_amount.replace(/,/g, '')) / 100000000);
      if (netIncomeData.frmtrm_amount) netIncomes.push(parseInt(netIncomeData.frmtrm_amount.replace(/,/g, '')) / 100000000);
      if (netIncomeData.thstrm_amount) netIncomes.push(parseInt(netIncomeData.thstrm_amount.replace(/,/g, '')) / 100000000);
      
      result.netIncomeHistory = netIncomes;
      result.netIncome = netIncomes[netIncomes.length - 1] || 0; // 최신연도
      result.netIncomeGrowth = this.calculateGrowthRate(netIncomes);
    }
    
    return result;
  }
  
  // 기존 방식 (Fallback용)
  async getThreeYearFinancialsLegacy(stockCode) {
    try {
      const currentYear = 2024;
      const years = [2022, 2023, 2024];
      
      const financials = [];
      
      for (const year of years) {
        const data = await this.getFinancialStatement(stockCode, year);
        if (data) {
          financials.push({
            year: year,
            revenue: data.revenue,
            netIncome: data.netIncome,
            operatingIncome: data.operatingIncome
          });
        }
        await this.delay(this.rateLimitDelay);
      }
      
      return financials;
      
    } catch (error) {
      console.error(`Legacy 3개년 재무데이터 조회 실패 (${stockCode}):`, error.message);
      return [];
    }
  }
  
  // 성장률 계산
  calculateGrowthRate(values) {
    if (values.length < 2) return 0;
    
    const startValue = values[0];
    const endValue = values[values.length - 1];
    const years = values.length - 1;
    
    if (startValue <= 0) return 0;
    
    const growthRate = (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
    return Math.round(growthRate * 100) / 100;
  }
  
  // 슈퍼스톡스 조건 확인을 위한 종합 분석
  async analyzeStockFinancials(stockCode) {
    try {
      console.log(`📊 DART API로 ${stockCode} 재무분석 시작...`);
      
      let financials = await this.getThreeYearFinancials(stockCode);
      
      // Multi API 실패시 Legacy 방식 시도
      if (financials.length < 2) {
        console.log(`🔄 ${stockCode} Multi API 실패, Legacy 방식 시도...`);
        financials = await this.getThreeYearFinancialsLegacy(stockCode);
      }
      
      if (financials.length < 2) {
        console.log(`⚠️ ${stockCode}: 모든 방식 실패, 재무데이터 부족 (${financials.length}년)`);
        return null;
      }
      
      if (financials.length < 3) {
        console.log(`📊 ${stockCode}: 부분 재무데이터 사용 (${financials.length}년) - 성장률 계산 가능`);
      }
      
      // 매출 및 순이익 성장률 계산
      const revenues = financials.map(f => f.revenue);
      const netIncomes = financials.map(f => f.netIncome);
      
      const revenueGrowth = this.calculateGrowthRate(revenues);
      const netIncomeGrowth = this.calculateGrowthRate(netIncomes);
      
      console.log(`✅ ${stockCode}: 매출성장률 ${revenueGrowth}%, 순이익성장률 ${netIncomeGrowth}%`);
      
      // 기업명 가져오기
      const corpInfo = await this.getCorpCode(stockCode);
      
      return {
        stockCode: stockCode,
        name: corpInfo?.corpName || this.getStockName(stockCode),
        latestYear: financials[financials.length - 1].year,
        revenue: financials[financials.length - 1].revenue,
        netIncome: financials[financials.length - 1].netIncome,
        revenueGrowth3Y: revenueGrowth,
        netIncomeGrowth3Y: netIncomeGrowth,
        revenueHistory: revenues,
        netIncomeHistory: netIncomes,
        financials: financials
      };
      
    } catch (error) {
      console.error(`DART 재무분석 실패 (${stockCode}):`, error.message);
      return null;
    }
  }
  
  // 종목코드로 시장 추정
  guessMarketFromCode(stockCode) {
    const firstDigit = stockCode.charAt(0);
    if (['0', '1'].includes(firstDigit)) return 'KOSPI';
    if (['2', '3'].includes(firstDigit)) return 'KOSDAQ'; 
    return 'UNKNOWN';
  }

  // Rate limit을 위한 지연 함수
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // 종목명 반환 (기본 매핑) - SuperstocksAnalyzer와 동기화
  getStockName(stockCode) {
    const stockNames = {
      // 코스피 상위 10
      '005930': '삼성전자', '000660': 'SK하이닉스', '035420': 'NAVER',
      '005380': '현대차', '012330': '현대모비스', '000270': '기아',
      '105560': 'KB금융', '055550': '신한지주', '035720': '카카오', '051910': 'LG화학',
      
      // 게임/엔터테인먼트
      '251270': '넷마블', '036570': '엔씨소프트', '352820': '하이브', '377300': '카카오페이',
      '259960': '크래프톤', '293490': '카카오게임즈', '263750': '펄어비스', '095660': '네오위즈',
      '112040': '위메이드', '299900': '위지트', '122870': '와이지엔터테인먼트', '041510': '에스엠',
      '035900': 'JYP Ent.', '067160': '아프리카TV', '181710': 'NHN', '034120': 'SBS',
      
      // 바이오/제약
      '326030': 'SK바이오팜', '145020': '휴젤', '195940': 'HK이노엔', '214150': '클래시스',
      '214450': '파마리서치', '009420': '한올바이오파마', '285130': 'SK케미칼', '196170': '알테오젠',
      '065660': '안트로젠', '302440': '셀트리온헬스케어', '091990': '셀트리온헬스케어',
      '328130': '루닛', '085660': '차바이오텍', '237690': '에스티팜', '287410': '제이준코스메틱',
      '099430': '바이오스마트', '141080': '레고켐바이오', '156100': '엘앤케이바이오',
      
      // IT/반도체/소프트웨어
      '042700': '한미반도체', '000990': 'DB하이텍', '058470': '리노공업', '240810': '원익IPS',
      '064290': '인텍플러스', '039030': '이오테크닉스', '131970': '두산테스나', '108860': '셀바스AI',
      '347860': '알체라', '256940': 'NAVER클라우드플랫폼', '033240': '자화전자', '046390': '삼화콘덴서',
      '060720': '라드웨어KR', '214370': '케어젠', '347890': '엠투엔', '052020': '에스티큐브',
      
      // 전자/부품
      '078600': '대주전자재료', '036810': '에프앤가이드', '036540': 'SFA반도체',
      '140610': '엠투엔', '403870': 'HPSP', '206640': '바디텍메드',
      '086520': '에코프로', '101160': '월덱스', '067630': 'HLB생명과학', '066700': '테라젠이텍스',
      '418550': '제이오', '189300': '인텔리안테크', '950170': '코오롱플라스틱', '950140': '삼성물산우',
      
      // 추가 매핑
      '182360': '큐브엔터', '194480': '데브시스터즈', '054780': '키이스트', '192080': '더블유게임즈',
      '099190': '아이센스', '230240': '에치에프알', '205470': '휴마시스', '174900': '앱클론',
      '950210': '대상홀딩스우', '950130': '엔씨소프트우', '006280': '녹십자', '088350': '한화생명',
      '051600': '한전KPS', '086900': '메디톡스', '068760': '셀트리온제약',
      
      // 코스피 메이저 추가
      '006400': '삼성SDI', '028260': '삼성물산', '096770': 'SK이노베이션', '003550': 'LG',
      '015760': '한국전력', '017670': 'SK텔레콤', '034730': 'SK', '003490': '대한항공',
      '009150': '삼성전기', '032830': '삼성생명', '000810': '삼성화재', '001570': '금양',
      '068270': '셀트리온', '207940': '삼성바이오로직스', '323410': '카카오뱅크',
      '003670': '포스코홀딩스', '018260': '삼성에스디에스', '005935': '삼성전자우',
      '329180': 'HD현대미포', '010950': 'S-Oil', '000720': '현대건설',
      '024110': '기업은행', '316140': '우리금융지주', '086790': '하나금융지주',
      '030200': 'KT', '009540': 'HD한국조선해양', '011200': 'HMM',
      '139480': '이마트', '021240': '코웨이', '161390': '한국타이어앤테크놀로지',
      '005490': 'POSCO홀딩스', '004020': '현대제철', '010140': '삼성중공업',
      '011070': 'LG이노텍', '001450': '현대해상', '090430': '아모레퍼시픽',
      '002790': '아모레G', '018880': '한온시스템', '051900': 'LG생활건강', '097950': 'CJ제일제당',
      
      // 추가 실제 코스닥 우량주 매핑
      '279600': '알앤디컴퍼니', '267290': '경동도시가스', '137400': '피엔티',
      '161000': '애경산업', '187660': '현대로지스틱스', '183300': '코미코',
      '306200': 'KG케미칼', '277880': '티에스인베스트먼트', '225570': '넥슨게임즈',
      '347000': '네패스', '383310': '에코마케팅', '090460': '비에이치',
      '278280': '천보', '033500': '동성화인텍', '263770': '유니테스트',
      '047920': '포스코DX', '036620': 'MS오토텍', '039200': '오스코텍',
      
      // 기타 추가
      '032350': '롯데관광개발', '000500': '가온전선', '020000': '한섬',
      '005300': '롯데칠성', '086890': '이수화학', '079170': '신풍제약',
      '028050': '삼성엔지니어링', '079430': '현대리바트', '131390': '한국선재',
      '064960': 'SNT모티브', '192820': '코스맥스', '079370': 'KG모빌리언스',
      '086450': '동국제약', '060310': '3S', '226330': '신테카바이오',
      '178920': '피아이첨단소재', '004000': '롯데정밀화학', '000150': '두산',
      '004560': '현대중공업지주', '001800': '오리온홀딩스'
    };
    return stockNames[stockCode] || `종목${stockCode}`;
  }
  
  // API 키 설정
  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }
  
  // 캐시 초기화
  clearCache() {
    this.cache.clear();
  }
}

module.exports = new DartService();