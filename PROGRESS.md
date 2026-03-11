# 부동산 매수 평가 앱 — 진행 상황

## 완료된 항목

### 앱 개발
- [x] React Native (Expo) 앱 개발 완료
  - 점수 입력 (ScoreTab)
  - 매물 비교 (CompareTab)
  - 평가 항목 관리 (CriteriaTab)
  - 실시간 공유 모달 (ShareModal)
- [x] Expo SDK 51 → 55 업그레이드
- [x] Firebase 제거, 자체 백엔드(Socket.io)로 전환

### 백엔드 서버
- [x] Node.js + Express + Socket.io + SQLite 서버 개발
  - REST API: 방 생성/조회/삭제
  - WebSocket: 실시간 데이터 동기화
- [x] Render 배포 완료 (Free 플랜)
  - URL: https://realestateapp-e2il.onrender.com

### 빌드 및 배포
- [x] EAS 프로젝트 등록 (@hitaewon/real-estate-eval)
- [x] 앱 아이콘, 적응형 아이콘, 스플래시 이미지 제작 및 적용
- [x] 테스트 APK 빌드 성공 (preview 프로필)
- [x] 프로덕션 AAB 빌드 성공 (production 프로필)

### Google Play
- [x] Google Play Developer 계정 등록 ($25 결제)
- [x] Google Play Console에서 앱 생성
- [x] 내부 테스트 버전 출시 (v1.0.0)
- [x] 테스터 1명 등록

### 기타
- [x] GitHub 리포 생성 (codenamekkk/RealEstateApp)
- [x] 개인정보처리방침 HTML 페이지 작성 (docs/privacy-policy.html)
- [x] .gitignore, app.json, eas.json 설정 완료

---

## 남은 항목

### 기능 개선 (우선)
- [ ] 테스트 중 발견된 UI 문제 수정
- [ ] 추가 기능 개발 (필요 시)
- [ ] 수정 후 새 버전 빌드 및 내부 테스트 업데이트

### Google Play 출시 준비
- [ ] GitHub Pages 활성화 (개인정보처리방침 URL 호스팅)
  - 리포 Settings → Pages → Branch: main → Save
  - URL: https://codenamekkk.github.io/RealEstateApp/docs/privacy-policy.html
- [ ] 스토어 등록정보 작성
  - 앱 이름, 간단한 설명 (80자), 자세한 설명 (4000자)
  - 스크린샷 최소 2장 (폰에서 캡처)
  - 그래픽 이미지 (1024x500)
- [ ] 앱 콘텐츠 설정
  - 광고 포함 여부
  - 타겟 연령대
  - 데이터 보안 설문
  - 콘텐츠 등급 설문

### 프로덕션 출시 조건
- [ ] 내부 테스터 20명 확보
- [ ] 14일간 연속 테스트 완료
- [ ] 위 스토어 등록정보 및 앱 콘텐츠 설정 완료
- [ ] 프로덕션 트랙으로 출시 신청 → Google 심사 (1~7일)

---

## 주요 링크

| 항목 | URL |
|------|-----|
| GitHub 리포 | https://github.com/codenamekkk/RealEstateApp |
| 백엔드 서버 | https://realestateapp-e2il.onrender.com |
| EAS 프로젝트 | https://expo.dev/accounts/hitaewon/projects/real-estate-eval |
| Google Play Console | https://play.google.com/console |
| 테스트 APK | https://expo.dev/accounts/hitaewon/projects/real-estate-eval/builds/557e6b8c-78b9-46a4-8258-36df938b692b |
| 프로덕션 AAB | https://expo.dev/artifacts/eas/2gQMRJWatJUpPgjtCAmXNA.aab |

---

## 업데이트 배포 방법

### 앱 업데이트
```bash
# 1. 코드 수정 후 커밋
git add -A && git commit -m "변경 내용"

# 2. app.json에서 versionCode 올리기 (1 → 2)

# 3. 빌드
eas build --platform android --profile production

# 4. Google Play Console → 내부 테스트 → 새 버전 만들기 → AAB 업로드
```

### 서버 업데이트
```bash
# GitHub에 push하면 Render에서 자동 배포
git push
```
