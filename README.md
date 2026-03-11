# 🏠 부동산 매수 평가 앱 — React Native (Expo)

## 📁 프로젝트 구조

```
RealEstateApp/
├── App.js                        # 앱 진입점, 탭 네비게이션
├── package.json
├── src/
│   ├── firebase.js               # Firebase 설정 (키 입력 필요)
│   ├── constants.js              # 기본 데이터, 색상, 유틸
│   ├── hooks/
│   │   └── useAppState.js        # 전체 상태 관리 + Firebase 동기화
│   ├── screens/
│   │   ├── ScoreTab.js           # 점수 입력 화면
│   │   ├── CompareTab.js         # 매물 비교 화면
│   │   └── CriteriaTab.js        # 평가 항목 관리 화면
│   └── components/
│       └── ShareModal.js         # 공유 모달 (바텀시트)
```

---

## 🚀 로컬 실행

```bash
# 1. 의존성 설치
npm install

# 2. 개발 서버 실행
npx expo start

# 3. 스마트폰에 Expo Go 앱 설치 후 QR 스캔
```

---

## 🔥 Firebase 설정 (실시간 공유 기능)

1. https://console.firebase.google.com 접속
2. 새 프로젝트 생성
3. **Firestore Database** 활성화 (테스트 모드)
4. 프로젝트 설정 > 앱 추가(Web) > 설정값 복사
5. `src/firebase.js` 파일에 붙여넣기

```js
const firebaseConfig = {
  apiKey: "복사한 값",
  authDomain: "복사한 값",
  projectId: "복사한 값",
  ...
};
```

---

## 📱 앱스토어 / 플레이스토어 출시 절차

### 공통 준비

| 항목 | 내용 |
|------|------|
| 앱 아이콘 | 1024×1024 PNG |
| 스플래시 스크린 | 2048×2048 PNG |
| 스크린샷 | iOS: 6.5인치 / Android: 다양한 해상도 |
| 개인정보처리방침 | 공개 URL 필요 (Notion, 블로그 등 가능) |
| 앱 설명 | 한/영 버전 준비 권장 |

---

### 🍎 App Store (iOS)

1. **Apple Developer 계정** 등록: https://developer.apple.com ($99/년)
2. Xcode 설치 (Mac 필수)
3. 앱 빌드:
   ```bash
   npx expo build:ios
   # 또는 EAS Build 사용 (권장)
   npx eas build --platform ios
   ```
4. App Store Connect에서 앱 등록
5. TestFlight로 내부 테스트 후 심사 제출
6. **심사 기간**: 보통 1~3일

---

### 🤖 Google Play Store (Android)

1. **Google Play Developer 계정** 등록: https://play.google.com/console ($25 일회성)
2. 앱 빌드:
   ```bash
   npx eas build --platform android
   ```
3. `.aab` 파일 생성됨
4. Google Play Console에서 앱 등록 후 업로드
5. 내부 테스트 → 비공개 테스트 → 공개 출시 단계적 진행
6. **심사 기간**: 보통 1~7일

---

## ✅ 출시 전 체크리스트

- [ ] Firebase 프로젝트 생성 및 `firebase.js` 설정
- [ ] Firestore 보안 규칙 설정 (프로덕션용)
- [ ] Apple Developer 계정 등록
- [ ] Google Play Developer 계정 등록
- [ ] 앱 아이콘 및 스플래시 이미지 제작
- [ ] 개인정보처리방침 페이지 작성 및 배포
- [ ] EAS CLI 설치: `npm install -g eas-cli`
- [ ] `eas.json` 빌드 프로파일 설정
- [ ] 각 플랫폼 스크린샷 촬영
- [ ] 앱 설명 문구 작성
