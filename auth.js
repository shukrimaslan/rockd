// ─── rockd / auth.js ───────────────────────────────────────────────────────
// Handles: email/password registration, login, Google sign-in, sign-out,
// and creating the user document in Firestore on first sign-in.
// ───────────────────────────────────────────────────────────────────────────

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc, setDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { auth, db, googleProvider } from "./firebase.js";

// ─── Create user doc in Firestore (only on first sign-in) ─────────────────
async function ensureUserDoc(user) {
  const ref  = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid:         user.uid,
      displayName: user.displayName || "",
      email:       user.email,
      avatarUrl:   user.photoURL   || "",
      theme:       "dark",
      fontSize:    "normal",
      accentColor: "#7c6fff",
      createdAt:   serverTimestamp()
    });
  }
}

// ─── Register with email + password ───────────────────────────────────────
export async function registerWithEmail(name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  await ensureUserDoc({ ...cred.user, displayName: name });
  return cred.user;
}

// ─── Sign in with email + password ────────────────────────────────────────
export async function loginWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// ─── Sign in with Google popup ────────────────────────────────────────────
export async function loginWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  await ensureUserDoc(cred.user);
  return cred.user;
}

// ─── Sign out ─────────────────────────────────────────────────────────────
export async function logout() {
  await signOut(auth);
}

// ─── Auth state listener ──────────────────────────────────────────────────
// Calls onUser(user) when signed in, onUser(null) when signed out.
export function listenAuth(onUser) {
  return onAuthStateChanged(auth, onUser);
}

// ─── Friendly error messages ──────────────────────────────────────────────
export function authErrorMessage(code) {
  const map = {
    "auth/email-already-in-use":    "That email is already registered. Try signing in instead.",
    "auth/invalid-email":           "Please enter a valid email address.",
    "auth/weak-password":           "Password must be at least 6 characters.",
    "auth/user-not-found":          "No account found with that email.",
    "auth/wrong-password":          "Incorrect password. Please try again.",
    "auth/too-many-requests":       "Too many attempts. Please wait a moment and try again.",
    "auth/popup-closed-by-user":    "Sign-in popup was closed before completing.",
    "auth/network-request-failed":  "Network error. Check your connection and try again.",
  };
  return map[code] || "Something went wrong. Please try again.";
}
