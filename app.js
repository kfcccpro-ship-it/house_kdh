import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, addDoc, deleteDoc, getDocs, onSnapshot,
  query, where, orderBy, writeBatch, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, PARENT_UID, KID_UID } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const won = n => Number(n || 0).toLocaleString("ko-KR") + "원";
const DAYS = ["일", "월", "화", "수", "목", "금", "토"], ALL = [0, 1, 2, 3, 4, 5, 6];
const EMOS = ["☀️💊", "🌙💊", "🍚", "👕", "📚", "🪥", "🛏️", "🧹", "📖", "✏️", "🎒", "🚿", "🗑️", "🏃", "🐶", "💊"];
const DEFAULT_TASKS = [
  { emoji: "☀️💊", name: "아침약", amount: 2000, alarm: "07:30", days: ALL },
  { emoji: "🍚", name: "저녁밥 먹고 가기", amount: 2000, alarm: "17:30", days: ALL },
  { emoji: "🌙💊", name: "저녁약", amount: 2000, alarm: "23:00", days: ALL },
  { emoji: "👕", name: "빨래 정리", amount: 2000, alarm: "23:00", days: ALL },
  { emoji: "📚", name: "책상 정리", amount: 2000, alarm: "23:00", days: ALL },
  { emoji: "🪥", name: "저녁 양치", amount: 2000, alarm: "23:00", days: ALL },
];

let role = null, curDay = dkey(), unsubs = [];
let tasks = [], recs = {}, doneAll = [], ledger = [];
/* ---------- 시간 알림 (APK 안에서만 동작) ---------- */
const LN = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.LocalNotifications : null;
let alarmSig = "";
async function scheduleAlarms() {
  if (!LN) return;
  const items = [];
  tasks.forEach((t, i) => {
    if (!t.alarm) return;
    const [h, m] = t.alarm.split(":").map(Number);
    (t.days || ALL).forEach(d => items.push({
      id: (i + 1) * 10 + d + 1, title: `${t.emoji} ${t.name}`, body: "사진 찍을 시간이에요!",
      schedule: { on: { weekday: d + 1, hour: h, minute: m }, allowWhileIdle: true }
    }));
  });
  const sig = JSON.stringify(items); if (sig === alarmSig) return; alarmSig = sig;
  try {
    const p = await LN.requestPermissions(); if (p.display !== "granted") return;
    const pend = await LN.getPending();
    if (pend.notifications.length) await LN.cancel({ notifications: pend.notifications });
    if (items.length) await LN.schedule({ notifications: items });
  } catch (e) { console.warn("알림 예약 실패", e); alarmSig = ""; }
}

let tab = "today", editing = null, payArm = false, camTask = null;

/* ---------- 공통 ---------- */
function show(id) {
  for (const s of ["login", "kid", "par"]) $("#" + s).hidden = s !== id;
}
function stopAll() { unsubs.forEach(u => u()); unsubs = []; }
let tt;
function toast(b, s) {
  $("#toastB").textContent = b; $("#toastS").textContent = s;
  $("#toast").classList.add("on"); clearTimeout(tt);
  tt = setTimeout(() => $("#toast").classList.remove("on"), 1800);
}
const todayTasks = () => tasks.filter(t => (t.days || ALL).includes(new Date().getDay()));

/* ---------- 로그인 ---------- */
$("#lEmail").value = (() => { try { return localStorage.getItem("mc-email") || ""; } catch (e) { return ""; } })();
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("#lErr").textContent = ""; $("#lBtn").disabled = true;
  try {
    const email = $("#lEmail").value.trim();
    await signInWithEmailAndPassword(auth, email, $("#lPw").value);
    try { localStorage.setItem("mc-email", email); } catch (e2) { }
    $("#lPw").value = "";
  } catch (err) {
    const m = {
      "auth/invalid-credential": "이메일 또는 비밀번호가 맞지 않아요.",
      "auth/invalid-email": "이메일 형식이 올바르지 않아요.",
      "auth/too-many-requests": "시도가 너무 많아요. 잠시 후 다시 해 주세요.",
      "auth/network-request-failed": "인터넷 연결을 확인해 주세요.",
      "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "앱 설정(apiKey)이 올바르지 않아요. 관리자에게 알려 주세요.",
    }[err.code];
    $("#lErr").textContent = m || ("로그인 실패: " + (err.code || err.message));
  }
  $("#lBtn").disabled = false;
});

onAuthStateChanged(auth, user => {
  stopAll();
  if (!user) { role = null; show("login"); return; }
  if (user.uid === PARENT_UID) { role = "parent"; startParent(); }
  else if (user.uid === KID_UID) { role = "kid"; startKid(); }
  else { signOut(auth); $("#lErr").textContent = "이 계정은 사용할 수 없어요."; }
});

// 자정이 지나 앱이 켜져 있으면 날짜 새로 시작
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && role && dkey() !== curDay) {
    stopAll(); role === "kid" ? startKid() : startParent();
  }
});

/* 지난 날짜 사진 삭제 (기록·금액은 남김) */
async function cleanOldPhotos() {
  try {
    const snap = await getDocs(query(collection(db, "records"), where("date", "<", dkey())));
    const olds = snap.docs.filter(d => d.data().photo);
    for (let i = 0; i < olds.length; i += 400) {
      const b = writeBatch(db);
      olds.slice(i, i + 400).forEach(d => b.update(d.ref, { photo: "" }));
      await b.commit();
    }
  } catch (e) { console.warn("사진 정리 실패", e); }
}

/* 오늘 기록 구독 (아이·부모 공통) */
function listenToday(render) {
  curDay = dkey();
  unsubs.push(onSnapshot(query(collection(db, "tasks"), orderBy("order")), s => {
    tasks = s.docs.map(d => ({ id: d.id, ...d.data() })); render();
  }, e => console.error(e)));
  unsubs.push(onSnapshot(query(collection(db, "records"), where("date", "==", curDay)), s => {
    recs = {}; s.docs.forEach(d => { const x = d.data(); recs[x.taskId] = x; }); render();
  }, e => console.error(e)));
}

/* ---------- 아이 ---------- */
function startKid() {
  show("kid"); listenToday(renderKid); cleanOldPhotos();
}
function renderKid() {
  const d = new Date(), list = todayTasks();
  $("#kDate").textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAYS[d.getDay()]}요일`;
  const done = list.filter(t => recs[t.id]?.status === "done");
  $("#kCnt").textContent = `${done.length}/${list.length}`;
  $("#kWon").textContent = won(done.reduce((a, t) => a + (recs[t.id].amount || 0), 0));
  $("#kBar").style.width = (list.length ? done.length / list.length * 100 : 0) + "%";
  const next = list.find(t => recs[t.id]?.status !== "done");
  const n = list.length, dd = n <= 3 ? "xl" : n <= 6 ? "m" : n <= 9 ? "s" : "xs", sm = n > 6;
  $("#kGrid").dataset.d = dd; $("#kid").dataset.d = dd;
  $("#kGrid").innerHTML = list.map(t => {
    const x = recs[t.id], st = x?.status;
    const cls = st === "done" ? "done" : st === "rejected" ? "rej" : (t === next ? "next" : "");
    const lab = st === "done" ? "✅ 완료" : st === "rejected" ? (sm ? "↺ 다시" : "↺ 다시 찍기") : (sm ? "📷 찍기" : "📷 사진 찍기");
    const th = st === "done" ? (x.photo ? `<img class="thumb" src="${esc(x.photo)}" alt="">` : `<span class="thumb">📸</span>`) : "";
    return `<button class="tile ${cls}" data-id="${esc(t.id)}">${th}<span class="emo">${esc(t.emoji)}</span><span class="nm">${esc(t.name)}</span><span class="st">${lab}</span></button>`;
  }).join("");
  $("#kClear").hidden = !(list.length && done.length === list.length);
  scheduleAlarms();
}
$("#kGrid").addEventListener("click", e => {
  const b = e.target.closest(".tile"); if (!b) return;
  if (recs[b.dataset.id]?.status === "done") { toast("👍", "이미 완료했어요!"); return; }
  camTask = b.dataset.id; $("#cam").value = ""; $("#cam").click();
});
function compress(file) {
  return new Promise((res, rej) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, 720 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u); res(c.toDataURL("image/jpeg", 0.6));
    };
    img.onerror = rej; img.src = u;
  });
}
$("#cam").addEventListener("change", async e => {
  const f = e.target.files[0], id = camTask; if (!f || !id) return;
  const t = tasks.find(x => x.id === id); if (!t) return;
  try {
    const photo = await compress(f), key = `${dkey()}_${id}`;
    // 기다리지 않고 전송: 인터넷이 느려도 화면은 바로 완료로 바뀌고 자동으로 올라감
    setDoc(doc(db, "records", key), {
      date: dkey(), taskId: id, taskName: t.name, status: "done", at: hm(),
      amount: Number(t.amount) || 0, photo, kb: Math.round(photo.length * 0.75 / 1024)
    }).catch(err => { console.error(err); toast("😥", "올리지 못했어요. 다시 찍어 주세요"); });
    toast("+" + won(t.amount), `${t.name} 완료! 🎉`);
  } catch (err) { toast("😥", "사진을 못 읽었어요. 다시 찍어 주세요"); }
});

/* ---------- 부모 ---------- */
async function startParent() {
  show("par"); listenToday(renderPar); cleanOldPhotos();
  unsubs.push(onSnapshot(query(collection(db, "records"), where("status", "==", "done")), s => {
    doneAll = s.docs.map(d => d.data()); if (tab === "money") renderPar();
  }));
  unsubs.push(onSnapshot(query(collection(db, "ledger"), orderBy("at", "desc")), s => {
    ledger = s.docs.map(d => ({ id: d.id, ...d.data() })); if (tab === "money") renderPar();
  }));
  // 처음 한 번: 기본 할 일 6개 등록
  try {
    const s = await getDocs(collection(db, "tasks"));
    if (s.empty) {
      const b = writeBatch(db);
      DEFAULT_TASKS.forEach((t, i) => b.set(doc(collection(db, "tasks")), { ...t, order: i + 1 }));
      await b.commit();
    }
  } catch (e) { console.error(e); }
}
$("#pOut").onclick = () => signOut(auth);
document.querySelector(".tabs").addEventListener("click", e => {
  const t = e.target.dataset.t; if (!t) return; tab = t; payArm = false; renderPar();
});
function renderPar() {
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.t === tab));
  $("#tToday").hidden = tab !== "today"; $("#tTasks").hidden = tab !== "tasks"; $("#tMoney").hidden = tab !== "money";
  ({ today: renderToday, tasks: renderTasks, money: renderMoney })[tab]();
}

function ph(x, t) {
  return x?.photo ? `<img class="ph" src="${esc(x.photo)}" alt="${esc(t.name)} 사진">`
    : `<span class="ph">${x ? "📸" : esc(t.emoji)}</span>`;
}
function renderToday() {
  const list = todayTasks(), done = list.filter(t => recs[t.id]?.status === "done");
  $("#tToday").innerHTML = `
    <div class="duo"><div><small>오늘 완료</small><b>${done.length} / ${list.length}</b></div><div><small>오늘 적립</small><b>${won(done.reduce((a, t) => a + (recs[t.id].amount || 0), 0))}</b></div></div>
    <div class="list">${list.map(t => {
      const x = recs[t.id];
      const tag = x?.status === "done" ? `<span class="tag ok">완료 ${esc(x.at)}</span>` : x?.status === "rejected" ? '<span class="tag no">반려됨</span>' : '<span class="tag wait">대기</span>';
      const sub = x?.status === "done" ? `${won(x.amount)}${x.photo ? ` · 사진 ${x.kb}KB` : " · 사진 삭제됨"}` : won(t.amount);
      const btn = x?.status === "done" ? `<button class="pill sm warn" data-rej="${esc(t.id)}">반려</button>` : "";
      return `<div class="row">${ph(x, t)}<div class="tx"><b>${esc(t.emoji)} ${esc(t.name)}</b><span>${sub}</span></div>${tag}${btn}</div>`;
    }).join("") || '<div class="row"><div class="tx"><span>오늘 할 일이 없어요.</span></div></div>'}</div>
    <p class="note">사진이 엉뚱하면 [반려]를 누르세요. 적립이 취소되고 아이 화면에 '다시 찍기'가 표시됩니다. 사진은 다음 날 자동 삭제되고 기록과 금액은 남습니다.</p>`;
}
$("#tToday").addEventListener("click", e => {
  const id = e.target.dataset.rej; if (!id) return;
  const x = recs[id]; if (!x) return;
  setDoc(doc(db, "records", `${x.date}_${id}`), { ...x, status: "rejected", photo: "", kb: 0 })
    .catch(err => { console.error(err); toast("😥", "반려하지 못했어요"); });
});

function renderTasks() {
  const t = editing;
  $("#tTasks").innerHTML = `
    <div class="list">${tasks.map(x => `<div class="row"><span class="ph">${esc(x.emoji)}</span><div class="tx"><b>${esc(x.name)}</b><span>${won(x.amount)} · ${x.alarm ? "알림 " + esc(x.alarm) : "알림 없음"} · ${(x.days || ALL).length === 7 ? "매일" : (x.days || []).map(d => DAYS[d]).join("")}</span></div><button class="pill sm" data-ed="${esc(x.id)}">수정</button></div>`).join("")}</div>
    ${t ? `<div class="ed" id="ed">
      <label>아이콘<div class="emos">${EMOS.map(m => `<button type="button" data-emo="${esc(m)}" aria-pressed="${m === t.emoji}">${m}</button>`).join("")}</div></label>
      <label for="fName">할 일 이름<input id="fName" value="${esc(t.name)}" placeholder="예: 영어 단어 20개"></label>
      <div class="duo"><label for="fAmt" style="display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:800;color:var(--muted)">용돈(원)<input id="fAmt" type="number" inputmode="numeric" step="500" min="0" value="${esc(t.amount)}"></label>
      <label for="fAlarm" style="display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:800;color:var(--muted)">알림 시간<input id="fAlarm" type="time" value="${esc(t.alarm || "")}"></label></div>
      <label>요일<div class="days">${DAYS.map((d, i) => `<button type="button" data-day="${i}" aria-pressed="${t.days.includes(i)}">${d}</button>`).join("")}</div></label>
      <div class="acts">${t.id ? `<button class="pill sm warn" id="fDel">${t.delArm ? "정말 삭제" : "삭제"}</button>` : ""}<button class="pill sm" id="fCancel">취소</button><button class="pill sm solid" id="fSave">저장</button></div>
    </div>` : `<button class="add" id="addT">+ 할 일 추가</button>`}`;
}
$("#tTasks").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  const sync = () => { if (!editing) return; editing.name = $("#fName").value; editing.amount = +$("#fAmt").value || 0; editing.alarm = $("#fAlarm").value; };
  if (b.id === "addT") { editing = { id: null, emoji: "📖", name: "", amount: 2000, alarm: "", days: [...ALL] }; renderTasks(); $("#fName").focus(); return; }
  if (b.dataset.ed) { const x = tasks.find(y => y.id === b.dataset.ed); editing = { ...x, days: [...(x.days || ALL)] }; renderTasks(); return; }
  if (b.dataset.emo) { sync(); editing.emoji = b.dataset.emo; renderTasks(); return; }
  if (b.dataset.day) { sync(); const d = +b.dataset.day; editing.days = editing.days.includes(d) ? editing.days.filter(x => x !== d) : [...editing.days, d].sort(); renderTasks(); return; }
  if (b.id === "fCancel") { editing = null; renderTasks(); return; }
  if (b.id === "fDel") {
    sync(); if (!editing.delArm) { editing.delArm = 1; renderTasks(); return; }
    const id = editing.id; editing = null; renderTasks();
    deleteDoc(doc(db, "tasks", id)).catch(err => { console.error(err); toast("😥", "삭제하지 못했어요"); });
    return;
  }
  if (b.id === "fSave") {
    sync(); if (!editing.name.trim()) { $("#fName").focus(); return; }
    const { id, delArm, ...data } = editing; data.name = data.name.trim();
    editing = null; renderTasks();
    const p = id ? setDoc(doc(db, "tasks", id), data, { merge: true })
      : addDoc(collection(db, "tasks"), { ...data, order: Date.now() });
    p.catch(err => { console.error(err); toast("😥", "저장하지 못했어요"); });
  }
});

function renderMoney() {
  const earned = doneAll.reduce((a, x) => a + (x.amount || 0), 0), paid = ledger.reduce((a, x) => a + (x.amount || 0), 0);
  const byDay = {}; doneAll.forEach(x => { (byDay[x.date] ||= { n: 0, sum: 0 }); byDay[x.date].n++; byDay[x.date].sum += x.amount || 0; });
  const days = Object.keys(byDay).sort().reverse();
  const fmtAt = a => { const d = a?.toDate ? a.toDate() : null; return d ? `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm(d)}` : "처리 중"; };
  $("#tMoney").innerHTML = `
    <div class="big"><small>지급할 용돈</small><b>${won(earned - paid)}</b>
      <button class="pill" id="pay" style="align-self:flex-start;border-color:var(--bg);color:var(--bg)" ${earned - paid <= 0 ? "disabled" : ""}>${payArm ? "한 번 더 누르면 지급 완료" : "지급 완료로 처리"}</button></div>
    <div class="duo"><div><small>누적 적립</small><b>${won(earned)}</b></div><div><small>지급 완료</small><b>${won(paid)}</b></div></div>
    <h3>날짜별 적립</h3>
    <div class="list">${days.map(k => { const [y, m, d] = k.split("-");
      return `<div class="row"><div class="tx"><b>${+m}월 ${+d}일 ${DAYS[new Date(y, m - 1, d).getDay()]}</b><span>${byDay[k].n}개 완료</span></div><b>${won(byDay[k].sum)}</b></div>`; }).join("") || '<div class="row"><div class="tx"><span>아직 적립이 없어요.</span></div></div>'}</div>
    ${ledger.length ? `<h3>지급 기록</h3><div class="list">${ledger.map(x => `<div class="row"><div class="tx"><b>${fmtAt(x.at)}</b></div><b>${won(x.amount)}</b></div>`).join("")}</div>` : ""}`;
}
$("#tMoney").addEventListener("click", e => {
  if (e.target.id !== "pay") return;
  if (!payArm) { payArm = true; renderMoney(); return; }
  const amt = doneAll.reduce((a, x) => a + (x.amount || 0), 0) - ledger.reduce((a, x) => a + (x.amount || 0), 0);
  payArm = false;
  if (amt > 0) addDoc(collection(db, "ledger"), { amount: amt, at: serverTimestamp() })
    .catch(err => { console.error(err); toast("😥", "기록하지 못했어요"); });
  renderMoney();
});
