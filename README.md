# 저평가주식 자동화 분석 시스템

PER, PBR, 비유동자산을 기반으로 저평가 주식을 자동 분석하는 시스템입니다.

## 핵심 분석 지표

- **PER (주가수익비율)**: 주가 / EPS - 수익 대비 주가 평가
- **PBR (주가순자산비율)**: 주가 / BPS - 자산 대비 주가 평가
- **비유동자산**: 장기 자산 가치 분석

## 기술 스택

- **Backend**: Node.js + Express
- **Database**: MongoDB
- **Data Source**: DART API (금융감독원 전자공시)

## 설치 및 실행

```bash
cd backend
npm install
npm run dev
```

## 환경 변수 (.env)

```
MONGODB_URI=mongodb://...
DART_API_KEY=your_dart_api_key
```

## 프로젝트 구조

```
undervalued-stocks/
├── backend/
│   ├── server.js          # 메인 서버
│   ├── routes/            # API 라우트
│   ├── services/          # 비즈니스 로직
│   │   ├── dartService.js # DART API 연동
│   │   └── ...
│   └── models/            # MongoDB 모델
└── README.md
```
