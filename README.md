# 🏠 부동산 매수 평가 앱 — React Native (Expo)

데이터 기반으로 부동산 매물을 비교·분석하는 모바일 앱입니다.
커스텀 평가 항목과 가중치를 설정하고, 여러 매물의 점수를 한눈에 비교할 수 있습니다.

## 📁 프로젝트 구조

```
RealEstateApp/
├── App.js                        # 앱 진입점, 탭 네비게이션
├── app.json                      # Expo 앱 설정
├── eas.json                      # EAS Build 설정
├── package.json
├── assets/                       # 아이콘, 스플래시 이미지
├── server/                       # 백엔드 서버 (Node.js + Socket.io)
│   ├── index.js                  # 서버 진입점
│   ├── package.json
│   └── .env.example              # 환경변수 예시
├── src/
│   ├── api.js                    # 서버 API 연결 설정
│   ├── constants.js              # 기본 데이터, 색상, 유틸
│   ├── hooks/
│   │   └── useAppState.js        # 전체 상태 관리 + 실시간 동기화
│   ├── screens/
│   │   ├── ScoreTab.js           # 점수 입력 화면
│   │   ├── CompareTab.js         # 매물 비교 화면
│   │   └── CriteriaTab.js        # 평가 항목 관리 화면
│   └── components/
│       └── ShareModal.js         # 공유 모달 (바텀시트)
```

---

## 🚀 로컬 실행

### 앱 (클라이언트)

```bash
# 1. 의존성 설치
npm install

# 2. 개발 서버 실행
npx expo start

# 3. 스마트폰에 Expo Go 앱 설치 후 QR 스캔
```

### 백엔드 서버

```bash
# 1. 서버 디렉토리 이동
cd server

# 2. 의존성 설치
npm install

# 3. 환경변수 설정
cp .env.example .env
# .env 파일에서 PORT 등 설정

# 4. 서버 실행
npm start        # 프로덕션
npm run dev      # 개발 (자동 재시작)
```

---

## 🖥️ 백엔드 아키텍처

### 기술 스택

| 항목 | 기술 |
|------|------|
| 런타임 | Node.js |
| HTTP 서버 | Express |
| 실시간 통신 | Socket.io |
| 데이터베이스 | SQLite (경량, 서버리스) |
| ORM | better-sqlite3 |

### API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/rooms` | 공유 방 생성 |
| GET | `/api/rooms/:code` | 방 정보 조회 |
| DELETE | `/api/rooms/:code` | 방 삭제 (나가기) |

### WebSocket 이벤트

| 이벤트 | 방향 | 설명 |
|--------|------|------|
| `join-room` | Client → Server | 방 입장 |
| `leave-room` | Client → Server | 방 퇴장 |
| `sync-data` | Client → Server | 데이터 동기화 요청 |
| `room-updated` | Server → Client | 방 데이터 업데이트 알림 |

---

## 🤖 Android 빌드 및 출시

### 테스트용 APK 빌드

```bash
eas build --platform android --profile preview
```

### Google Play 제출용 AAB 빌드

```bash
eas build --platform android --profile production
```

### Google Play Store 출시

1. **Google Play Developer 계정** 등록: https://play.google.com/console ($25 일회성)
2. `eas build --platform android --profile production`으로 `.aab` 생성
3. Google Play Console에서 앱 등록 후 업로드
4. 내부 테스트 → 비공개 테스트 → 공개 출시 단계적 진행
5. **심사 기간**: 보통 1~7일

---

## 🚢 백엔드 배포

권장 배포 옵션:

| 서비스 | 무료 티어 | 특징 |
|--------|-----------|------|
| **Railway** | $5/월 크레딧 | 가장 간편, Git 연동 자동 배포 |
| **Render** | 무료 (슬립 있음) | 무료로 시작 가능 |
| **Fly.io** | 무료 티어 | 글로벌 엣지 배포 |
| **AWS EC2** | 1년 무료 | 완전한 제어 가능 |

---

## ✅ 출시 전 체크리스트

- [x] 앱 아이콘 및 스플래시 이미지 제작
- [x] EAS CLI 설치 및 프로젝트 등록
- [x] `app.json`, `eas.json` 빌드 설정
- [x] 테스트용 APK 빌드 성공
- [ ] 백엔드 서버 개발
- [ ] 백엔드 서버 배포
- [ ] 앱에서 Firebase → 자체 백엔드로 전환
- [ ] Google Play Developer 계정 등록
- [ ] 개인정보처리방침 페이지 작성 및 배포
- [ ] 프로덕션 AAB 빌드
- [ ] Google Play Console에 앱 등록 및 심사 제출
