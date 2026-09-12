import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getDatabase, ref, push, set, update, remove, onValue } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAHt06CtReHyQRip-QqEGILFjOWH5cI98c",
  authDomain: "blood-7b054.firebaseapp.com",
  databaseURL: "https://blood-7b054-default-rtdb.firebaseio.com",
  projectId: "blood-7b054",
  storageBucket: "blood-7b054.firebasestorage.app",
  messagingSenderId: "926378767902",
  appId: "1:926378767902:web:21591c4e5d77c90c9ca00f",
  measurementId: "G-HTGC1SJYH6"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// Authenticate before any Realtime Database read/write.
const authReady = signInAnonymously(auth).then((credential) => {
  console.log("Firebase anonymous auth ready. uid:", credential.user.uid);
  return credential.user;
}).catch((error) => {
  console.error("Firebase anonymous authentication failed:", error);
  throw error;
});

export { db, auth, authReady, ref, push, set, update, remove, onValue };
