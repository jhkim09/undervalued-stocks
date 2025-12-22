# 종목명 관리 시스템

터틀 트레이딩 시스템에서 `KS_XXXXXX`, `KQ_XXXXXX` 대신 실제 회사명을 표시하기 위한 관리 시스템입니다.

## 📊 데이터 소스 우선순위

1. **KRX CSV (최우선)** - 한국거래소 정식 데이터
2. **하드코딩된 매핑** - 주요 종목 직접 매핑  
3. **DART API** - 전체 기업 데이터 (비상장사 포함)
4. **Fallback** - `코스피XXXXXX`, `코스닥XXXXXX`

## 🚀 사용법

### 1. KRX 상장사 데이터 다운로드
```
https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020501
```
- **메뉴**: 기본통계 > 주식 > 종목정보 > 상장법인현황
- **다운로드**: CSV 형태로 다운로드
- **주기**: 월 1회 또는 신규 상장/폐지 시

### 2. API 엔드포인트

#### 가장 정확한 방법 (KRX CSV 사용)
```bash
POST /api/stock-names/update-from-krx
{
  "csvFilePath": "/path/to/krx_data.csv"
}
```

#### 긴급 업데이트 (하드코딩)
```bash
POST /api/stock-names/populate
```

#### 전체 업데이트 (DART API)
```bash
POST /api/stock-names/update-all
```

#### 배치 업데이트 (타임아웃 방지)
```bash
POST /api/stock-names/update-batch
{
  "batchSize": 200,
  "startIndex": 0
}
```

#### 상태 확인
```bash
GET /api/stock-names/stats
GET /api/stock-names/test/:stockCode
```

#### 캐시 관리
```bash
POST /api/stock-names/clear-cache
```

## 📋 현재 하드코딩된 주요 종목

| 종목코드 | 회사명 | 시장 |
|---------|--------|------|
| 005930 | 삼성전자 | KOSPI |
| 000660 | SK하이닉스 | KOSPI |
| 035420 | NAVER | KOSPI |
| 251270 | 넷마블 | KOSDAQ |
| 035760 | CJ ENM | KOSDAQ |
| 032500 | 케이엠더블유 | KOSDAQ |
| 200670 | 휴메딕스 | KOSDAQ |
| 290650 | 엘앤씨바이오 | KOSDAQ |

(총 30개 종목 하드코딩됨)

## 🔧 문제 해결

### 종목명이 `코스피XXXXXX` 형태로 나올 때
1. **즉시 해결**: 하드코딩된 매핑에 추가
2. **근본 해결**: KRX CSV 다운로드 후 업데이트

### DART API vs KRX CSV
- **DART API**: 모든 기업 포함 (상장사 + 비상장사)
- **KRX CSV**: 실제 상장사만 포함 ✅ (더 정확함)

### 업데이트 주기
- **일반적**: 월 1회 KRX CSV 업데이트
- **긴급**: 신규 상장/폐지 시 즉시 업데이트
- **자동**: 주요 종목은 하드코딩으로 항상 보장

## 📈 성능 최적화

- **메모리 캐시**: 1차 캐시 (빠른 조회)
- **MongoDB**: 2차 캐시 (영구 저장)
- **하드코딩**: 3차 fallback (DB 연결 실패 시)
- **패턴 기반**: 최종 fallback (`코스피XXXXXX`)

## 🎯 목표

모든 터틀 트레이딩 신호에서 **실제 회사명**이 표시되도록 하여 사용자 경험 개선.

**Before**: `🐢 KS_032500 매수 신호`  
**After**: `🐢 케이엠더블유 매수 신호` ✅