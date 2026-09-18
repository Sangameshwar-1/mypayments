import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getDatabase, ref, push, set as dbSet, update as dbUpdate, remove as dbRemove, onValue as dbOnValue } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

const DATABASE_ROOT = "mypayments";

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
const dbPath = (relativePath = "") => relativePath ? `${DATABASE_ROOT}/${relativePath}` : DATABASE_ROOT;

function withFirebaseHint(operationName, error) {
  const message = String(error?.message || "");
  const permissionDenied = /permission_denied|permission denied/i.test(message);
  if (!permissionDenied) return error;
  const enhancedError = new Error(
    `${message} Ensure Realtime Database rules are deployed for ${firebaseConfig.databaseURL} and allow authenticated access to /${DATABASE_ROOT}.`
  );
  enhancedError.code = error?.code;
  enhancedError.cause = error;
  enhancedError.operation = operationName;
  return enhancedError;
}

function runAfterAuth(operationName, operation) {
  return authReady.then(() => operation()).catch((error) => {
    throw withFirebaseHint(operationName, error);
  });
}

// Authenticate first. Realtime Database rules can then safely use auth != null.
const authReady = signInAnonymously(auth).then((credential) => {
  console.log("Firebase anonymous auth ready. uid:", credential.user.uid, "database:", firebaseConfig.databaseURL, "root:", DATABASE_ROOT);
  return credential.user;
}).catch((error) => {
  console.error("Firebase anonymous authentication failed. Enable Anonymous sign-in in Firebase Console.", error);
  throw error;
});

// These wrappers prevent any database read/write from happening before auth is ready.
const set = (...args) => runAfterAuth("set", () => dbSet(...args));
const update = (...args) => runAfterAuth("update", () => dbUpdate(...args));
const remove = (...args) => runAfterAuth("remove", () => dbRemove(...args));
const onValue = (query, callback, cancelCallback, options) => {
  let unsubscribe = () => {};
  runAfterAuth("onValue", () => {
    unsubscribe = dbOnValue(query, callback, (error) => {
      const enhancedError = withFirebaseHint("onValue", error);
      console.error("Firebase database listener permission error:", enhancedError);
      if (typeof cancelCallback === "function") cancelCallback(enhancedError);
    }, options);
  }).catch((error) => {
    console.error("Firebase database listener could not start:", error);
  });
  return () => unsubscribe();
};

export { db, auth, authReady, dbPath, ref, push, set, update, remove, onValue };
