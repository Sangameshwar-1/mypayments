import { db, ref, remove, onValue } from "./firebase.js";

const personId = new URLSearchParams(window.location.search).get("id");
const peopleRef = ref(db, "mypayments/people");
const transactionsRef = ref(db, "mypayments/transactions");

let person = null;
let transactions = {};

function formatMoney(number) {
  return Number(number).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text ?? "");
  return div.innerHTML;
}

function transactionTotal(t) {
  return (Number(t.amount) || 0) + (Number(t.charge) || 0);
}

function render() {
  const title = document.getElementById("personTitle");
  const container = document.getElementById("detailTransactions");

  if (!personId || !person) {
    title.textContent = "Person not found";
    container.innerHTML = "<p>This person does not exist.</p>";
    return;
  }

  title.textContent = person.name;

  const personTransactions = Object.entries(transactions)
    .filter(([, t]) => t.personId === personId)
    .sort((a, b) => new Date(b[1].date) - new Date(a[1].date) || (b[1].createdAt || 0) - (a[1].createdAt || 0));

  let received = 0;
  let repaid = 0;
  personTransactions.forEach(([, t]) => {
    if (t.type === "taken") received += transactionTotal(t);
    else repaid += transactionTotal(t);
  });

  document.getElementById("detailReceived").textContent = `₹${formatMoney(received)}`;
  document.getElementById("detailRepaid").textContent = `₹${formatMoney(repaid)}`;
  document.getElementById("detailBalance").textContent = `₹${formatMoney(received - repaid)}`;

  container.innerHTML = "";
  if (!personTransactions.length) {
    container.innerHTML = "<p>No transactions for this person.</p>";
    return;
  }

  personTransactions.forEach(([id, t]) => {
    const receivedType = t.type === "taken";
    const total = transactionTotal(t);
    const chargeText = Number(t.charge) > 0 ? ` • Charge ₹${formatMoney(t.charge)}` : "";
    const row = document.createElement("div");
    row.className = `transaction ${receivedType ? "received-row" : "repaid-row"}`;
    row.innerHTML = `
      <div class="transaction-info">
        <div class="transaction-date">${escapeHtml(t.date || "")}</div>
        <div class="transaction-description">${escapeHtml(t.description || t.method || (receivedType ? "Received" : "Repaid"))}</div>
        <div class="transaction-meta">${escapeHtml(t.method || "Other")}${chargeText}</div>
      </div>
      <div class="transaction-amount ${receivedType ? "taken-text" : "repaid-text"}">${receivedType ? "+" : "-"}₹${formatMoney(total)}</div>
      <button class="delete-btn" onclick="deleteDetailTransaction('${id}')">Delete</button>
    `;
    container.appendChild(row);
  });
}

window.deleteDetailTransaction = async function (id) {
  if (!confirm("Delete this transaction?")) return;
  await remove(ref(db, `mypayments/transactions/${id}`));
};

document.getElementById("backBtn").addEventListener("click", () => history.back());

onValue(peopleRef, (snapshot) => {
  const people = snapshot.val() || {};
  person = people[personId] || null;
  render();
});

onValue(transactionsRef, (snapshot) => {
  transactions = snapshot.val() || {};
  render();
});
