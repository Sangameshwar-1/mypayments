import { db, ref, push, set, remove, onValue } from "./firebase.js";

let people = {};
let transactions = {};

const peopleRef = ref(db, "mypayments/people");
const transactionsRef = ref(db, "mypayments/transactions");

window.addPerson = async function () {
  const input = document.getElementById("personName");
  const name = input.value.trim();
  if (!name) return alert("Enter a name");

  await set(push(peopleRef), { name, createdAt: Date.now() });
  input.value = "";
};

onValue(peopleRef, (snapshot) => {
  people = snapshot.val() || {};
  updatePersonDropdowns();
  displayPeople();
  updateDashboard();
});

onValue(transactionsRef, (snapshot) => {
  transactions = snapshot.val() || {};
  displayTransactions();
  displayPeople();
  updateDashboard();
});

function transactionTotal(transaction) {
  return (Number(transaction.amount) || 0) + (Number(transaction.charge) || 0);
}

function displayPeople() {
  const container = document.getElementById("peopleList");
  container.innerHTML = "";
  const ids = Object.keys(people);

  if (!ids.length) {
    container.innerHTML = "<p>No people added yet.</p>";
    return;
  }

  ids.forEach((id) => {
    const balance = getPersonBalance(id);
    const div = document.createElement("div");
    div.className = "person";
    div.innerHTML = `
      <div class="person-name">${escapeHtml(people[id].name)}</div>
      <div class="balance ${balance >= 0 ? "positive" : "negative"}">₹${formatMoney(balance)}</div>
    `;
    container.appendChild(div);
  });
}

function updatePersonDropdowns() {
  const transactionPerson = document.getElementById("transactionPerson");
  const filterPerson = document.getElementById("filterPerson");
  const selectedFilter = filterPerson.value;

  transactionPerson.innerHTML = '<option value="">Select person</option>';
  filterPerson.innerHTML = '<option value="all">All people</option>';

  Object.entries(people).forEach(([id, person]) => {
    const option1 = document.createElement("option");
    option1.value = id;
    option1.textContent = person.name;
    transactionPerson.appendChild(option1);

    const option2 = document.createElement("option");
    option2.value = id;
    option2.textContent = person.name;
    filterPerson.appendChild(option2);
  });

  if (selectedFilter === "all" || people[selectedFilter]) filterPerson.value = selectedFilter;
}

document.getElementById("transactionForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const personId = document.getElementById("transactionPerson").value;
  const date = document.getElementById("transactionDate").value;
  const type = document.getElementById("transactionType").value;
  const amount = Number(document.getElementById("amount").value);
  const charge = Number(document.getElementById("charge").value) || 0;
  const method = document.getElementById("method").value;
  const description = document.getElementById("description").value.trim();

  if (!personId) return alert("Select a person");
  if (!date) return alert("Select a date");
  if (!amount || amount <= 0) return alert("Enter a valid amount");
  if (charge < 0) return alert("Charge cannot be negative");

  await set(push(transactionsRef), {
    personId, date, type, amount, charge, method, description, createdAt: Date.now()
  });

  document.getElementById("transactionForm").reset();
  setToday();
});

function displayTransactions() {
  const container = document.getElementById("transactionsList");
  const filter = document.getElementById("filterPerson").value;
  container.innerHTML = "";

  let list = Object.entries(transactions);
  if (filter !== "all") list = list.filter(([, t]) => t.personId === filter);

  list.sort((a, b) => {
    const dateDiff = new Date(b[1].date) - new Date(a[1].date);
    return dateDiff || ((b[1].createdAt || 0) - (a[1].createdAt || 0));
  });

  if (!list.length) {
    container.innerHTML = "<p>No transactions found.</p>";
    return;
  }

  list.forEach(([id, transaction]) => {
    const personName = people[transaction.personId]?.name || "Unknown";
    const total = transactionTotal(transaction);
    const sign = transaction.type === "taken" ? "+" : "-";
    const div = document.createElement("div");
    div.className = "transaction";

    div.innerHTML = `
      <div class="transaction-info">
        <div class="transaction-date">${escapeHtml(transaction.date || "")}</div>
        <div class="transaction-description">${escapeHtml(transaction.description || transaction.method || transaction.type)}</div>
        <div class="transaction-meta">
          ${escapeHtml(personName)} • ${escapeHtml(transaction.method || "Other")}
          ${transaction.charge > 0 ? ` • Charge ₹${formatMoney(transaction.charge)}` : ""}
        </div>
      </div>
      <div class="transaction-amount ${transaction.type}">${sign}₹${formatMoney(total)}</div>
      <button class="delete-btn" onclick="deleteTransaction('${id}')">Delete</button>
    `;
    container.appendChild(div);
  });
}

window.deleteTransaction = async function (id) {
  if (!confirm("Delete this transaction?")) return;
  await remove(ref(db, `mypayments/transactions/${id}`));
};

function getPersonBalance(personId) {
  return Object.values(transactions).reduce((balance, transaction) => {
    if (transaction.personId !== personId) return balance;
    const total = transactionTotal(transaction);
    return balance + (transaction.type === "taken" ? total : -total);
  }, 0);
}

function updateDashboard() {
  let totalTaken = 0;
  let totalRepaid = 0;

  Object.values(transactions).forEach((transaction) => {
    const total = transactionTotal(transaction);
    if (transaction.type === "taken") totalTaken += total;
    else totalRepaid += total;
  });

  document.getElementById("totalTaken").textContent = `₹${formatMoney(totalTaken)}`;
  document.getElementById("totalRepaid").textContent = `₹${formatMoney(totalRepaid)}`;
  document.getElementById("totalOutstanding").textContent = `₹${formatMoney(totalTaken - totalRepaid)}`;
}

document.getElementById("filterPerson").addEventListener("change", displayTransactions);

document.getElementById("transactionType").addEventListener("change", () => {
  const label = document.querySelector('label[for="charge"]');
  if (label) label.textContent = document.getElementById("transactionType").value === "taken" ? "Charge" : "Charge / Repayment fee";
});

function formatMoney(number) {
  return Number(number).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text ?? "");
  return div.innerHTML;
}

function setToday() {
  document.getElementById("transactionDate").value = new Date().toISOString().split("T")[0];
}

setToday();
