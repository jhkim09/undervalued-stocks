# 터틀투자 API 매핑 레퍼런스

이 문서는 각 API 엔드포인트가 어떤 함수와 서비스를 호출하는지 매핑 정보를 제공합니다.
매번 코드를 뒤지지 않고 빠르게 참조할 수 있도록 작성되었습니다.

## 📋 목차

- [터틀 신호 관련 API](#터틀-신호-관련-api)
- [종목명 관련 API](#종목명-관련-api)
- [슈퍼스톡 관련 API](#슈퍼스톡-관련-api)
- [키움 API 관련](#키움-api-관련)
- [재무데이터 관련 API](#재무데이터-관련-api)
- [포지션/거래 관련 API](#포지션거래-관련-api)
- [테스트 API](#테스트-api)

---

## 터틀 신호 관련 API

### `/api/signals/*`

| 엔드포인트 | 메소드 | 주요 함수 | 호출 서비스 | 설명 |
|-----------|-------|-----------|-------------|------|
| `/api/signals/latest` | GET | `Signal.find()` | MongoDB | 최신 터틀 신호 10개 조회 |
| `/api/signals/analysis-details` | GET | `TurtleAnalyzer.analyzeMarket()` | TurtleAnalyzer, KiwoomService | 전체 시장 분석 및 신호 생성 |
| `/api/signals/risk` | GET | `TurtleAnalyzer.analyzeMarket()` + 리스크 계산 | TurtleAnalyzer, PortfolioTracker | 신호 + 리스크 분석 |
| `/api/signals/portfolio-n-values` | GET | `KiwoomService.getAccountBalance()` + `TurtleAnalyzer.calculateATR()` + 10일 최저가 계산 | KiwoomService, TurtleAnalyzer | 보유종목 N값(ATR) 및 10일 최저가 분석 |

### 주요 호출 체인

```
/api/signals/latest
└── Signal.find().sort({ createdAt: -1 }).limit(10)

/api/signals/analysis-details  
├── TurtleAnalyzer.analyzeMarket()
│   ├── TurtleAnalyzer.analyzeStock(symbol, name)
│   │   ├── TurtleAnalyzer.getPriceData() → KiwoomService.getDailyData()
│   │   ├── YahooFinanceService.get52WeekHighLow()
│   │   └── TurtleAnalyzer.calculateRecommendedAction()
│   └── StockName.getBulkStockNames()
├── SuperstocksAnalyzer.analyzeSuperstocks()
└── SlackMessageFormatter.formatIntegratedAnalysis()

/api/signals/portfolio-n-values
├── KiwoomService.getAccountBalance()
├── ETF 종목 필터링 (TIGER, KODEX 등 제외)
├── TurtleAnalyzer.getPriceData() (각 보유종목별)
├── TurtleAnalyzer.calculateATR() (N값 계산)
├── 10일 최저가 계산 (최근 10일 최저가)
└── SlackMessageFormatter.formatPortfolioNValues() (10일 최저가 포함)
```

---

## 종목명 관련 API

### `/api/stock-names/*`

| 엔드포인트 | 메소드 | 주요 함수 | 호출 서비스 | 설명 |
|-----------|-------|-----------|-------------|------|
| `/api/stock-names/test/:stockCode` | GET | `StockNameCacheService.getStockName()` | StockNameCacheService → StockName | 개별 종목명 조회 |
| `/api/stock-names/stats` | GET | `StockName.aggregate()` | MongoDB | 종목명 DB 통계 |
| `/api/stock-names/update-from-krx` | POST | `KrxDataParser.parseKrxData()` | KrxDataParser, StockName | KRX 데이터로 종목명 업데이트 |

### 주요 호출 체인

```
/api/stock-names/test/:stockCode
└── StockNameCacheService.getStockName(stockCode)
    ├── correctedNames 매핑 체크 (009150→삼성전기, 196170→알테오젠, 042660→한화오션)
    ├── memoryCache.get() (메모리 캐시)
    ├── StockName.getStockName() (DB 조회)
    └── generateFallbackName() (fallback)

StockName.getStockName()
├── correctedNames 매핑 적용
└── this.findOne({ stockCode, isActive: true })

StockName.getBulkStockNames()
├── correctedNames 매핑 적용  
└── this.find({ stockCode: { $in: stockCodes }, isActive: true })
```

---

## 슈퍼스톡 관련 API

### `/api/superstocks/*`

| 엔드포인트 | 메소드 | 주요 함수 | 호출 서비스 | 설명 |
|-----------|-------|-----------|-------------|------|
| `/api/superstocks/cache-status` | GET | `FinancialData.aggregate()` | MongoDB | 슈퍼스톡 캐시 통계 |
| `/api/superstocks/stock/:stockCode` | GET | `SuperstocksAnalyzer.analyzeSingleStock()` | SuperstocksAnalyzer | 개별 종목 슈퍼스톡 분석 |

### 주요 호출 체인

```
/api/superstocks/stock/:stockCode  
└── SuperstocksAnalyzer.analyzeSingleStock(stockCode)
    ├── FinancialData.getLatestFinancialData(stockCode)
    ├── KiwoomService.getCurrentPrice(stockCode) (모의 가격)
    ├── 성장률 계산 (매출, 순이익)
    ├── PSR 계산
    └── 조건 만족 여부 판단
```

---

## 키움 API 관련

### `/api/kiwoom/*`

| 엔드포인트 | 메소드 | 주요 함수 | 호출 서비스 | 설명 |
|-----------|-------|-----------|-------------|------|
| `/api/kiwoom/price/:symbol` | GET | `KiwoomService.getCurrentPrice()` | KiwoomService | 현재가 조회 |
| `/api/kiwoom/daily/:symbol` | GET | `KiwoomService.getDailyData()` | KiwoomService | 일봉 데이터 조회 |
| `/api/kiwoom/account/:accountNumber?` | GET | `KiwoomService.getAccountBalance()` | KiwoomService | 계좌 잔고 조회 |

### 주요 호출 체인

```
/api/kiwoom/daily/:symbol
└── KiwoomService.getDailyData(symbol, days)
    ├── YahooFinanceService.getHistoricalData() (우선 시도)
    ├── 키움 API 호출 (연결시) - TR: ka10081
    │   └── response.data.stk_dt_pole_chart_qry[] 파싱
    │       ├── cur_pric: 종가(현재가)
    │       ├── open_pric: 시가  
    │       ├── high_pric: 고가
    │       ├── low_pric: 저가
    │       ├── trde_qty: 거래량
    │       └── dt: 날짜 (YYYYMMDD)
    ├── getSimulationDailyData() (fallback - 시뮬레이션)
    └── TurtleAnalyzer.detectSimulationData() (필터링)

/api/kiwoom/account
└── KiwoomService.getAccountBalance()  
    ├── 키움 API 인증 및 계좌조회
    └── 시뮬레이션 데이터 (fallback)
```

---

## 재무데이터 관련 API

### `/api/financial-data/*`

| 엔드포인트 | 메소드 | 주요 함수 | 호출 서비스 | 설명 |
|-----------|-------|-----------|-------------|------|
| `/api/financial-data/cache/stats` | GET | `FinancialData.aggregate()` | MongoDB | 재무데이터 캐시 통계 |
| `/api/financial-data/stock/:stockCode` | GET | `FinancialDataCacheService.getFinancialData()` | FinancialDataCacheService | 개별 종목 재무데이터 |

---

## 포지션/거래 관련 API

### `/api/positions/*`, `/api/trades/*`, `/api/turtle-positions/*`

| 엔드포인트 | 메소드 | 주요 함수 | 호출 서비스 | 설명 |
|-----------|-------|-----------|-------------|------|
| `/api/positions/` | GET | `KiwoomService.getAccountBalance()` | KiwoomService | 보유 포지션 조회 |
| `/api/turtle-positions/list` | GET | `PortfolioTracker.syncWithKiwoomAccount()` | PortfolioTracker | 터틀 포지션 목록 |
| `/api/turtle-positions/detail/:symbol` | GET | `PortfolioTracker.getPositionDetail()` | PortfolioTracker | 터틀 포지션 상세 |
| `/api/turtle-pyramiding/analyze` | GET | `TurtlePyramiding.analyzeAllPositions()` | TurtlePyramiding | 피라미딩 분석 |

---

## 테스트 API

### `/api/test/*`, `/api/test500/*`

| 엔드포인트 | 메소드 | 주요 함수 | 설명 |
|-----------|-------|-----------|------|
| `/api/test/turtle/:symbol` | GET | `TurtleAnalyzer.analyzeStock()` | 개별 종목 터틀 분석 테스트 |
| `/api/test500/system-health` | GET | 시스템 전반 헬스체크 | 각종 API 연결상태 확인 |

---

## 🔧 주요 서비스별 핵심 함수

### TurtleAnalyzer
- `analyzeMarket()`: 전체 시장 분석
- `analyzeStock(symbol, name)`: 개별 종목 분석  
- `getPriceData(symbol, days)`: 가격 데이터 조회
- `calculateATR(priceData)`: ATR(N값) 계산
- `detectSimulationData(data, symbol)`: 시뮬레이션 데이터 감지

### KiwoomService  
- `getCurrentPrice(symbol)`: 현재가 조회
- `getDailyData(symbol, days)`: 일봉 데이터 조회
- `getAccountBalance()`: 계좌 잔고 조회
- `getSimulationDailyData()`: 시뮬레이션 데이터 생성

### StockNameCacheService
- `getStockName(stockCode)`: 종목명 조회 (메모리캐시→DB→fallback)
- `getBulkStockNames(stockCodes)`: 대량 종목명 조회

### SuperstocksAnalyzer
- `analyzeSuperstocks()`: 슈퍼스톡 전체 분석
- `analyzeSingleStock(stockCode)`: 개별 종목 슈퍼스톡 분석

---

## 🚨 중요한 필터링 및 검증 로직

### 터틀 신호 필터링 (`TurtleAnalyzer.analyzeMarket()`)
1. **시뮬레이션 데이터 제외**: `detectSimulationData()`
2. **데이터 부족 신호 제외**: 손절가/투자금액/ATR이 "데이터부족"인 경우
3. **코넥스 종목 제외**: `['216400']` 등 코넥스 종목 리스트
4. **중복 신호 제거**: 같은 종목의 중복 신호 제거

### 종목명 보정 (모든 종목명 관련 함수)
```javascript
const correctedNames = {
  '009150': '삼성전기',     // 엘포유 → 삼성전기  
  '196170': '알테오젠',     // 비티에스제2호사모투자 → 알테오젠
  '042660': '한화오션',     // 뉴유라이프코리아 → 한화오션
};
```

---

## 📊 주요 데이터 플로우

### 아침 터틀 신호 알림 생성 과정
1. `TurtleAnalyzer.analyzeMarket()` 호출
2. 전체 종목 리스트를 순회하며 `analyzeStock()` 실행
3. 각 종목별로 `getPriceData()` → `KiwoomService.getDailyData()` 호출
4. 시뮬레이션 데이터 감지 및 필터링
5. 터틀 지표 계산 (20일 고점, 10일 저점, ATR)
6. BUY_20/SELL_10 신호 생성
7. 투자금액 및 손절가 계산
8. 데이터 부족/코넥스 종목 필터링
9. `SlackMessageFormatter.formatBuySignals()` 호출
10. 최종 알림 메시지 생성

---

## 📊 포트폴리오 N값 분석 상세 로직

### `/api/signals/portfolio-n-values` 처리 과정

1. **계좌 조회**: `KiwoomService.getAccountBalance()`
   - 키움 API 계좌잔고조회 (TR: opw00004)
   - 보유종목 목록 추출

2. **ETF 종목 필터링**: `isETFStock(symbol, name)`
   ```javascript
   // 제외되는 ETF 패턴:
   ['TIGER', 'KODEX', 'ARIRANG', 'KBSTAR', '미국나스닥', 'ETF', 'ETN']
   // 예: A133690 (TIGER 미국나스닥100) → 제외
   ```

3. **가격 데이터 조회**: `TurtleAnalyzer.getPriceData(symbol, 25)`
   - Yahoo Finance API 시도 (종종 404/429 에러)
   - 키움 API 일봉 데이터 조회 (TR: ka10081)
   - 시뮬레이션 데이터 감지 및 제거

4. **키움 API 일봉 응답 구조** (TR: ka10081):
   ```json
   {
     "stk_dt_pole_chart_qry": [
       {
         "cur_prc": "63400",    // 종가(현재가) ✅
         "open_pric": "64100",  // 시가 ✅
         "high_pric": "64300",  // 고가 ✅
         "low_pric": "62900",   // 저가 ✅
         "trde_qty": "65300",   // 거래량 ✅
         "dt": "20250909"       // 날짜 ✅
       }
     ]
   }
   ```

5. **N값(ATR) 계산**: `TurtleAnalyzer.calculateATR(priceData.slice(0, 21))`
   - 최근 21일 데이터 사용
   - True Range 계산 후 20일 평균

6. **10일 최저가 계산**: 
   ```javascript
   // 키움 데이터는 과거→현재 순서 → reverse()로 뒤집기
   const sortedPriceData = priceData.slice().reverse(); // 최신부터
   const lows = sortedPriceData.map(d => d.low);
   const low10 = Math.min(...lows.slice(1, 11)); // 전일부터 10일간 최저가
   ```

7. **터틀 매도 신호 판단**:
   - `isNearSellSignal`: 현재가 ≤ 10일 최저가
   - 매도신호 발생시 슬랙에서 "⚠️" 표시

8. **슬랙 메시지 포맷** (`SlackMessageFormatter.formatPortfolioNValues()`):
   ```
   • 10일 최저가: 55,200원 (안전: ✅)
   ```

### 🔧 주요 수정 이력 (2025.9.9)

1. **키움 API 필드명 수정**:
   - ❌ `daly_stkpc` → ✅ `stk_dt_pole_chart_qry`
   - ❌ `close_pric` → ✅ `cur_pric`

2. **ETF 종목 제외 로직 추가**:
   - TIGER 미국나스닥100 (A133690) 등 ETF는 N값 계산 제외

3. **10일 최저가 계산 로직 수정**:
   - 데이터 정렬 순서 수정 (reverse() 추가)
   - 올바른 최근 10일 범위 계산

4. **시뮬레이션 데이터 감지 강화**:
   - 하드코딩된 `return false` 제거
   - 가격 현실성 체크 및 날짜 유효성 검증

---

## 📝 주요 서비스 수정 이력

### StockPriceService (2025.10.2)

**변경 내용**: 하드코딩된 백업 가격 완전 제거, 키움 API 실시간 데이터만 사용

**배경**:
- `/api/signals/make-analysis/buy` 엔드포인트에서 슈퍼스톡 매수 후보 조회 시
- SK하이닉스 현재가가 하드코딩된 백업 가격(127,000원)으로 표시되는 문제 발생
- 실제 시세와 큰 차이로 인해 잘못된 투자 판단 유발 가능

**수정 전**:
```javascript
// StockPriceService.getCurrentPrice()
// 1차: 키움 API 시도
// 2차: 하드코딩된 전일 종가 사용 (127,000원 등)
// 3차: null 반환
this.lastClosingPrices = {
  '000660': 127000,  // SK하이닉스
  '005930': 71200,   // 삼성전자
  // ... 40여개 종목 하드코딩
};
```

**수정 후**:
```javascript
// StockPriceService.getCurrentPrice()
// 키움 API 실시간 데이터만 사용
// 실패 시 즉시 null 반환 (분석 제외)
constructor() {
  // 하드코딩된 백업 가격 제거
}
```

**영향받는 API**:
- `/api/signals/make-analysis/buy` - 슈퍼스톡 매수 신호
- `/api/signals/make-analysis` - 통합 분석
- `/api/superstocks/*` - 슈퍼스톡 관련 모든 API

**주요 변경점**:
1. `getCurrentPrice()`: 키움 API만 사용, 백업 가격 제거
2. `getBulkPrices()`: 하드코딩 가격 fallback 제거
3. 가격 조회 실패 시 null 반환 → 해당 종목 분석 제외
4. 데이터 소스: `KIWOOM_REALTIME`로 명시

**주의사항**:
- 키움 API 장애 시 모든 종목이 분석에서 제외될 수 있음
- 실시간 데이터만 사용하므로 정확도 향상
- 백업 데이터 없으므로 키움 API 안정성 중요

**관련 파일**:
- `backend/services/stockPriceService.js`
- `turtleinvest/backend/services/stockPriceService.js`

**Git 커밋**:
- Branch: `fix-superstock-realtime`
- Commit: `a9c47980` → `4a3e5815` (master merge)
- 배포: Render 자동 배포 완료 (2025.10.2)

---

*이 문서는 2025년 10월 2일 기준으로 업데이트되었으며, StockPriceService 실시간 데이터 전환이 반영되었습니다.*