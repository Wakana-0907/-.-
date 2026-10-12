import { firebaseConfig } from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const ST = {
  new: { label: "入荷してた", c: "var(--mint)",  w: "var(--mint-wash)" },
  low: { label: "残りわずか", c: "var(--peach)", w: "var(--peach-wash)" },
  out: { label: "売り切れ",   c: "var(--stone)", w: "var(--stone-wash)" },
};
const OLD_DAYS = 7;
const $ = (s) => document.querySelector(s);

/* ---------- 端末ごとの保存 ---------- */
const local = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let me = local.get("gacha-me", null); // {name, word, room}
let wants = local.get("gacha-wants", []);
let posts = [], releases = [];
let filter = "all", relFilter = "all", query = "", busy = false;
let store = null;
let unsubs = [];

/* ---------- 合言葉 → 部屋ID ---------- */
async function roomId(word) {
  const norm = word.normalize("NFKC").trim().toLowerCase();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("gacha-mitayo:" + norm));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/* ---------- ストア：Firebase ---------- */
// coll は "sightings" または "releases"
async function firebaseStore() {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(FB + "firebase-app.js"),
    import(FB + "firebase-auth.js"),
    import(FB + "firebase-firestore.js"),
  ]);
  const app = initializeApp(firebaseConfig);
  const a = auth.getAuth(app);
  const cred = await auth.signInAnonymously(a);
  const db = fs.getFirestore(app);
  const col = (room, coll) => fs.collection(db, "rooms", room, coll);
  return {
    uid: cred.user.uid,
    subscribe(room, coll, cb, onErr) {
      const q = fs.query(col(room, coll), fs.orderBy("at", "desc"), fs.limit(400));
      return fs.onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), onErr);
    },
    add: (room, coll, data) => fs.addDoc(col(room, coll), data),
    update: (room, coll, id, data) => fs.updateDoc(fs.doc(col(room, coll), id), data),
    // ほしい：自分のキーだけを足し引きする（他の人の同時操作を消さない）
    setWant: (room, id, on) =>
      fs.updateDoc(fs.doc(col(room, "releases"), id), new fs.FieldPath("wants", cred.user.uid), on ? me.name : fs.deleteField()),
    remove: (room, coll, id) => fs.deleteDoc(fs.doc(col(room, coll), id)),
  };
}

/* ---------- ストア：デモ（この端末だけ） ---------- */
function demoStore() {
  let uid = local.get("gacha-demo-uid", null);
  if (!uid) { uid = "demo-" + Math.random().toString(36).slice(2, 10); local.set("gacha-demo-uid", uid); }
  const key = (room, coll) => `gacha-demo-${coll}-${room}`;
  const subs = new Set();
  const read = (room, coll) => local.get(key(room, coll), []).sort((x, y) => y.at - x.at);
  const write = (room, coll, list) => { local.set(key(room, coll), list); subs.forEach((s) => s.room === room && s.coll === coll && s.cb(read(room, coll))); };
  return {
    uid,
    subscribe(room, coll, cb) { const s = { room, coll, cb }; subs.add(s); cb(read(room, coll)); return () => subs.delete(s); },
    async add(room, coll, data) { write(room, coll, [...read(room, coll), { id: crypto.randomUUID(), ...data }]); },
    async update(room, coll, id, data) { write(room, coll, read(room, coll).map((p) => (p.id === id ? { ...p, ...data } : p))); },
    async setWant(room, id, on) {
      write(room, "releases", read(room, "releases").map((r) => {
        if (r.id !== id) return r;
        const w = { ...(r.wants || {}) };
        if (on) w[uid] = me.name; else delete w[uid];
        return { ...r, wants: w };
      }));
    },
    async remove(room, coll, id) { write(room, coll, read(room, coll).filter((p) => p.id !== id)); },
  };
}

/* ---------- 共通ヘルパー ---------- */
function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "たった今";
  if (m < 60) return m + "分前";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "時間前";
  const d = Math.floor(h / 24);
  if (d < 30) return d + "日前";
  const dt = new Date(ms);
  return dt.getMonth() + 1 + "/" + dt.getDate();
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(cls, text, onclick) { const b = el("button", cls, text); b.type = "button"; b.onclick = onclick; return b; }
function confirmBtn(onConfirm) {
  const d = btn("mini danger", "消す", () => {
    if (d.dataset.arm !== "1") {
      d.dataset.arm = "1"; d.textContent = "本当に消す？";
      setTimeout(() => { d.dataset.arm = ""; d.textContent = "消す"; }, 4000);
      return;
    }
    onConfirm();
  });
  return d;
}
function capsule(color) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "30"); svg.setAttribute("height", "30"); svg.setAttribute("viewBox", "0 0 30 30");
  svg.setAttribute("class", "cap"); svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<path d="M15 2.5c7 0 12.5 5.4 12.5 12.3h-25C2.5 7.9 8 2.5 15 2.5z" fill="${color}" opacity=".9"/><path d="M2.5 15.2h25C27.5 22.2 22 27.5 15 27.5S2.5 22.2 2.5 15.2z" fill="var(--sheet)" stroke="${color}" stroke-width="1.4"/><path d="M3 15c4-.6 20-.8 24 .2" stroke="var(--ink)" stroke-width="1" fill="none" stroke-linecap="round"/>`;
  return svg;
}
const norm = (s) => (s || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const who = (id, nm) => (id && id === store?.uid ? "あなた" : nm || "だれか");

let flashT = {};
function flash(t, err, target = "#fMsg") {
  const m = $(target);
  m.textContent = t;
  m.classList.toggle("err", !!err);
  clearTimeout(flashT[target]);
  flashT[target] = setTimeout(() => (m.textContent = ""), 5000);
}
function errText(e) {
  const code = e?.code || "";
  if (code.includes("permission-denied")) return "書き込みが許可されませんでした。Firestoreのルール設定を確認してください。";
  if (code.includes("unavailable")) return "通信できませんでした。電波の良いところでもう一度試してください。";
  return "保存できませんでした。もう一度試してください。";
}

/* ---------- 発売時期の計算 ---------- */
// month: "2026-10" / week: 0(月内) 1〜5 / month が空なら未定
function relStart(r) {
  if (!r.month) return null;
  const [y, m] = r.month.split("-").map(Number);
  const day = r.week ? (r.week - 1) * 7 + 1 : 1;
  return new Date(y, m - 1, day);
}
function relLabel(r) {
  if (!r.month) return "発売時期未定";
  const [y, m] = r.month.split("-").map(Number);
  const nowY = new Date().getFullYear();
  const base = (y !== nowY ? y + "年" : "") + m + "月";
  return r.week ? `${base} 第${r.week}週より順次` : `${base}発売`;
}
// 今日から見た区分
function relBucket(r) {
  if (!r.month) return "tbd";
  const now = new Date();
  const [y, m] = r.month.split("-").map(Number);
  const ym = y * 12 + m, nowYm = now.getFullYear() * 12 + now.getMonth() + 1;
  if (ym < nowYm) return "past";
  if (ym > nowYm) return ym === nowYm + 1 ? "next" : "later";
  if (!r.week) return "month";
  const wk = Math.min(5, Math.ceil(now.getDate() / 7));
  if (r.week === wk) return "week";
  if (r.week < wk) return "released"; // 今月すでに発売開始
  return "month";
}
const BUCKETS = [
  ["week", "今週から発売"],
  ["released", "今月発売済み"],
  ["month", "今月発売"],
  ["next", "来月"],
  ["later", "それ以降"],
  ["tbd", "時期未定"],
  ["past", "発売済み"],
];
const iWant = (r) => !!(r.wants && store && r.wants[store.uid]);
const wantedSeries = () => new Set(releases.filter(iWant).map((r) => norm(r.series)));

/* ---------- ほしいものキーワード ---------- */
function drawWants() {
  const box = $("#wantTags");
  box.textContent = "";
  wants.forEach((w, i) => {
    const t = el("span", "tag");
    t.append(el("span", null, w));
    const b = btn(null, "×", () => { wants.splice(i, 1); local.set("gacha-wants", wants); drawWants(); render(); });
    b.setAttribute("aria-label", w + "を外す");
    t.append(b);
    box.append(t);
  });
}
$("#wantIn").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  const v = e.target.value.trim();
  if (!v) return;
  if (!wants.includes(v)) wants.push(v);
  e.target.value = "";
  local.set("gacha-wants", wants);
  drawWants();
  render();
});
function isWantPost(p, ws) {
  if (ws.has(norm(p.series))) return true;
  return wants.some((w) => (p.series + " " + p.shop + " " + (p.area || "")).toLowerCase().includes(w.toLowerCase()));
}

/* ---------- 見かけた：一覧 ---------- */
function fillDatalists() {
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].slice(0, 80);
  const lists = [
    ["#seriesList", uniq([...releases.filter((r) => relBucket(r) !== "past").map((r) => r.series), ...posts.map((p) => p.series)])],
    ["#shopList", uniq(posts.map((p) => p.shop))],
  ];
  for (const [id, vals] of lists) {
    const dl = $(id);
    dl.textContent = "";
    vals.forEach((v) => { const o = document.createElement("option"); o.value = v; dl.append(o); });
  }
}

function renderPosts() {
  const q = query.toLowerCase();
  const ws = wantedSeries();
  const list = posts.filter((p) => {
    if (filter === "want" && !isWantPost(p, ws)) return false;
    if (ST[filter] && p.status !== filter) return false;
    if (q && !(p.series + " " + p.shop + " " + (p.area || "") + " " + (p.note || "")).toLowerCase().includes(q)) return false;
    return true;
  });

  const feed = $("#feed");
  feed.textContent = "";
  $("#empty").hidden = posts.length > 0;
  $("#count").textContent = posts.length ? `${list.length}件を表示中（全${posts.length}件）` : "";
  if (posts.length && !list.length) feed.append(el("li", "sheet empty", "条件に合う投稿はありません"));

  for (const p of list) {
    const s = ST[p.status] || ST.new;
    const last = Math.max(p.at || 0, p.checkedAt || 0);
    const li = el("li", "card");
    li.style.setProperty("--c", s.c);
    li.style.setProperty("--w", s.w);
    const old = Date.now() - last > OLD_DAYS * 864e5;
    if (old) li.classList.add("old");
    const hit = isWantPost(p, ws);
    if (hit) li.classList.add("hit");

    li.append(capsule(s.c));
    const h = el("h3");
    if (hit) h.append(el("span", "star", "★ "));
    h.append(document.createTextNode(p.series));
    li.append(h);
    li.append(el("p", "where", p.shop + (p.area ? "（" + p.area + "）" : "")));
    if (p.note) li.append(el("p", "note", p.note));

    const meta = el("div", "meta");
    meta.append(el("span", "badge", s.label));
    meta.append(el("span", null, `${who(p.by, p.byName)}・${ago(p.at)}`));
    if (p.checkedAt && p.checkedAt > p.at) meta.append(el("span", null, `最終確認 ${ago(p.checkedAt)}（${who(p.checkedBy, p.checkedByName)}）`));
    if (old) meta.append(el("span", null, "1週間以上前の情報"));
    li.append(meta);

    const check = (status) => () =>
      store.update(me.room, "sightings", p.id, { status, checkedAt: Date.now(), checkedBy: store.uid, checkedByName: me.name })
        .catch((e) => flash(errText(e), true));
    const btns = el("div", "cardbtns");
    btns.append(btn("mini", "まだあった", check(p.status === "out" ? "new" : p.status)));
    if (p.status !== "out") btns.append(btn("mini", "売り切れてた", check("out")));
    if (p.by === store.uid) btns.append(confirmBtn(() => store.remove(me.room, "sightings", p.id).catch((e) => flash(errText(e), true))));
    li.append(btns);
    feed.append(li);
  }
}

/* ---------- 発売予定：一覧 ---------- */
function sightingsFor(series) {
  const k = norm(series);
  return posts.filter((p) => norm(p.series) === k);
}

function renderReleases() {
  const box = $("#relList");
  box.textContent = "";
  $("#relEmpty").hidden = releases.length > 0;

  const shown = releases.filter((r) => {
    if (relFilter === "mine" && !iWant(r)) return false;
    if (relFilter !== "past" && relBucket(r) === "past") return false;
    return true;
  });
  if (releases.length && !shown.length) box.append(el("div", "sheet empty", "条件に合う発売予定はありません"));

  // 今週発売の「ほしい」があればタブに印
  $("#relDot").hidden = !releases.some((r) => iWant(r) && relBucket(r) === "week");

  for (const [b, title] of BUCKETS) {
    const items = shown.filter((r) => relBucket(r) === b)
      .sort((x, y) => (relStart(x)?.getTime() ?? Infinity) - (relStart(y)?.getTime() ?? Infinity) || x.series.localeCompare(y.series, "ja"));
    if (!items.length) continue;
    const sec = el("section", "relgroup" + (b === "week" ? " now" : ""));
    sec.append(el("h2", "grouphead", title));
    const ul = el("ul", "list");
    for (const r of items) ul.append(releaseCard(r));
    sec.append(ul);
    box.append(sec);
  }
}

function releaseCard(r) {
  const li = el("li", "card rel");
  const mine = iWant(r);
  if (mine) li.classList.add("hit");
  const color = mine ? "var(--star)" : "var(--sky)";
  li.append(capsule(color));

  const h = el("h3");
  if (mine) h.append(el("span", "heart", "♥ "));
  h.append(document.createTextNode(r.series));
  li.append(h);

  const line = [relLabel(r), r.maker, r.price ? r.price + "円" : ""].filter(Boolean).join("・");
  li.append(el("p", "where", line));

  const meta = el("div", "meta");
  const names = Object.entries(r.wants || {}).map(([id, nm]) => who(id, nm));
  meta.append(el("span", null, names.length ? `ほしい：${names.join("、")}` : "ほしい人はまだいません"));
  meta.append(el("span", null, `登録 ${who(r.by, r.byName)}・${ago(r.at)}`));
  li.append(meta);

  // 見かけた報告の紐づけ
  const seen = sightingsFor(r.series);
  if (seen.length) {
    const latest = seen.reduce((a, b) => (Math.max(a.at, a.checkedAt || 0) >= Math.max(b.at, b.checkedAt || 0) ? a : b));
    const s = ST[latest.status] || ST.new;
    const p = el("p", "seen");
    const badge = el("span", "badge", s.label);
    badge.style.setProperty("--c", s.c);
    badge.style.setProperty("--w", s.w);
    p.append(badge, document.createTextNode(` 見かけた報告 ${seen.length}件・最新は${latest.shop}（${ago(Math.max(latest.at, latest.checkedAt || 0))}）`));
    li.append(p);
  }

  const btns = el("div", "cardbtns");
  const wantBtn = btn("mini" + (mine ? " on" : ""), mine ? "♥ ほしい" : "♡ ほしい", () =>
    store.setWant(me.room, r.id, !mine).catch((e) => flash(errText(e), true, "#rMsg")));
  wantBtn.setAttribute("aria-pressed", mine ? "true" : "false");
  btns.append(wantBtn);
  btns.append(btn("mini", "見かけた！を書く", () => {
    switchTab("see");
    $("#fSeries").value = r.series;
    $("#fShop").focus();
    $("#postSheet").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  if (seen.length) btns.append(btn("mini", `報告を見る（${seen.length}）`, () => {
    switchTab("see");
    $("#q").value = r.series; query = r.series; render();
  }));
  if (/^https?:\/\//.test(r.url || "")) {
    const a = el("a", "mini link", "公式ページ ↗");
    a.href = r.url; a.target = "_blank"; a.rel = "noopener noreferrer";
    btns.append(a);
  }
  if (r.by === store.uid) btns.append(confirmBtn(() => store.remove(me.room, "releases", r.id).catch((e) => flash(errText(e), true, "#rMsg"))));
  li.append(btns);
  return li;
}

function render() { renderPosts(); renderReleases(); }

/* ---------- タブ・絞り込み ---------- */
function switchTab(which) {
  const see = which === "see";
  $("#paneSee").hidden = !see;
  $("#paneRel").hidden = see;
  $("#tabSee").setAttribute("aria-selected", see ? "true" : "false");
  $("#tabRel").setAttribute("aria-selected", see ? "false" : "true");
  local.set("gacha-tab", which);
}
$("#tabSee").onclick = () => switchTab("see");
$("#tabRel").onclick = () => switchTab("rel");

$("#q").addEventListener("input", (e) => { query = e.target.value.trim(); renderPosts(); });
function chipGroup(sel, set) {
  document.querySelectorAll(sel + " .chip").forEach((b) => (b.onclick = () => {
    set(b.dataset.f);
    document.querySelectorAll(sel + " .chip").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    render();
  }));
}
chipGroup("#stFilter", (f) => (filter = f));
chipGroup("#relFilter", (f) => (relFilter = f));

/* ---------- 見かけた：投稿 ---------- */
$("#postForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const series = $("#fSeries").value.trim();
  const shop = $("#fShop").value.trim();
  const area = $("#fArea").value.trim();
  const note = $("#fNote").value.trim();
  const status = document.querySelector("input[name=st]:checked")?.value || "new";
  if (!series) { flash("シリーズ名を入れてください", true); $("#fSeries").focus(); return; }
  if (!shop) { flash("お店・設置場所を入れてください", true); $("#fShop").focus(); return; }
  busy = true;
  $("#fSubmit").disabled = true;
  try {
    await store.add(me.room, "sightings", { series, shop, area, status, note, at: Date.now(), by: store.uid, byName: me.name });
    $("#fSeries").value = ""; $("#fNote").value = ""; $("#stNew").checked = true;
    flash("投稿しました");
  } catch (err) {
    flash(errText(err), true);
  } finally {
    busy = false;
    $("#fSubmit").disabled = false;
  }
});

/* ---------- 発売予定：登録 ---------- */
$("#rUndecided").addEventListener("change", (e) => {
  $("#rMonth").disabled = e.target.checked;
  $("#rWeek").disabled = e.target.checked;
});
$("#relForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const series = $("#rSeries").value.trim();
  const undecided = $("#rUndecided").checked;
  const month = undecided ? "" : $("#rMonth").value;
  const week = undecided ? 0 : Number($("#rWeek").value);
  const maker = $("#rMaker").value.trim();
  const price = $("#rPrice").value.normalize("NFKC").replace(/[^\d]/g, "");
  const url = $("#rUrl").value.trim();
  if (!series) { flash("シリーズ名を入れてください", true, "#rMsg"); $("#rSeries").focus(); return; }
  if (!undecided && !/^\d{4}-\d{2}$/.test(month)) { flash("発売月を選ぶか、「未定」にチェックしてください", true, "#rMsg"); $("#rMonth").focus(); return; }
  if (url && !/^https?:\/\/\S+$/.test(url)) { flash("URLは https:// から始まる形で入れてください", true, "#rMsg"); $("#rUrl").focus(); return; }
  if (releases.some((r) => norm(r.series) === norm(series) && r.month === month)) {
    flash("同じシリーズがもう登録されています", true, "#rMsg"); return;
  }
  busy = true;
  $("#rSubmit").disabled = true;
  try {
    await store.add(me.room, "releases", {
      series, month, week, maker, price, url,
      wants: { [store.uid]: me.name }, at: Date.now(), by: store.uid, byName: me.name,
    });
    ["#rSeries", "#rMaker", "#rPrice", "#rUrl"].forEach((s) => ($(s).value = ""));
    flash("登録しました（あなたの「ほしい」にも入れました）", false, "#rMsg");
  } catch (err) {
    flash(errText(err), true, "#rMsg");
  } finally {
    busy = false;
    $("#rSubmit").disabled = false;
  }
});

/* ---------- 参加・招待 ---------- */
function showJoin() {
  $("#main").hidden = true;
  $("#joinSheet").hidden = false;
  if (me) $("#jName").value = me.name;
  const hashRoom = new URLSearchParams(location.hash.slice(1)).get("g");
  if (hashRoom) $("#jRoom").value = hashRoom;
}
$("#joinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#jName").value.trim();
  const word = $("#jRoom").value.trim();
  if (!name) { flash("ニックネームを入れてください", true, "#jMsg"); return; }
  if (word.length < 4) { flash("合言葉は4文字以上にしてください", true, "#jMsg"); return; }
  me = { name, word, room: await roomId(word) };
  local.set("gacha-me", me);
  history.replaceState(null, "", location.pathname + location.search);
  start();
});
$("#leaveBtn").onclick = () => { unsubs.forEach((u) => u()); unsubs = []; posts = []; releases = []; showJoin(); };
$("#inviteBtn").onclick = async () => {
  const url = location.origin + location.pathname + "#g=" + encodeURIComponent(me.word);
  try { await navigator.clipboard.writeText(url); flash("招待リンクをコピーしました。合言葉が入っているので友達にだけ送ってください。", false, "#footMsg"); }
  catch { flash(url, false, "#footMsg"); }
};

function start() {
  $("#joinSheet").hidden = true;
  $("#main").hidden = false;
  $("#whoami").textContent = `${me.name} さんとして参加中`;
  switchTab(local.get("gacha-tab", "see"));
  unsubs.forEach((u) => u());
  const fail = () => { $("#count").textContent = "読み込めませんでした。ページを開き直してください。"; };
  unsubs = [
    store.subscribe(me.room, "sightings", (list) => { posts = list.filter((p) => p.series && p.shop); fillDatalists(); render(); }, fail),
    store.subscribe(me.room, "releases", (list) => { releases = list.filter((r) => r.series); fillDatalists(); render(); }, fail),
  ];
}

/* ---------- 起動 ---------- */
drawWants();
(async () => {
  const configured = !!(firebaseConfig.apiKey && firebaseConfig.projectId);
  if (configured) {
    try { store = await firebaseStore(); }
    catch (e) {
      console.error(e);
      $("#demoNotice").hidden = false;
      $("#demoNotice").textContent = "Firebaseにつながりませんでした（匿名ログインが有効か確認してください）。いまはデモモードで動いています。";
      store = demoStore();
    }
  } else {
    $("#demoNotice").hidden = false;
    store = demoStore();
  }
  const hashRoom = new URLSearchParams(location.hash.slice(1)).get("g");
  if (me && me.room && me.word && !hashRoom) start(); else showJoin();
  setInterval(render, 60000);
})();
