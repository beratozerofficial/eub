import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, reauthenticateWithCredential, EmailAuthProvider, deleteUser
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, deleteDoc, collection, getDocs, writeBatch,
  query, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/* =====================================================================
   SABİTLER
   ===================================================================== */
const UNIVERSITY = "European University of Berat";

const CATEGORIES = [
  { id: "market", label: "Market", icon: "🛒" },
  { id: "kafe", label: "Kafe", icon: "☕" },
  { id: "okul", label: "Okul Gideri", icon: "🎒" },
  { id: "bakim", label: "Kişisel Bakım Gideri", icon: "🧴" }
];
const catById = (id) => CATEGORIES.find((c) => c.id === id) || { id, label: "Diğer", icon: "💸" };

// Bölüm listesi: burs türüne göre ayrılmadı (tam burs / yarım burs hepsi aynı).
// Kaynaklar: okulun yayınlanmış fakülte listesi ve program bilgileri.
const DEPARTMENT_GROUPS = [
  ["Mühendislik Fakültesi", [
    "Bilgisayar Mühendisliği", "Yazılım Mühendisliği", "Elektrik-Elektronik Mühendisliği",
    "Elektronik ve Haberleşme Mühendisliği", "İnşaat Mühendisliği", "Çevre Mühendisliği"]],
  ["Mimarlık ve Tasarım Fakültesi", [
    "Mimarlık", "İç Mimarlık ve Çevre Tasarımı", "Grafik Tasarım", "Endüstri Ürünleri Tasarımı"]],
  ["Fen-Edebiyat Fakültesi", [
    "Psikoloji", "Mütercim-Tercümanlık", "Moleküler Biyoloji ve Genetik"]],
  ["İletişim Bilimleri Fakültesi", [
    "Dijital Oyun Tasarımı", "Yeni Medya ve İletişim", "Halkla İlişkiler ve Reklamcılık",
    "Görsel İletişim Tasarımı"]],
  ["Ekonomik ve İdari Bilimler Fakültesi", ["Uluslararası İlişkiler"]],
  ["Hukuk Fakültesi", ["Hukuk"]],
  ["Tıp / Diş Hekimliği / Eczacılık", ["Tıp", "Diş Hekimliği", "Eczacılık"]],
  ["Sağlık Bilimleri", ["Hemşirelik", "Fizyoterapi ve Rehabilitasyon", "Beslenme ve Diyetetik"]],
  ["Dr. Fazıl Küçük Eğitim Fakültesi", [
    "Türkçe Öğretmenliği", "Fen Bilgisi Öğretmenliği", "İlköğretim Matematik Öğretmenliği",
    "Sosyal Bilgiler Öğretmenliği", "İngilizce Öğretmenliği", "Özel Eğitim Öğretmenliği"]],
  ["Tarım Bilimleri ve Teknolojileri Fakültesi", ["Bahçe Bitkileri", "Tarım İşletmeciliği"]],
  ["Turizm ve Otelcilik Yüksekokulu", ["Turizm İşletmeciliği", "Gastronomi ve Mutfak Sanatları"]],
  ["Meslek Yüksekokulları (Ön Lisans)", [
    "Aşçılık", "Pastacılık ve Ekmekçilik", "Çocuk Gelişimi", "Tıbbi Görüntüleme Teknikleri",
    "Yaşlı Bakımı", "Engelli Bakımı", "Evde Hasta Bakımı", "Ameliyathane Hizmetleri",
    "Anestezi", "Radyoterapi", "Diyaliz", "Optisyenlik", "Elektronörofizyoloji",
    "Patoloji Laboratuvar Teknikleri", "İlk ve Acil Yardım", "Eczane Hizmetleri", "Sosyal Hizmetler"]],
  ["Diğer", ["Diğer / listede yok"]]
];
const ALL_DEPARTMENTS = new Set(DEPARTMENT_GROUPS.flatMap(([, items]) => items));

const MAX_AMOUNT_KURUS = 100000000 * 100; // 100 milyon TL

/* =====================================================================
   KÜÇÜK YARDIMCILAR
   ===================================================================== */
const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) n.append(kid);
  return n;
}

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 4500);
}

function showMsg(box, msg) { box.textContent = msg; box.classList.remove("hidden"); }
function hideMsg(box) { box.textContent = ""; box.classList.add("hidden"); }

/* ---------- Tarih (hep YEREL saat; toISOString KULLANMIYORUZ) ---------- */
const pad = (n) => String(n).padStart(2, "0");
const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => toStr(new Date());
function parseStr(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseStr(s); d.setDate(d.getDate() + n); return toStr(d); }
function diffDays(a, b) { return Math.round((parseStr(b) - parseStr(a)) / 86400000); } // b - a
function validDateStr(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && toStr(parseStr(s)) === s;
}
const fmtLong = (s) => new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long" }).format(parseStr(s));
const fmtShort = (s) => new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long" }).format(parseStr(s));
const fmtFull = (s) => new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" }).format(parseStr(s));
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

function calcAge(birthStr) {
  const b = parseStr(birthStr), t = new Date();
  let age = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) age--;
  return age;
}
function isBirthdayToday(birthStr) {
  if (!validDateStr(birthStr)) return false;
  const b = parseStr(birthStr), t = new Date();
  let day = b.getDate();
  if (b.getMonth() === 1 && day === 29 && !isLeap(t.getFullYear())) day = 28; // 29 Şubat doğumlular
  return t.getMonth() === b.getMonth() && t.getDate() === day;
}

/* ---------- Para (kuruş = tam sayı, kayan nokta hatası olmasın) ---------- */
const nf = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (kurus) => nf.format(kurus / 100);
const kurusToInput = (k) => (k / 100).toFixed(2).replace(".", ",");
function parseMoney(str) {
  let s = String(str || "").trim().replace(/\s/g, "").replace(/₺|tl/gi, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");           // 1.250,50 -> 1250.50
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");           // 1.250 -> 1250
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100);
}

/* =====================================================================
   FIREBASE
   ===================================================================== */
const EMAIL_DOMAIN = "@eub-ogrenci.app"; // gerçek e-posta değil, sadece kimlik
const toEmail = (no) => no + EMAIL_DOMAIN;
const fromEmail = (email) => (email || "").replace(EMAIL_DOMAIN, "");

const configured = !String(firebaseConfig.apiKey).startsWith("BURAYA");
let auth = null;
let db = null;
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

/* =====================================================================
   DURUM (STATE)
   ===================================================================== */
const state = {
  user: null,
  profile: null,       // { studentNo, department, birthDate, photo, budget:{amountKurus,startDate}, period }
  expenses: [],        // [{id, amountKurus, category, note, date, createdAt}]
  unsub: null,
  editingBudget: false,
  selectedCat: null,
  periodDraft: null    // { startDate, len, endDate }
};

const userRef = () => doc(db, "users", state.user.uid);
const expensesCol = () => collection(db, "users", state.user.uid, "expenses");

function errorText(err) {
  const map = {
    "auth/email-already-in-use": "Bu öğrenci numarası zaten kayıtlı. Giriş Yap sekmesini dene.",
    "auth/invalid-credential": "Öğrenci numarası veya şifre hatalı.",
    "auth/wrong-password": "Öğrenci numarası veya şifre hatalı.",
    "auth/user-not-found": "Öğrenci numarası veya şifre hatalı.",
    "auth/invalid-email": "Öğrenci numarası geçersiz.",
    "auth/weak-password": "Şifre çok zayıf. En az 6 karakter olmalı.",
    "auth/too-many-requests": "Çok fazla deneme yaptın. Biraz bekleyip tekrar dene.",
    "auth/network-request-failed": "İnternet bağlantısı yok gibi görünüyor.",
    "auth/operation-not-allowed": "Firebase'de 'E-posta/Şifre' girişi açık değil. README'ye bak.",
    "auth/configuration-not-found": "Firebase'de Authentication henüz başlatılmamış. README'ye bak.",
    "auth/invalid-api-key": "Firebase API anahtarı yanlış. firebase-config.js dosyasını kontrol et."
  };
  return map[err && err.code] || "Bir hata oluştu. Lütfen tekrar dene.";
}

/* =====================================================================
   GİRİŞ / KAYIT EKRANI
   ===================================================================== */
const splash = $("splash");
const authScreen = $("auth-screen");
const appScreen = $("app-screen");
const form = $("auth-form");
const inputNo = $("studentNo");
const inputPw = $("password");
const inputPw2 = $("password2");
const errorBox = $("auth-error");
const submitBtn = $("auth-submit");
const welcomeText = $("welcome-text");

let mode = "login";
let busy = false;
let regPromise = null;

// Bölüm listesini doldur
(function fillDepartments() {
  const sel = $("department");
  for (const [group, items] of DEPARTMENT_GROUPS) {
    const og = el("optgroup", { label: group });
    for (const it of items) og.append(el("option", { value: it, text: it }));
    sel.append(og);
  }
  // Doğum günü sınırları
  $("birthDate").max = todayStr();
  $("birthDate").min = "1940-01-01";
})();

function setMode(newMode) {
  mode = newMode;
  const isReg = mode === "register";
  $("btn-mode-login").classList.toggle("active", !isReg);
  $("btn-mode-register").classList.toggle("active", isReg);
  document.querySelectorAll(".reg-only").forEach((n) => n.classList.toggle("hidden", !isReg));
  submitBtn.textContent = isReg ? "Kayıt Ol" : "Giriş Yap";
  inputPw.autocomplete = isReg ? "new-password" : "current-password";
  welcomeText.textContent = isReg
    ? `Hoş geldin, ${UNIVERSITY}'lı! 🎓 Öğrenci numaranı gir ve kayıt ol bakalım.`
    : `Tekrar hoş geldin, ${UNIVERSITY}'lı! 🎓 Öğrenci numaranla giriş yap.`;
  inputPw2.value = "";
  hideMsg(errorBox);
}
$("btn-mode-login").addEventListener("click", () => setMode("login"));
$("btn-mode-register").addEventListener("click", () => setMode("register"));

$("toggle-pw").addEventListener("click", () => {
  const show = inputPw.type === "password";
  inputPw.type = show ? "text" : "password";
  inputPw2.type = show ? "text" : "password";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  hideMsg(errorBox);

  if (!configured) return showMsg(errorBox, "Önce firebase-config.js dosyasını doldurman gerekiyor.");

  const studentNo = inputNo.value.trim().toLowerCase();
  const password = inputPw.value;

  if (!studentNo) return showMsg(errorBox, "Öğrenci numaranı gir.");
  if (!/^[a-z0-9]{3,20}$/.test(studentNo)) {
    return showMsg(errorBox, "Öğrenci numarası sadece harf ve rakamdan oluşmalı (3-20 karakter, boşluk olmasın).");
  }
  if (!password) return showMsg(errorBox, "Şifreni gir.");
  if (password.length < 6) return showMsg(errorBox, "Şifre en az 6 karakter olmalı.");

  let department = "", birthDate = "";
  if (mode === "register") {
    department = $("department").value;
    birthDate = $("birthDate").value;
    if (!ALL_DEPARTMENTS.has(department)) return showMsg(errorBox, "Bölümünü seç.");
    if (!validDateStr(birthDate)) return showMsg(errorBox, "Doğum gününü gir.");
    if (birthDate > todayStr() || birthDate < "1940-01-01") return showMsg(errorBox, "Doğum günü geçersiz.");
    if (password !== inputPw2.value) return showMsg(errorBox, "Şifreler birbiriyle aynı değil.");
  }

  busy = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "Lütfen bekle...";
  let profileFailed = false;

  try {
    if (mode === "register") {
      regPromise = (async () => {
        const cred = await createUserWithEmailAndPassword(auth, toEmail(studentNo), password);
        try {
          await setDoc(doc(db, "users", cred.user.uid), {
            studentNo, department, birthDate, createdAt: serverTimestamp()
          });
        } catch (dbErr) {
          console.warn("Profil kaydı yazılamadı:", dbErr);
          profileFailed = true;
        }
      })();
      await regPromise;
    } else {
      await signInWithEmailAndPassword(auth, toEmail(studentNo), password);
    }
    if (profileFailed) toast("Hesap açıldı ama profil bilgileri kaydedilemedi. Firestore kurallarını güncelle (README).");
  } catch (err) {
    console.error(err);
    showMsg(errorBox, errorText(err));
  } finally {
    regPromise = null;
    busy = false;
    submitBtn.disabled = false;
    submitBtn.textContent = mode === "register" ? "Kayıt Ol" : "Giriş Yap";
  }
});

/* =====================================================================
   OTURUM TAKİBİ
   ===================================================================== */
let authRun = 0;

async function loadProfile() {
  const base = { studentNo: fromEmail(state.user.email) };
  try {
    const snap = await getDoc(userRef());
    state.profile = { ...base, ...(snap.exists() ? snap.data() : {}) };
    state.profile.studentNo = base.studentNo;
  } catch (err) {
    console.error(err);
    state.profile = base;
    toast("Profil okunamadı. Firestore kurallarını güncelle (README).");
  }
}

function subscribeExpenses() {
  if (state.unsub) state.unsub();
  const q = query(expensesCol(), orderBy("date", "desc"));
  state.unsub = onSnapshot(q, (snap) => {
    state.expenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((e) => Number.isInteger(e.amountKurus) && validDateStr(e.date));
    renderAll();
  }, (err) => {
    console.error(err);
    toast("Harcamalar okunamadı. Firestore kurallarını güncelle (README).");
  });
}

if (configured) {
  onAuthStateChanged(auth, async (user) => {
    const run = ++authRun;
    if (regPromise) { try { await regPromise; } catch (_) { /* hata submit içinde gösteriliyor */ } }
    if (run !== authRun) return;

    if (user) {
      state.user = user;
      await loadProfile();
      if (run !== authRun) return;
      state.expenses = [];
      state.editingBudget = false;
      state.periodDraft = null;
      subscribeExpenses();
      authScreen.classList.add("hidden");
      appScreen.classList.remove("hidden");
      switchTab("home");
      maybeShowBirthday();
    } else {
      if (state.unsub) { state.unsub(); state.unsub = null; }
      state.user = null; state.profile = null; state.expenses = [];
      appScreen.classList.add("hidden");
      authScreen.classList.remove("hidden");
      closeBirthday();
      resetDeleteUi();
      form.reset();
      setMode("login");
    }
    splash.classList.add("hidden");
  });
} else {
  $("config-warning").classList.remove("hidden");
  splash.classList.add("hidden");
  authScreen.classList.remove("hidden");
  setMode("login");
}

$("logout-btn").addEventListener("click", async () => {
  try { await signOut(auth); } catch (err) { console.error(err); toast("Çıkış yapılamadı."); }
});

/* ---------- HESABI SİL ---------- */
function resetDeleteUi() {
  $("delete-form").classList.add("hidden");
  $("btn-delete-toggle").classList.remove("hidden");
  $("delete-pw").value = "";
  hideMsg($("delete-error"));
}
$("btn-delete-toggle").addEventListener("click", () => {
  $("delete-form").classList.remove("hidden");
  $("btn-delete-toggle").classList.add("hidden");
  $("delete-pw").focus();
});
$("delete-cancel").addEventListener("click", resetDeleteUi);

let deleteBusy = false;
$("delete-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (deleteBusy || !state.user) return;
  const errBox = $("delete-error");
  hideMsg(errBox);

  const pw = $("delete-pw").value;
  if (!pw) return showMsg(errBox, "Doğrulama için şifreni gir.");
  if (!confirm("Hesabın ve tüm verilerin KALICI olarak silinecek. Emin misin?")) return;

  deleteBusy = true;
  const btn = $("delete-submit");
  btn.disabled = true; btn.textContent = "Siliniyor...";
  try {
    // 1) Şifre doğrulaması
    await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(state.user.email, pw));

    // 2) Veriler silinir (kurallar yüzünden hesap silinmeden ÖNCE yapılmalı)
    const uid = state.user.uid;
    if (state.unsub) { state.unsub(); state.unsub = null; }
    const snap = await getDocs(collection(db, "users", uid, "expenses"));
    let batch = writeBatch(db), count = 0;
    for (const d of snap.docs) {
      batch.delete(d.ref);
      if (++count === 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
    }
    batch.delete(doc(db, "users", uid));
    await batch.commit();

    // 3) Hesap (öğrenci numarası) Firebase Authentication'dan silinir
    await deleteUser(auth.currentUser);
    toast("Hesabın silindi. Görüşmek üzere 👋");
  } catch (err) {
    console.error(err);
    if (err && (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential")) {
      showMsg(errBox, "Şifre yanlış.");
    } else if (err && err.code && err.code.startsWith("auth/")) {
      showMsg(errBox, errorText(err));
    } else {
      showMsg(errBox, "Hesap silinemedi. İnternetini kontrol edip tekrar dene.");
    }
    if (auth.currentUser && !state.unsub) subscribeExpenses();
  } finally {
    deleteBusy = false;
    btn.disabled = false; btn.textContent = "Hesabımı Kalıcı Olarak Sil";
  }
});

/* =====================================================================
   SEKMELER
   ===================================================================== */
function switchTab(name) {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + name));
  renderAll();
  window.scrollTo(0, 0);
}
document.querySelectorAll(".nav-btn").forEach((btn) =>
  btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
document.querySelectorAll("[data-goto]").forEach((btn) =>
  btn.addEventListener("click", () => switchTab(btn.dataset.goto)));

/* =====================================================================
   HESAPLAMALAR
   ===================================================================== */
const getBudget = () => {
  const b = state.profile && state.profile.budget;
  return b && Number.isInteger(b.amountKurus) && validDateStr(b.startDate) ? b : null;
};
function activeExpenses() {
  const b = getBudget();
  if (!b) return [];
  const list = state.expenses.filter((e) => e.date >= b.startDate);
  const ms = (e) => (e.createdAt && typeof e.createdAt.toMillis === "function" ? e.createdAt.toMillis() : Date.now());
  return list.sort((x, y) => (x.date === y.date ? ms(y) - ms(x) : x.date < y.date ? 1 : -1));
}
const sumKurus = (list) => list.reduce((s, e) => s + e.amountKurus, 0);
function remainingKurus() {
  const b = getBudget();
  return b ? b.amountKurus - sumKurus(activeExpenses()) : 0;
}
function groupByDate(list) {
  const map = new Map();
  for (const e of list) { if (!map.has(e.date)) map.set(e.date, []); map.get(e.date).push(e); }
  return map; // zaten tarihe göre azalan sıralı
}

function getPeriod() {
  const b = getBudget();
  const p = state.profile && state.profile.period;
  if (p && validDateStr(p.startDate)) {
    if ([7, 14, 30].includes(p.len)) return { startDate: p.startDate, len: p.len };
    if (p.len === "custom" && validDateStr(p.endDate) && diffDays(p.startDate, p.endDate) >= 6) {
      return { startDate: p.startDate, len: "custom", endDate: p.endDate };
    }
  }
  return { startDate: b ? b.startDate : todayStr(), len: 30 };
}
function windowFor(p, today) {
  if (p.len === "custom") {
    const status = today < p.startDate ? "upcoming" : today > p.endDate ? "ended" : "active";
    return { start: p.startDate, end: p.endDate, index: 0, days: diffDays(p.startDate, p.endDate) + 1, status };
  }
  const n = today < p.startDate ? 0 : Math.floor(diffDays(p.startDate, today) / p.len);
  const start = addDays(p.startDate, n * p.len);
  return { start, end: addDays(start, p.len - 1), index: n, days: p.len, status: today < p.startDate ? "upcoming" : "active" };
}
const inRange = (list, a, b) => list.filter((e) => e.date >= a && e.date <= b);

function byCategory(list) {
  const totals = new Map();
  for (const e of list) totals.set(e.category, (totals.get(e.category) || 0) + e.amountKurus);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

/* =====================================================================
   ÇİZİM (RENDER)
   ===================================================================== */
function renderAll() {
  if (!state.profile) return;
  renderHome();
  renderExpenses();
  renderReports();
  renderProfile();
}

/* ---------- ANA SAYFA ---------- */
function renderHome() {
  $("user-label").textContent = state.profile.studentNo;
  const b = getBudget();
  const showForm = !b || state.editingBudget;
  $("budget-form").classList.toggle("hidden", !showForm);
  $("home-remaining").classList.toggle("hidden", showForm || !b);
  $("budget-cancel").classList.toggle("hidden", !b);

  if (b && !showForm) {
    const rem = remainingKurus();
    const box = $("remaining-amount");
    box.textContent = fmtMoney(rem);
    box.classList.toggle("neg", rem < 0);
  }
  if (!b && !$("budget-start").value) $("budget-start").value = todayStr();
  $("budget-title").textContent = b ? "Bütçeni düzenle" : "Toplam kaç TL paran var?";
  $("budget-hint").textContent = b
    ? "Yeni toplam bütçeni gir. Değişiklik için şifreni doğrulaman gerekir."
    : "Bütçeni gir ve şifrenle doğrula. Daha sonra istersen düzeltebilirsin.";
}

$("btn-edit-budget").addEventListener("click", () => {
  const b = getBudget();
  if (!b) return;
  state.editingBudget = true;
  $("budget-amount").value = kurusToInput(b.amountKurus);
  $("budget-start").value = b.startDate;
  $("budget-pw").value = "";
  hideMsg($("budget-error"));
  renderHome();
});
$("budget-cancel").addEventListener("click", () => {
  state.editingBudget = false;
  hideMsg($("budget-error"));
  renderHome();
});

let budgetBusy = false;
$("budget-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (budgetBusy || !state.user) return;
  const errBox = $("budget-error");
  hideMsg(errBox);

  const amountKurus = parseMoney($("budget-amount").value);
  const startDate = $("budget-start").value || todayStr();
  const pw = $("budget-pw").value;

  if (Number.isNaN(amountKurus)) return showMsg(errBox, "Geçerli bir tutar gir (örn: 15000 veya 1250,50).");
  if (amountKurus <= 0) return showMsg(errBox, "Bütçe 0'dan büyük olmalı.");
  if (amountKurus > MAX_AMOUNT_KURUS) return showMsg(errBox, "Bu tutar çok büyük.");
  if (!validDateStr(startDate)) return showMsg(errBox, "Başlangıç tarihi geçersiz.");
  if (startDate < "2020-01-01" || startDate > addDays(todayStr(), 366)) return showMsg(errBox, "Başlangıç tarihi mantıklı bir aralıkta olmalı.");
  if (!pw) return showMsg(errBox, "Doğrulama için şifreni gir.");

  budgetBusy = true;
  const btn = $("budget-submit");
  btn.disabled = true; btn.textContent = "Doğrulanıyor...";
  try {
    const cred = EmailAuthProvider.credential(state.user.email, pw);
    await reauthenticateWithCredential(auth.currentUser, cred);

    const data = { budget: { amountKurus, startDate } };
    if (!state.profile.period) data.period = { startDate, len: 30 };
    await setDoc(userRef(), data, { merge: true });

    state.profile.budget = data.budget;
    if (data.period) state.profile.period = data.period;
    state.editingBudget = false;
    $("budget-pw").value = "";
    $("budget-amount").value = "";
    toast("Bütçe kaydedildi ✅");
    renderAll();
  } catch (err) {
    console.error(err);
    if (err && (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential")) {
      showMsg(errBox, "Şifre yanlış.");
    } else if (err && err.code && err.code.startsWith("auth/")) {
      showMsg(errBox, errorText(err));
    } else {
      showMsg(errBox, "Kaydedilemedi. Firestore kurallarını güncelledin mi? (README)");
    }
  } finally {
    budgetBusy = false;
    btn.disabled = false; btn.textContent = "Doğrula ve Kaydet";
  }
});

/* ---------- HARCAMALAR ---------- */
(function buildCategoryChips() {
  const box = $("cat-chips");
  for (const c of CATEGORIES) {
    box.append(el("button", {
      type: "button", class: "chip", "data-cat": c.id, text: `${c.icon} ${c.label}`,
      onclick: () => { state.selectedCat = c.id; paintCatChips(); }
    }));
  }
})();
function paintCatChips() {
  document.querySelectorAll("#cat-chips .chip").forEach((b) =>
    b.classList.toggle("active", b.dataset.cat === state.selectedCat));
}

function renderExpenses() {
  const b = getBudget();
  $("exp-locked").classList.toggle("hidden", !!b);
  $("exp-form").classList.toggle("hidden", !b);
  const list = $("exp-list");
  list.replaceChildren();
  if (!b) return;

  const today = todayStr();
  const dateInput = $("exp-date");
  dateInput.min = b.startDate;
  dateInput.max = today;
  if (!dateInput.value || dateInput.value > today || dateInput.value < b.startDate) {
    dateInput.value = today >= b.startDate ? today : b.startDate;
  }
  const info = $("exp-info");
  if (b.startDate > today) {
    info.textContent = `Bütçe başlangıç tarihi ${fmtFull(b.startDate)}. O günden itibaren harcama ekleyebilirsin.`;
    info.classList.remove("hidden");
  } else {
    info.classList.add("hidden");
  }
  paintCatChips();

  const items = activeExpenses();
  if (items.length === 0) {
    list.append(el("div", { class: "empty", text: "Henüz harcama eklemedin." }));
    return;
  }
  for (const [date, arr] of groupByDate(items)) {
    const day = el("div", { class: "day" });
    day.append(el("div", { class: "day-head" },
      el("span", { text: fmtLong(date) }),
      el("span", { class: "total", text: fmtMoney(sumKurus(arr)) })));
    for (const e of arr) {
      const c = catById(e.category);
      day.append(el("div", { class: "item" },
        el("span", { class: "ico", text: c.icon }),
        el("div", { class: "mid" },
          el("div", { class: "cat", text: c.label }),
          e.note ? el("div", { class: "note", text: e.note }) : null),
        el("span", { class: "amt", text: fmtMoney(e.amountKurus) }),
        el("button", {
          type: "button", class: "del", "aria-label": "Harcamayı sil", text: "🗑",
          onclick: () => deleteExpense(e.id)
        })));
    }
    list.append(day);
  }
}

async function deleteExpense(id) {
  if (!confirm("Bu harcama silinsin mi?")) return;
  try {
    await deleteDoc(doc(db, "users", state.user.uid, "expenses", id));
    toast("Harcama silindi.");
  } catch (err) {
    console.error(err);
    toast("Silinemedi. Tekrar dene.");
  }
}

let expBusy = false;
$("exp-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (expBusy || !state.user) return;
  const errBox = $("exp-error");
  hideMsg(errBox);

  const b = getBudget();
  if (!b) return showMsg(errBox, "Önce Ana Sayfa'dan bütçeni gir.");

  const amountKurus = parseMoney($("exp-amount").value);
  const date = $("exp-date").value;
  const note = $("exp-note").value.trim().slice(0, 60);
  const today = todayStr();

  if (Number.isNaN(amountKurus)) return showMsg(errBox, "Geçerli bir tutar gir (örn: 85 veya 85,50).");
  if (amountKurus <= 0) return showMsg(errBox, "Tutar 0'dan büyük olmalı.");
  if (amountKurus > MAX_AMOUNT_KURUS) return showMsg(errBox, "Bu tutar çok büyük.");
  if (!state.selectedCat || !CATEGORIES.some((c) => c.id === state.selectedCat)) return showMsg(errBox, "Harcama bölümünü seç.");
  if (!validDateStr(date)) return showMsg(errBox, "Tarihi seç.");
  if (date > today) return showMsg(errBox, "Gelecek bir tarihe harcama eklenemez.");
  if (date < b.startDate) return showMsg(errBox, `Harcama tarihi bütçe başlangıcından (${fmtFull(b.startDate)}) önce olamaz.`);

  expBusy = true;
  const btn = $("exp-submit");
  btn.disabled = true; btn.textContent = "Ekleniyor...";
  try {
    await addDoc(expensesCol(), {
      amountKurus, category: state.selectedCat, note, date, createdAt: serverTimestamp()
    });
    $("exp-amount").value = "";
    $("exp-note").value = "";
    state.selectedCat = null;
    paintCatChips();
    toast("Harcama eklendi ✅");
  } catch (err) {
    console.error(err);
    showMsg(errBox, "Eklenemedi. İnternetini ve Firestore kurallarını kontrol et (README).");
  } finally {
    expBusy = false;
    btn.disabled = false; btn.textContent = "Harcamayı Ekle";
  }
});

/* ---------- RAPORLAR ---------- */
function paintPeriodChips() {
  const d = state.periodDraft;
  document.querySelectorAll("#period-chips .chip").forEach((b) =>
    b.classList.toggle("active", String(d.len) === b.dataset.len));
  $("custom-end-wrap").classList.toggle("hidden", d.len !== "custom");
}

document.querySelectorAll("#period-chips .chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!state.periodDraft) return;
    const len = btn.dataset.len;
    state.periodDraft.len = len === "custom" ? "custom" : Number(len);
    if (len === "custom") {
      const start = state.periodDraft.startDate;
      if (!state.periodDraft.endDate || diffDays(start, state.periodDraft.endDate) < 6) {
        state.periodDraft.endDate = addDays(start, 29);
      }
      $("period-end").min = addDays(start, 6);
      $("period-end").value = state.periodDraft.endDate;
    }
    hideMsg($("period-error"));
    paintPeriodChips();
  });
});
$("period-start").addEventListener("change", (e) => {
  if (!state.periodDraft) return;
  if (validDateStr(e.target.value)) {
    state.periodDraft.startDate = e.target.value;
    $("period-end").min = addDays(e.target.value, 6);
  }
});
$("period-end").addEventListener("change", (e) => {
  if (state.periodDraft) state.periodDraft.endDate = e.target.value;
});

let periodBusy = false;
$("period-save").addEventListener("click", async () => {
  if (periodBusy || !state.periodDraft || !state.user) return;
  const errBox = $("period-error");
  hideMsg(errBox);
  const d = state.periodDraft;

  if (!validDateStr(d.startDate)) return showMsg(errBox, "Dönemin başlangıç gününü seç.");
  let period;
  if (d.len === "custom") {
    if (!validDateStr(d.endDate)) return showMsg(errBox, "Dönemin bitiş gününü seç.");
    if (diffDays(d.startDate, d.endDate) < 6) return showMsg(errBox, "Özel dönem en az 7 gün olmalı.");
    if (diffDays(d.startDate, d.endDate) > 730) return showMsg(errBox, "Dönem en fazla 2 yıl olabilir.");
    period = { startDate: d.startDate, len: "custom", endDate: d.endDate };
  } else if ([7, 14, 30].includes(d.len)) {
    period = { startDate: d.startDate, len: d.len };
  } else {
    return showMsg(errBox, "Dönem uzunluğunu seç.");
  }

  periodBusy = true;
  $("period-save").disabled = true;
  try {
    await setDoc(userRef(), { period }, { merge: true });
    state.profile.period = period;
    state.periodDraft = null;
    toast("Dönem kaydedildi ✅");
    renderAll();
  } catch (err) {
    console.error(err);
    showMsg(errBox, "Kaydedilemedi. Tekrar dene.");
  } finally {
    periodBusy = false;
    $("period-save").disabled = false;
  }
});

function statRow(label, value) {
  return el("div", { class: "stat" }, el("span", { class: "muted", text: label }), el("strong", { text: value }));
}
function barRows(list) {
  const total = sumKurus(list);
  const frag = document.createDocumentFragment();
  for (const [cat, kurus] of byCategory(list)) {
    const c = catById(cat);
    const pct = total > 0 ? Math.round((kurus / total) * 100) : 0;
    frag.append(el("div", { class: "bar-row" },
      el("div", { class: "bar-top" },
        el("span", { text: `${c.icon} ${c.label}` }),
        el("span", { text: `${fmtMoney(kurus)} (%${pct})` })),
      el("div", { class: "bar" }, el("i", { style: `width:${pct}%` }))));
  }
  return frag;
}

function renderReports() {
  const b = getBudget();
  $("rep-locked").classList.toggle("hidden", !!b);
  $("rep-content").classList.toggle("hidden", !b);
  if (!b) return;

  // Dönem formu taslağı (kullanıcı yazarken bozulmasın diye sadece boşsa doldurulur)
  if (!state.periodDraft) {
    const p = getPeriod();
    state.periodDraft = { startDate: p.startDate, len: p.len, endDate: p.endDate || "" };
    $("period-start").value = p.startDate;
    if (p.len === "custom") { $("period-end").min = addDays(p.startDate, 6); $("period-end").value = p.endDate; }
    paintPeriodChips();
  }

  // ---- Dönem özeti ----
  const today = todayStr();
  const p = getPeriod();
  const win = windowFor(p, today);
  const all = activeExpenses();
  const inWin = inRange(all, win.start, win.end);
  const sum = $("period-summary");
  sum.replaceChildren();

  sum.append(el("h3", { text: `${fmtShort(win.start)} – ${fmtFull(win.end)}` }));
  sum.append(el("div", { class: "muted", text: `${win.days} günlük dönem${win.index > 0 ? ` (${win.index + 1}. dönem)` : ""}` }));

  if (win.status === "upcoming") {
    sum.append(el("span", { class: "badge warn", text: `Bu dönem ${fmtFull(win.start)} tarihinde başlayacak` }));
  } else if (win.status === "ended") {
    sum.append(el("span", { class: "badge warn", text: "Bu özel dönem bitti. Yeni bir dönem seçebilirsin." }));
  } else {
    const left = diffDays(today, addDays(win.end, 1));
    sum.append(el("span", { class: "badge", text: `Hesaplamaya ${left} gün kaldı (${fmtFull(addDays(win.end, 1))})` }));
  }

  sum.append(statRow("Dönem harcaması", fmtMoney(sumKurus(inWin))));
  if (win.status !== "upcoming") {
    const lastDay = today < win.end ? today : win.end;
    const elapsed = Math.max(1, diffDays(win.start, lastDay) + 1);
    sum.append(statRow("Günlük ortalama", fmtMoney(Math.round(sumKurus(inWin) / elapsed))));
  }
  if (win.index > 0 && p.len !== "custom") {
    const prevStart = addDays(win.start, -p.len), prevEnd = addDays(win.start, -1);
    sum.append(statRow(`Geçen dönem (${fmtShort(prevStart)} – ${fmtShort(prevEnd)})`, fmtMoney(sumKurus(inRange(all, prevStart, prevEnd)))));
  }
  if (inWin.length > 0) sum.append(barRows(inWin));
  else sum.append(el("div", { class: "empty", text: "Bu dönemde harcama yok." }));

  // ---- Günlük harcamalar ----
  const daily = $("daily-list");
  daily.replaceChildren();
  if (all.length === 0) {
    daily.append(el("div", { class: "empty", text: "Henüz harcama yok." }));
    return;
  }
  let shown = 0;
  for (const [date, arr] of groupByDate(all)) {
    if (++shown > 60) break;
    const day = el("div", { class: "day" });
    day.append(el("div", { class: "day-head" },
      el("span", { text: fmtLong(date) }),
      el("span", { class: "total", text: `${fmtMoney(sumKurus(arr))} · ${arr.length} harcama` })));
    const tags = el("div", { class: "tags", style: "padding-top:10px" });
    for (const [cat, kurus] of byCategory(arr)) {
      const c = catById(cat);
      tags.append(el("span", { class: "tag", text: `${c.icon} ${c.label}: ${fmtMoney(kurus)}` }));
    }
    day.append(tags);
    daily.append(day);
  }
}

/* ---------- PROFİL ---------- */
function safePhoto(p) {
  return typeof p === "string" && p.startsWith("data:image/jpeg;base64,") && p.length < 400000 ? p : null;
}
function renderProfile() {
  const p = state.profile;
  $("profile-no").textContent = p.studentNo;
  $("profile-dept").textContent = p.department || "-";
  if (validDateStr(p.birthDate)) {
    $("profile-birth").textContent = fmtFull(p.birthDate);
    const age = calcAge(p.birthDate);
    $("profile-age").textContent = age >= 0 ? String(age) : "-";
  } else {
    $("profile-birth").textContent = "-";
    $("profile-age").textContent = "-";
  }
  const img = $("avatar-img"), letter = $("avatar-letter");
  const photo = safePhoto(p.photo);
  letter.textContent = (p.studentNo || "?").charAt(0).toUpperCase();
  if (photo) { img.src = photo; img.classList.remove("hidden"); letter.classList.add("hidden"); }
  else { img.removeAttribute("src"); img.classList.add("hidden"); letter.classList.remove("hidden"); }
}

$("photo-btn").addEventListener("click", () => $("photo-input").click());
$("photo-input").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file || !state.user) return;
  if (!file.type.startsWith("image/")) return toast("Lütfen bir fotoğraf seç.");
  if (file.size > 15 * 1024 * 1024) return toast("Fotoğraf çok büyük (en fazla 15 MB).");

  try {
    const dataUrl = await resizeToSquare(file, 256);
    if (dataUrl.length > 300000) return toast("Fotoğraf işlenemedi, başka bir fotoğraf dene.");
    await setDoc(userRef(), { photo: dataUrl }, { merge: true });
    state.profile.photo = dataUrl;
    renderProfile();
    toast("Profil fotoğrafı güncellendi ✅");
  } catch (err) {
    console.error(err);
    toast("Fotoğraf kaydedilemedi. Tekrar dene.");
  }
});

function resizeToSquare(file, size) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const s = Math.min(img.width, img.height);
        const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      } catch (err) { reject(err); }
      finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Fotoğraf okunamadı")); };
    img.src = url;
  });
}

/* =====================================================================
   DOĞUM GÜNÜ
   ===================================================================== */
let confettiRaf = null;

function maybeShowBirthday() {
  const p = state.profile;
  if (!p || !isBirthdayToday(p.birthDate)) return;
  const key = "bday-" + state.user.uid + "-" + todayStr();
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch (_) { /* sorun değil */ }
  const age = calcAge(p.birthDate);
  $("bday-name").textContent = `${p.studentNo} • ${age} yaşına girdin! 🥳`;
  $("bday").classList.remove("hidden");
  startConfetti();
}
function closeBirthday() {
  $("bday").classList.add("hidden");
  if (confettiRaf) { cancelAnimationFrame(confettiRaf); confettiRaf = null; }
}
$("bday-close").addEventListener("click", closeBirthday);

function startConfetti() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = $("confetti");
  const ctx = canvas.getContext("2d");
  const colors = ["#0b57d0", "#4285f4", "#f2b705", "#ea4335", "#34a853", "#ffffff", "#ff7bac"];
  const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
  resize();
  window.addEventListener("resize", resize);

  const make = (fromTop) => ({
    x: Math.random() * canvas.width,
    y: fromTop ? -20 : Math.random() * canvas.height,
    w: 6 + Math.random() * 8, h: 8 + Math.random() * 10,
    vy: 2 + Math.random() * 3.5, vx: -1 + Math.random() * 2,
    rot: Math.random() * Math.PI, vr: -0.1 + Math.random() * 0.2,
    color: colors[Math.floor(Math.random() * colors.length)]
  });
  const parts = Array.from({ length: 150 }, () => make(false));

  const tick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      if (p.y > canvas.height + 20) Object.assign(p, make(true));
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    confettiRaf = requestAnimationFrame(tick);
  };
  tick();
}
