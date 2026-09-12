import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getDatabase, ref, push, set, remove, onValue } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

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

export { db, ref, push, set, remove, onValue };
