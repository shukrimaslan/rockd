// ─── rockd / firebase.js ───────────────────────────────────────────────────
// Replace the firebaseConfig values below with your own from the Firebase
// console (Project settings → Your apps → SDK setup and configuration).
// Never commit real keys to a public repo — use environment variables in prod.
// ───────────────────────────────────────────────────────────────────────────

import { initializeApp }                          from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider }            from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─── YOUR CONFIG ────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyB-_zPiLh7hLRu0d5CvaHOcLr8z4l9WS0U",
  authDomain: "rockd-app.firebaseapp.com",
  projectId: "rockd-app",
  storageBucket: "rockd-app.firebasestorage.app",
  messagingSenderId: "984029011955",
  appId: "1:984029011955:web:59d569b4a82fa8da333c86",
  measurementId: "G-686RQRLYMN"
};
// ────────────────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);

export const auth           = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Modern offline persistence — works across multiple tabs
export const db = initializeFirestore(app, {
  cache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});
