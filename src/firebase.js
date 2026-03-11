// src/firebase.js
// ─────────────────────────────────────────────────────────────────
// 🔧 설정 방법:
//   1. https://console.firebase.google.com 에서 프로젝트 생성
//   2. Firestore Database 활성화 (테스트 모드로 시작)
//   3. 프로젝트 설정 > 앱 추가(Web) > 아래 값들을 복사해서 붙여넣기
// ─────────────────────────────────────────────────────────────────
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
