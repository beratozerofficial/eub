import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/* ------------------ Yardımcılar ------------------ */
const $ = (id) => document.getElementById(id);

const splash = $("splash");
const authScreen = $("auth-screen");
const appScreen = $("app-screen");
const form = $("auth-form");
const inputNo = $("studentNo");
const inputPw = $("password");
const inputPw2 = $("password2");
const confirmWrap = $("confirm-wrap");
const errorBox = $("auth-error");
const submitBtn = $("auth-submit");
const welcomeText = $("welcome-text");

// Kullanıcı adı (öğrenci no) -> Firebase'in istediği e-posta formatına çevrilir.
// Gerçek e-posta DEĞİL, kimseye mail gitmez. Sadece kimlik olarak kullanılıyor.
const EMAIL_DOMAIN = "@eub-ogrenci.app";
const toEmail = (no) => no + EMAIL_DOMAIN;
const fromEmail = (email) => (email || "").replace(EMAIL_DOMAIN, "");

let mode = "login"; // "login" | "register"
let busy = false;

/* ------------------ Firebase başlatma ------------------ */
const configured = !String(firebaseConfig.apiKey).startsWith("BURAYA");
let auth = null;
let db = null;

if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} else {
  $("config-warning").classList.remove("hidden");
  splash.classList.add("hidden");
  authScreen.classList.remove("hidden");
}

/* ------------------ Hata mesajları (Türkçe) ------------------ */
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
    "auth/operation-not-allowed": "Firebase'de 'E-posta/Şifre' girişi açık değil. README'deki 2. adıma bak.",
    "auth/configuration-not-found": "Firebase'de Authentication henüz başlatılmamış. README'deki 2. adıma bak.",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "Firebase API anahtarı yanlış. firebase-config.js dosyasını kontrol et.",
    "auth/invalid-api-key": "Firebase API anahtarı yanlış. firebase-config.js dosyasını kontrol et."
  };
  return map[err && err.code] || "Bir hata oluştu. Lütfen tekrar dene.";
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove("hidden");
}
function clearError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

/* ------------------ Mod değiştirme (Giriş / Kayıt) ------------------ */
function setMode(newMode) {
  mode = newMode;
  const isReg = mode === "register";
  $("btn-mode-login").classList.toggle("active", !isReg);
  $("btn-mode-register").classList.toggle("active", isReg);
  confirmWrap.classList.toggle("hidden", !isReg);
  submitBtn.textContent = isReg ? "Kayıt Ol" : "Giriş Yap";
  inputPw.autocomplete = isReg ? "new-password" : "current-password";
  welcomeText.innerHTML = isReg
    ? "Hoşgeldin EUB'li! 🎓<br />Öğrenci numaranı gir ve kayıt ol bakalım."
    : "Tekrar hoşgeldin EUB'li! 🎓<br />Öğrenci numaranla giriş yap.";
  inputPw2.value = "";
  clearError();
}
$("btn-mode-login").addEventListener("click", () => setMode("login"));
$("btn-mode-register").addEventListener("click", () => setMode("register"));

// Şifre göster / gizle
$("toggle-pw").addEventListener("click", () => {
  const show = inputPw.type === "password";
  inputPw.type = show ? "text" : "password";
  inputPw2.type = show ? "text" : "password";
});

/* ------------------ Form gönderme ------------------ */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  clearError();

  if (!configured) {
    showError("Önce firebase-config.js dosyasını doldurman gerekiyor.");
    return;
  }

  const studentNo = inputNo.value.trim().toLowerCase();
  const password = inputPw.value;

  // Doğrulamalar
  if (!studentNo) return showError("Öğrenci numaranı gir.");
  if (!/^[a-z0-9]{3,20}$/.test(studentNo)) {
    return showError("Öğrenci numarası sadece harf ve rakamdan oluşmalı (3-20 karakter, boşluk olmasın).");
  }
  if (!password) return showError("Şifreni gir.");
  if (password.length < 6) return showError("Şifre en az 6 karakter olmalı.");
  if (mode === "register" && password !== inputPw2.value) {
    return showError("Şifreler birbiriyle aynı değil.");
  }

  busy = true;
  submitBtn.disabled = true;
  const oldText = submitBtn.textContent;
  submitBtn.textContent = "Lütfen bekle...";

  try {
    if (mode === "register") {
      const cred = await createUserWithEmailAndPassword(auth, toEmail(studentNo), password);
      // Profil kaydı (başarısız olsa bile hesap açılmış olur)
      try {
        await setDoc(doc(db, "users", cred.user.uid), {
          studentNo,
          createdAt: serverTimestamp()
        });
      } catch (dbErr) {
        console.warn("Profil kaydı yazılamadı (Firestore kurallarını kontrol et):", dbErr);
      }
    } else {
      await signInWithEmailAndPassword(auth, toEmail(studentNo), password);
    }
    // Ekran geçişini onAuthStateChanged yapar.
  } catch (err) {
    console.error(err);
    showError(errorText(err));
  } finally {
    busy = false;
    submitBtn.disabled = false;
    submitBtn.textContent = mode === "register" ? "Kayıt Ol" : "Giriş Yap";
    void oldText;
  }
});

/* ------------------ Oturum takibi ------------------ */
if (configured) {
  onAuthStateChanged(auth, (user) => {
    splash.classList.add("hidden");
    if (user) {
      const no = fromEmail(user.email);
      $("user-label").textContent = no;
      $("profile-no").textContent = no;
      $("avatar").textContent = no.charAt(0).toUpperCase() || "?";
      authScreen.classList.add("hidden");
      appScreen.classList.remove("hidden");
      switchTab("home");
    } else {
      appScreen.classList.add("hidden");
      authScreen.classList.remove("hidden");
      form.reset();
      setMode("login");
    }
  });
}

/* ------------------ Çıkış ------------------ */
$("logout-btn").addEventListener("click", async () => {
  try { await signOut(auth); } catch (err) { console.error(err); }
});

/* ------------------ Alt menü / Sol menü sekmeleri ------------------ */
function switchTab(name) {
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.id === "tab-" + name));
  window.scrollTo(0, 0);
}
document.querySelectorAll(".nav-btn").forEach((btn) =>
  btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
