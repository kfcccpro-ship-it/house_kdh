import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, addDoc, deleteDoc, getDocs, onSnapshot,
  query, where, orderBy, limit, writeBatch, serverTimestamp, increment }
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
const fmtDate = k => { const [y, m, d] = k.split("-"); return `${+m}/${+d}(${DAYS[new Date(y, m - 1, d).getDay()]})`; };
const sum = a => a.reduce((s, x) => s + (Number(x.amount) || 0), 0);
// 예전 버전의 'done'은 '확인 대기'로 취급
const stOf = x => !x ? null : (x.status === "done" ? "pending" : x.status);
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
let tasks = [], recs = {}, openRecs = [], paidRecs = [], statsTotal = 0, ledger = [];
let tab = "review", editing = null, payArm = false, camTask = null, armed = null;

/* ---------- 시간 알림 (APK 안에서만 동작) ---------- */
const LN = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.LocalNotifications : null;
let alarmSig = "";
async function scheduleAlarms() {            // 아이 폰: 할 일 시간 알림
  if (!LN) return;
  const items = [];
  tasks.forEach((t, i) => {
    if (!t.alarm || t.hidden) return;
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
const getReviewAlarm = () => { try { return localStorage.getItem("mc-review-alarm") || "09:00"; } catch (e) { return "09:00"; } };
async function scheduleReviewAlarm() {       // 부모 폰: 매일 확인 알림
  if (!LN) return;
  try {
    const p = await LN.requestPermissions(); if (p.display !== "granted") return;
    await LN.cancel({ notifications: [{ id: 9001 }] });
    const [h, m] = getReviewAlarm().split(":").map(Number);
    await LN.schedule({ notifications: [{ id: 9001, title: "📋 어제 미션 확인", body: "확인하고 용돈을 이체해 주세요.",
      schedule: { on: { hour: h, minute: m }, allowWhileIdle: true } }] });
  } catch (e) { console.warn("확인 알림 예약 실패", e); }
}

/* ---------- 공통 ---------- */
function show(id) { for (const s of ["login", "kid", "par"]) $("#" + s).hidden = s !== id; }
function stopAll() { unsubs.forEach(u => u()); unsubs = []; }
let tt;
function toast(b, s) {
  $("#toastB").textContent = b; $("#toastS").textContent = s;
  $("#toast").classList.add("on"); clearTimeout(tt);
  tt = setTimeout(() => $("#toast").classList.remove("on"), 2000);
}
const todayTasks = () => tasks.filter(t => !t.hidden && (t.days || ALL).includes(new Date().getDay()));

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
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && role && dkey() !== curDay) {
    stopAll(); role === "kid" ? startKid() : startParent();
  }
});

/* 지난 사진 정리: 확인이 끝난 기록의 사진만 지움 (확인 대기 사진은 보관) */
async function cleanOldPhotos() {
  try {
    const snap = await getDocs(query(collection(db, "records"), where("hasPhoto", "==", true)));
    const olds = snap.docs.filter(d => { const x = d.data(); return x.date < dkey() && stOf(x) !== "pending"; });
    for (let i = 0; i < olds.length; i += 400) {
      const b = writeBatch(db);
      olds.slice(i, i + 400).forEach(d => b.update(d.ref, { photo: "", hasPhoto: false }));
      await b.commit();
    }
  } catch (e) { console.warn("사진 정리 실패", e); }
}

/* 공통 구독 */
function listenAll(render) {
  curDay = dkey();
  const ym = curDay.slice(0, 7);
  const err = e => console.error(e);
  unsubs.push(onSnapshot(query(collection(db, "tasks"), orderBy("order")), s => {
    tasks = s.docs.map(d => ({ id: d.id, ...d.data() })); render();
  }, err));
  unsubs.push(onSnapshot(query(collection(db, "records"), where("date", "==", curDay)), s => {
    recs = {}; s.docs.forEach(d => { const x = d.data(); recs[x.taskId] = x; }); render();
  }, err));
  unsubs.push(onSnapshot(query(collection(db, "records"), where("status", "in", ["pending", "approved", "done"])), s => {
    openRecs = s.docs.map(d => ({ id: d.id, ...d.data() })); render();
  }, err));
  unsubs.push(onSnapshot(query(collection(db, "records"), where("paidOn", ">=", ym + "-01")), s => {
    paidRecs = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.status === "paid"); render();
  }, err));
  unsubs.push(onSnapshot(doc(db, "stats", "total"), s => {
    statsTotal = s.exists() ? (s.data().paid || 0) : 0; render();
  }, err));
}

/* ---------- 아이 ---------- */
function startKid() { show("kid"); listenAll(renderKid); cleanOldPhotos(); }

function renderKid() {
  const d = new Date(), list = todayTasks();
  $("#kDate").textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAYS[d.getDay()]}요일`;
  const sent = list.filter(t => recs[t.id] && stOf(recs[t.id]) !== "rejected");
  $("#kCnt").textContent = `${sent.length}/${list.length}`;
  $("#kBar").style.width = (list.length ? sent.length / list.length * 100 : 0) + "%";

  // 용돈 요약: 확정 / 확인 대기 / 받은 돈
  const pend = sum(openRecs.filter(x => stOf(x) === "pending"));
  const appr = sum(openRecs.filter(x => x.status === "approved"));
  const paidMonth = sum(paidRecs);
  $("#kSum").innerHTML = `
    <div class="sum-main"><small>💸 지금까지 받은 돈</small><b>${won(statsTotal)}</b><span>이번 달 ${won(paidMonth)}</span></div>
    <div class="sum-row">
      <div class="sum-appr"><small>✅ 확정</small><b>${won(appr)}</b></div>
      <div class="sum-pend"><small>⏳ 확인 대기</small><b>${won(pend)}</b></div>
    </div>
    <p class="note">⏳는 아직 확정이 아니에요. 부모님이 확인하면 ✅, 이체되면 받은 돈에 더해져요.</p>`;

  const next = list.find(t => !recs[t.id] || stOf(recs[t.id]) === "rejected");
  const n = list.length, dd = n <= 3 ? "xl" : n <= 6 ? "m" : n <= 9 ? "s" : "xs", sm = n > 6;
  $("#kGrid").dataset.d = dd; $("#kid").dataset.d = dd;
  $("#kGrid").innerHTML = list.map(t => {
    const x = recs[t.id], st = stOf(x), np = t.needPhoto !== false;
    const cls = { pending: "pend", approved: "appr", paid: "paid", rejected: "rej" }[st] || (t === next ? "next" : "");
    let lab;
    if (st === "pending") lab = sm ? "⏳ 대기" : "⏳ 확인 대기";
    else if (st === "approved") lab = "✅ 확정";
    else if (st === "paid") lab = sm ? "💸 받음" : "💸 받았어요";
    else if (st === "rejected") lab = sm ? "↺ 다시" : "↺ 다시 하기";
    else if (armed === t.id) lab = sm ? "한 번 더!" : "한 번 더 눌러요!";
    else lab = np ? (sm ? "📷 찍기" : "📷 사진 찍기") : (sm ? "👆 완료" : "👆 완료하기");
    const th = x?.photo && st === "pending" ? `<img class="thumb" src="${esc(x.photo)}" alt="">` : "";
    const memo = t.memo && dd !== "xs" ? `<span class="memo">${esc(t.memo)}</span>` : "";
    return `<button class="tile ${cls}" data-id="${esc(t.id)}">${th}<span class="emo">${esc(t.emoji)}</span><span class="nm">${esc(t.name)}</span>${memo}<span class="st">${lab}</span></button>`;
  }).join("");
  $("#kClear").hidden = !(list.length && sent.length === list.length);

  // 날짜별 기록
  const by = {}, add = (x, k) => { (by[x.date] ||= { pending: 0, approved: 0, paid: 0 })[k] += Number(x.amount) || 0; };
  openRecs.forEach(x => add(x, stOf(x))); paidRecs.forEach(x => add(x, "paid"));
  const dates = Object.keys(by).sort().reverse().slice(0, 10);
  $("#kHist").innerHTML = dates.map(k => `<div class="row"><div class="tx"><b>${fmtDate(k)}</b></div><div class="chips">
    ${by[k].pending ? `<span class="tag pend">⏳ ${won(by[k].pending)}</span>` : ""}
    ${by[k].approved ? `<span class="tag ok">✅ ${won(by[k].approved)}</span>` : ""}
    ${by[k].paid ? `<span class="tag paid">💸 ${won(by[k].paid)}</span>` : ""}</div></div>`).join("")
    || '<div class="row"><div class="tx"><span>아직 기록이 없어요.</span></div></div>';
  scheduleAlarms();
}

$("#kGrid").addEventListener("click", e => {
  const b = e.target.closest(".tile"); if (!b) return;
  const id = b.dataset.id, t = tasks.find(x => x.id === id), st = stOf(recs[id]); if (!t) return;
  if (st === "pending") { toast("⏳", "부모님 확인을 기다리는 중이에요"); return; }
  if (st === "approved" || st === "paid") { toast("👍", "이미 확정됐어요!"); return; }
  if (t.needPhoto === false) {                      // 사진 없이 체크: 두 번 눌러 완료
    if (armed !== id) { armed = id; renderKid(); setTimeout(() => { if (armed === id) { armed = null; renderKid(); } }, 3000); return; }
    armed = null; submit(t, ""); return;
  }
  camTask = id; $("#cam").value = ""; $("#cam").click();
});
function submit(t, photo) {
  // 기다리지 않고 전송: 인터넷이 느려도 화면은 바로 바뀌고 자동으로 올라감
  setDoc(doc(db, "records", `${dkey()}_${t.id}`), {
    date: dkey(), taskId: t.id, taskName: t.name, status: "pending", at: hm(),
    amount: Number(t.amount) || 0, photo, hasPhoto: !!photo, kb: Math.round(photo.length * 0.75 / 1024)
  }).catch(err => { console.error(err); toast("😥", "올리지 못했어요. 다시 해 주세요"); });
  toast("올렸어요!", `${t.name} · ${won(t.amount)} 확인 대기 ⏳`);
}
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
  try { submit(t, await compress(f)); } catch (err) { toast("😥", "사진을 못 읽었어요. 다시 찍어 주세요"); }
});

/* ---------- 부모 ---------- */
async function startParent() {
  show("par"); listenAll(renderPar);
  unsubs.push(onSnapshot(query(collection(db, "ledger"), orderBy("at", "desc"), limit(30)), s => {
    ledger = s.docs.map(d => ({ id: d.id, ...d.data() })); if (tab === "money") renderPar();
  }));
  cleanOldPhotos(); scheduleReviewAlarm();
  try {
    const s = await getDocs(collection(db, "tasks"));
    if (s.empty) {
      const b = writeBatch(db);
      DEFAULT_TASKS.forEach((t, i) => b.set(doc(collection(db, "tasks")), { ...t, order: i + 1, needPhoto: true, hidden: false, memo: "" }));
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
  $("#tReview").hidden = tab !== "review"; $("#tTasks").hidden = tab !== "tasks"; $("#tMoney").hidden = tab !== "money";
  ({ review: renderReview, tasks: renderTasks, money: renderMoney })[tab]();
  const n = openRecs.filter(x => stOf(x) === "pending").length;
  document.querySelector('.tabs [data-t="review"]').textContent = n ? `확인 (${n})` : "확인";
}

function ph(x) {
  return x?.photo ? `<img class="ph" src="${esc(x.photo)}" alt="${esc(x.taskName)} 사진">` : `<span class="ph">${x?.hasPhoto === false && x?.photo === "" && x?.kb === 0 ? "✔️" : "📸"}</span>`;
}
function renderReview() {
  const pend = openRecs.filter(x => stOf(x) === "pending"), appr = openRecs.filter(x => x.status === "approved");
  const dates = [...new Set(pend.map(x => x.date))].sort().reverse();
  const apprDates = [...new Set(appr.map(x => x.date))].sort();
  const today = todayTasks();
  $("#tReview").innerHTML = `
    <div class="big"><small>확인할 것</small><b>${pend.length}건 · ${won(sum(pend))}</b></div>
    ${dates.map(k => { const g = pend.filter(x => x.date === k);
      return `<div class="sec"><div class="grp"><b>${fmtDate(k)} · ${g.length}건 · ${won(sum(g))}</b><button class="pill sm solid" data-appr="${k}">전체 승인</button></div>
      <div class="list">${g.map(x => `<div class="row">${ph(x)}<div class="tx"><b>${esc(x.taskName)}</b><span>${esc(x.at)} · ${won(x.amount)}${x.photo ? ` · ${x.kb}KB` : " · 사진 없음"}</span></div><button class="pill sm warn" data-rej="${esc(x.id)}">반려</button></div>`).join("")}</div></div>`; }).join("")
      || '<div class="list"><div class="row"><div class="tx"><span>확인할 항목이 없어요.</span></div></div></div>'}
    <div class="big pay"><small>이체할 금액 (승인 완료)</small><b>${won(sum(appr))}</b>
      <span class="sub">${apprDates.length ? apprDates.map(fmtDate).join(", ") : "승인된 항목이 없어요"}</span>
      <button class="pill" id="pay" ${appr.length ? "" : "disabled"}>${payArm ? "한 번 더 누르면 이체 완료" : "이체 완료로 처리"}</button></div>
    <h3>오늘 진행</h3>
    <div class="list">${today.map(t => { const x = recs[t.id], st = stOf(x);
      const tag = { pending: '<span class="tag pend">확인 대기</span>', approved: '<span class="tag ok">승인</span>', paid: '<span class="tag paid">이체됨</span>', rejected: '<span class="tag no">반려</span>' }[st] || '<span class="tag wait">아직</span>';
      return `<div class="row"><span class="ph">${esc(t.emoji)}</span><div class="tx"><b>${esc(t.name)}</b><span>${won(t.amount)}${x ? " · " + esc(x.at) : ""}</span></div>${tag}</div>`; }).join("")}</div>
    <p class="note">사진은 승인 후 다음 날 자동 삭제됩니다. 기록과 금액은 남습니다.</p>`;
}
$("#tReview").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.appr) {
    const g = openRecs.filter(x => x.date === b.dataset.appr && stOf(x) === "pending");
    const batch = writeBatch(db); g.forEach(x => batch.update(doc(db, "records", x.id), { status: "approved" }));
    batch.commit().catch(err => { console.error(err); toast("😥", "승인하지 못했어요"); }); return;
  }
  if (b.dataset.rej) {
    const x = openRecs.find(y => y.id === b.dataset.rej); if (!x) return;
    const { id, ...data } = x;
    setDoc(doc(db, "records", id), { ...data, status: "rejected", photo: "", hasPhoto: false, kb: 0 })
      .catch(err => { console.error(err); toast("😥", "반려하지 못했어요"); }); return;
  }
  if (b.id === "pay") {
    if (!payArm) { payArm = true; renderReview(); return; }
    payArm = false;
    const list = openRecs.filter(x => x.status === "approved"); if (!list.length) return;
    const amt = sum(list), dates = [...new Set(list.map(x => x.date))].sort();
    const batch = writeBatch(db);
    list.forEach(x => batch.update(doc(db, "records", x.id), { status: "paid", paidOn: dkey() }));
    batch.set(doc(collection(db, "ledger")), { amount: amt, count: list.length, dates, at: serverTimestamp() });
    batch.set(doc(db, "stats", "total"), { paid: increment(amt) }, { merge: true });
    batch.commit().then(() => toast("이체 완료", won(amt))).catch(err => { console.error(err); toast("😥", "처리하지 못했어요"); });
  }
});

function renderTasks() {
  const t = editing;
  $("#tTasks").innerHTML = `
    <div class="list">${tasks.map(x => `<div class="row${x.hidden ? " dim" : ""}"><span class="ph">${esc(x.emoji)}</span><div class="tx"><b>${esc(x.name)}${x.hidden ? ' <span class="tag wait">숨김</span>' : ""}</b><span>${won(x.amount)} · ${x.alarm ? "알림 " + esc(x.alarm) : "알림 없음"} · ${(x.days || ALL).length === 7 ? "매일" : (x.days || []).map(d => DAYS[d]).join("")}${x.needPhoto === false ? " · 사진 없이" : ""}</span></div><button class="pill sm" data-ed="${esc(x.id)}">수정</button></div>`).join("")}</div>
    ${t ? `<div class="ed" id="ed">
      <label>아이콘<div class="emos">${EMOS.map(m => `<button type="button" data-emo="${esc(m)}" aria-pressed="${m === t.emoji}">${m}</button>`).join("")}</div></label>
      <label for="fName">할 일 이름<input id="fName" value="${esc(t.name)}" placeholder="예: 영어 단어 20개"></label>
      <label for="fMemo">아이에게 보이는 메모 (선택)<input id="fMemo" value="${esc(t.memo || "")}" placeholder="예: 밥 먹고 바로!"></label>
      <div class="duo"><label for="fAmt">용돈(원)<input id="fAmt" type="number" inputmode="numeric" step="500" min="0" value="${esc(t.amount)}"></label>
      <label for="fAlarm">알림 시간<input id="fAlarm" type="time" value="${esc(t.alarm || "")}"></label></div>
      <label>요일<div class="days">${DAYS.map((d, i) => `<button type="button" data-day="${i}" aria-pressed="${t.days.includes(i)}">${d}</button>`).join("")}</div></label>
      <div class="switches">
        <button type="button" class="sw" data-sw="needPhoto" aria-pressed="${t.needPhoto !== false}">📷 사진 필요</button>
        <button type="button" class="sw" data-sw="hidden" aria-pressed="${!!t.hidden}">🙈 임시 숨김</button>
      </div>
      <div class="acts">${t.id ? `<button class="pill sm warn" id="fDel">${t.delArm ? "정말 삭제" : "삭제"}</button>` : ""}<button class="pill sm" id="fCancel">취소</button><button class="pill sm solid" id="fSave">저장</button></div>
    </div>` : `<button class="add" id="addT">+ 할 일 추가</button>`}
    <div class="ed"><label for="fReview">부모 확인 알림 시간 (이 폰, 앱에서만 울림)<input id="fReview" type="time" value="${esc(getReviewAlarm())}"></label></div>`;
}
$("#tTasks").addEventListener("change", e => {
  if (e.target.id !== "fReview") return;
  try { localStorage.setItem("mc-review-alarm", e.target.value || "09:00"); } catch (er) { }
  scheduleReviewAlarm(); toast("저장했어요", `매일 ${e.target.value || "09:00"}에 알려요`);
});
$("#tTasks").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  const sync = () => { if (!editing) return; editing.name = $("#fName").value; editing.memo = $("#fMemo").value; editing.amount = +$("#fAmt").value || 0; editing.alarm = $("#fAlarm").value; };
  if (b.id === "addT") { editing = { id: null, emoji: "📖", name: "", memo: "", amount: 2000, alarm: "", days: [...ALL], needPhoto: true, hidden: false }; renderTasks(); $("#fName").focus(); return; }
  if (b.dataset.ed) { const x = tasks.find(y => y.id === b.dataset.ed); editing = { ...x, days: [...(x.days || ALL)] }; renderTasks(); return; }
  if (b.dataset.emo) { sync(); editing.emoji = b.dataset.emo; renderTasks(); return; }
  if (b.dataset.sw) { sync(); const k = b.dataset.sw; editing[k] = k === "needPhoto" ? editing.needPhoto === false : !editing.hidden; renderTasks(); return; }
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
    const { id, delArm, ...data } = editing; data.name = data.name.trim(); data.memo = data.memo.trim();
    data.needPhoto = data.needPhoto !== false; data.hidden = !!data.hidden;
    editing = null; renderTasks();
    const p = id ? setDoc(doc(db, "tasks", id), data, { merge: true })
      : addDoc(collection(db, "tasks"), { ...data, order: Date.now() });
    p.catch(err => { console.error(err); toast("😥", "저장하지 못했어요"); });
  }
});

function renderMoney() {
  const by = {}, add = (x, k) => { (by[x.date] ||= { pending: 0, approved: 0, paid: 0 })[k] += Number(x.amount) || 0; };
  openRecs.forEach(x => add(x, stOf(x))); paidRecs.forEach(x => add(x, "paid"));
  const dates = Object.keys(by).sort().reverse().slice(0, 31);
  const fmtAt = a => { const d = a?.toDate ? a.toDate() : null; return d ? `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm(d)}` : "처리 중"; };
  $("#tMoney").innerHTML = `
    <div class="duo"><div><small>지금까지 이체한 금액</small><b>${won(statsTotal)}</b></div><div><small>이번 달 이체</small><b>${won(sum(paidRecs))}</b></div></div>
    <h3>날짜별 (최근 기록)</h3>
    <div class="list">${dates.map(k => `<div class="row"><div class="tx"><b>${fmtDate(k)}</b></div><div class="chips">
      ${by[k].pending ? `<span class="tag pend">⏳ ${won(by[k].pending)}</span>` : ""}
      ${by[k].approved ? `<span class="tag ok">✅ ${won(by[k].approved)}</span>` : ""}
      ${by[k].paid ? `<span class="tag paid">💸 ${won(by[k].paid)}</span>` : ""}</div></div>`).join("") || '<div class="row"><div class="tx"><span>아직 기록이 없어요.</span></div></div>'}</div>
    ${ledger.length ? `<h3>이체 기록</h3><div class="list">${ledger.map(x => `<div class="row"><div class="tx"><b>${fmtAt(x.at)}</b><span>${x.count || 0}건 · ${(x.dates || []).map(fmtDate).join(", ")}</span></div><b>${won(x.amount)}</b></div>`).join("")}</div>` : ""}`;
}
