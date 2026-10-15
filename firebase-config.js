// Firebase 웹 설정 (공개되어도 안전한 값. 접근은 로그인 + 보안 규칙으로 막음)
export const firebaseConfig = {
  apiKey: "AIzaSyCfgBg0koPTzGuPq22LPuCZOqoQlO-wOvk",
  authDomain: "mission-clear-a4e68.firebaseapp.com",
  projectId: "mission-clear-a4e68",
  storageBucket: "mission-clear-a4e68.firebasestorage.app",
  messagingSenderId: "742268324025",
  appId: "1:742268324025:web:23e888c125ce6a65d63368"
};

// 로그인한 계정의 UID로 화면을 구분 (Firestore 보안 규칙의 UID와 같아야 함)
export const PARENT_UID = "6qTZSXhc3hc5GnHfd0GmV19vd1Y2";
export const KID_UID = "V6mtSKCmzieQsKo4LRKiAHrm3Vk1";
