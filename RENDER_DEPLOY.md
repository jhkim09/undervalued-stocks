# 🚀 TurtleInvest Render 배포 가이드

## 1. Render 서비스 생성

### 백엔드 배포
1. **Render.com** 접속 → **New Web Service**
2. **GitHub 연결** → turtleinvest 레포지토리 선택
3. **설정값**:
   - **Name**: `turtleinvest-backend`
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Starter (무료)`

## 2. 환경변수 설정 (Render Dashboard)

### 필수 환경변수
```
NODE_ENV=production
PORT=10000

# MongoDB
MONGODB_URI=mongodb+srv://newsh13:yzzyOhtBB9gtAX4u@cluster1.38tqprc.mongodb.net/turtleinvest?retryWrites=true&w=majority&appName=Cluster1

# 키움 OpenAPI
KIWOOM_APP_KEY=CCLDZcacReFm3ZlquOukZmgP-yx2Thpprr_YQMCPw4A
KIWOOM_SECRET_KEY=O9cp9nxakllOk_8B4zBXNET2ek4jdrewzBP5k7MCrAQ
KIWOOM_ACCOUNT=51075787

# Make.com 연동
MAKE_API_KEY=turtle_make_api_2024
MAKE_WEBHOOK_URL=

# 보안
JWT_SECRET=turtle_invest_secret_key_2024
```

## 3. Make.com HTTP 모듈 설정

### 배포 완료 후 URL
```
https://turtleinvest-backend.onrender.com
```

### HTTP 모듈 설정
- **Method**: `POST`
- **URL**: `https://turtleinvest-backend.onrender.com/api/signals/make-analysis`
- **Headers**:
  ```
  Content-Type: application/json
  ```
- **Body (JSON)**:
  ```json
  {
    "apiKey": "turtle_make_api_2024"
  }
  ```

### 응답 데이터 구조
```json
{
  "success": true,
  "timestamp": "2025-08-18T04:27:44.075Z",
  "analysis": {
    "totalSignals": 2,
    "buySignals": 1,
    "sellSignals": 0,
    "holdSignals": 1
  },
  "signals": [
    {
      "symbol": "005930",
      "name": "삼성전자",
      "signalType": "BUY",
      "currentPrice": 73500,
      "confidence": "high",
      "action": "BUY",
      "quantity": 100,
      "riskAmount": 1000000,
      "reasoning": "20일 돌파 신호 발생"
    }
  ],
  "metadata": {
    "requestedBy": "make.com",
    "analysisType": "turtle_trading",
    "market": "KRX",
    "apiVersion": "1.0"
  }
}
```

## 4. Make.com 시나리오 예시

### HTTP 모듈 → 필터 → 액션
1. **HTTP 모듈**: 신호분석 API 호출
2. **필터**: `analysis.buySignals > 0` (매수 신호가 있을 때만)
3. **액션**: 이메일/슬랙 알림, 스프레드시트 기록 등

### 조건부 실행
- **매수 신호 발생시**: 알림 발송
- **매도 신호 발생시**: 포지션 정리 알림
- **신호 없음**: 로그만 기록

## 5. 웹훅 수신 (선택사항)
```
POST https://turtleinvest-backend.onrender.com/api/signals/webhook
```

Make.com에서 TurtleInvest로 데이터를 보낼 때 사용