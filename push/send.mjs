// 5분마다 GitHub Actions에서 실행: 알림 시간이 된(최근 90분 이내) 할 일 중 아직 안 한 것을 아이 폰에 웹 푸시로 보냄
import admin from "firebase-admin";

const SA = process.env.FIREBASE_SA;
if (!SA) { console.log("FIREBASE_SA 비밀값이 없어 건너뜀"); process.exit(0); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA)) });
const db = admin.firestore(), fcm = admin.messaging();
const URL = "https://kfcccpro-ship-it.github.io/house_kdh/";
const WINDOW = 90; // 분: Actions 지연을 고려해 이 시간 안이면 보냄

const k = new Date(Date.now() + 9 * 3600e3);            // 한국 시간
const date = k.toISOString().slice(0, 10), wd = k.getUTCDay(), nowMin = k.getUTCHours() * 60 + k.getUTCMinutes();

const tasks = (await db.collection("tasks").get()).docs.map(d => ({ id: d.id, ...d.data() }));
const due = tasks.filter(t => {
  if (!t.alarm || t.hidden || !(t.days || [0, 1, 2, 3, 4, 5, 6]).includes(wd)) return false;
  const [h, m] = t.alarm.split(":").map(Number), diff = nowMin - (h * 60 + m);
  return diff >= 0 && diff <= WINDOW;
});
console.log(date, `${Math.floor(nowMin / 60)}:${nowMin % 60}`, "대상", due.map(t => t.name));
if (!due.length) process.exit(0);

const done = new Set((await db.collection("records").where("date", "==", date).get()).docs
  .map(d => d.data()).filter(r => r.status !== "rejected").map(r => r.taskId));
const tokens = (await db.collection("push").where("role", "==", "kid").get()).docs.map(d => d.id);
if (!tokens.length) { console.log("등록된 아이 기기 없음"); process.exit(0); }

for (const t of due) {
  const log = db.doc(`pushLog/${date}_${t.id}`);
  if (done.has(t.id) || (await log.get()).exists) continue;
  const r = await fcm.sendEachForMulticast({
    tokens,
    webpush: {
      notification: { title: `${t.emoji || "⏰"} ${t.name}`, body: t.memo ? `${t.memo} · 사진 찍을 시간이에요!` : "사진 찍을 시간이에요!", icon: URL + "icon-192.png", tag: t.id },
      fcmOptions: { link: URL }
    }
  });
  console.log(t.name, "성공", r.successCount, "실패", r.failureCount);
  await Promise.all(r.responses.map((x, i) => !x.success && /not-registered|invalid-(argument|registration)/.test(x.error?.code || "")
    ? db.doc(`push/${tokens[i]}`).delete() : null));
  await log.set({ at: admin.firestore.FieldValue.serverTimestamp(), sent: r.successCount });
}
process.exit(0);
