// 서비스 워커: 웹 푸시(아이폰 홈 화면 앱) 수신 전용. 화면 파일은 캐시하지 않음.
importScripts(
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js"
);
firebase.initializeApp({
  apiKey: "AIzaSyCfgBg0koPTzGuPq22LPuCZOqoQlO-wOvk",
  authDomain: "mission-clear-a4e68.firebaseapp.com",
  projectId: "mission-clear-a4e68",
  storageBucket: "mission-clear-a4e68.firebasestorage.app",
  messagingSenderId: "742268324025",
  appId: "1:742268324025:web:23e888c125ce6a65d63368"
});
firebase.messaging();   // 알림(notification) 메시지는 자동으로 표시됨
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
