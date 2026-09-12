import { db, ref, push, set, remove, onValue } from "./firebase.js";

let people = {};
let transactions = {};

const peopleRef = ref(db, "mypayments/people");
const transactionsRef = ref(db, "mypayments/transactions");

function chargeTotal(charges = []) {
  return charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
}

function transactionTotal(t) {
  if (Array.isArray(t.charges)) return (Number(t.amount) || 0) + chargeTotal(t.charges);
  return (Number(t.amount) || 0) + (Number(t.charge) || 0); // old data compatibility
}

function personTotals(personId) {
  return Object.values(transactions).reduce((totals, t) => {
    if (t.personId !== personId) return totals;
    const total = transactionTotal(t);
    if (t.type === "taken") totals.received += total;
    else totals.repaid += total;
    return totals;
  }, { received: 0, repaid: 0 });
}

function getChargesFromForm() {
  return [...document.querySelectorAll(".charge-row")].map((row) => ({
    amount: Number(row.querySelector(".charge-amount").value) || 0,
    comment: row.querySelector(".charge-comment").value.trim()
  })).filter((c) => c.amount > 0);
}

function calculatePreview() {
  const amount = Number(document.getElementById("amount").value) || 0;
  const charges = getChargesFromForm();
  const chargesTotal = chargeTotal(charges);
  document.getElementById("chargePreview").textContent =
    `Charges: ₹${formatMoney(chargesTotal)} • Total: ₹${formatMoney(amount + chargesTotal)}`;
  document.getElementById("noCharges").style.display = charges.length ? "none" : "block";
}

function addChargeRow(amount = "", comment = "") {
  const row = document.createElement("div");
  row.className = "charge-row";
  row.innerHTML = `
    <input class="charge-amount" type="number" min="0" step="0.01" value="${amount}" placeholder="Charge amount">
    <input class="charge-comment" type="text" value="${escapeHtml(comment)}" placeholder="Why? e.g. extra 1.18% charge">
    <button type="button" class="remove-charge" aria-label="Remove charge">×</button>
  `;
  row.querySelectorAll("input").forEach((input) => input.addEventListener("input", calculatePreview));
  row.querySelector(".remove-charge").addEventListener("click", () => { row.remove(); calculatePreview(); });
  document.getElementById("chargesList").appendChild(row);
  calculatePreview();
}

window.addPerson = async function () {
  const input = document.getElementById("personName");
  const name = input.value.trim();
  if (!name) return alert("Enter a name");
  await set(push(peopleRef), { name, createdAt: Date.now() });
  input.value = "";
};

document.getElementById("addPersonBtn").addEventListener("click", window.addPerson);
document.getElementById("addChargeBtn").addEventListener("click", () => addChargeRow());
document.getElementById("amount").addEventListener("input", calculatePreview);

onValue(peopleRef, (snapshot) => {
  people = snapshot.val() || {};
  updatePersonDropdowns();
  renderLedger();
  updateDashboard();
});

onValue(transactionsRef, (snapshot) => {
  transactions = snapshot.val() || {};
  renderLedger();
  updateDashboard();
});

document.getElementById("transactionForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const personId = document.getElementById("transactionPerson").value;
  const date = document.getElementById("transactionDate").value;
  const type = document.getElementById("transactionType").value;
  const amount = Number(document.getElementById("amount").value);
  const method = document.getElementById("method").value;
  const purpose = document.getElementById("purpose").value.trim();
  const amountComment = document.getElementById("amountComment").value.trim();
  const description = document.getElementById("description").value.trim();
  const charges = getChargesFromForm();

  if (!personId) return alert("Select a person");
  if (!date) return alert("Select a date");
  if (!amount || amount <= 0) return alert("Enter a valid amount");

  await set(push(transactionsRef), {
    personId,
    date,
    type,
    amount,
    amountComment,
    charges,
    method,
    purpose,
    description,
    createdAt: Date.now()
  });

  event.target.reset();
  document.getElementById("chargesList").innerHTML = "";
  calculatePreview();
  setToday();
});

function updatePersonDropdowns() {
  const transactionPerson = document.getElementById("transactionPerson");
  const filterPerson = document.getElementById("filterPerson");
  const selected = filterPerson.value || "all";

  transactionPerson.innerHTML = '<option value="">Select person</option>';
  filterPerson.innerHTML = '<option value="all">All people</option>';

  Object.entries(people).forEach(([id, person]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = person.name;
    transactionPerson.appendChild(option);

    const filterOption = document.createElement("option");
    filterOption.value = id;
    filterOption.textContent = person.name;
    filterPerson.appendChild(filterOption);
  });

  if (selected === "all" || people[selected]) filterPerson.value = selected;
}

function renderLedger() {
  displayPeople();
  displayTransactions();
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
    const totals = personTotals(id);
    const balance = totals.received - totals.repaid;
    const div = document.createElement("div");
    div.className = "person";
    div.tabIndex = 0;
    div.setAttribute("role", "button");
    div.innerHTML = `
      <div><div class="person-name">${escapeHtml(people[id].name)}</div>
        <div class="person-summary"><span class="taken-text">Received ₹${formatMoney(totals.received)}</span><span class="repaid-text">Repaid ₹${formatMoney(totals.repaid)}</span></div>
      </div><div class="balance ${balance >= 0 ? "positive" : "negative"}">₹${formatMoney(balance)}</div>`;
    const openPerson = () => { window.location.href = `person.html?id=${encodeURIComponent(id)}`; };
    div.addEventListener("click", openPerson);
    div.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPerson(); } });
    container.appendChild(div);
  });
}

function displayTransactions() {
  const container = document.getElementById("transactionsList");
  const filter = document.getElementById("filterPerson").value;
  container.innerHTML = "";
  const peopleToShow = filter === "all" ? Object.keys(people) : [filter];
  const activePeople = peopleToShow.filter((id) => people[id]);
  if (!activePeople.length) { container.innerHTML = "<p>No people added yet.</p>"; return; }

  activePeople.forEach((personId) => {
    const personTransactions = Object.entries(transactions)
      .filter(([, t]) => t.personId === personId)
      .sort((a, b) => new Date(b[1].date) - new Date(a[1].date) || (b[1].createdAt || 0) - (a[1].createdAt || 0));
    const totals = personTotals(personId);
    const balance = totals.received - totals.repaid;
    const section = document.createElement("div");
    section.className = "person-ledger";
    section.innerHTML = `<div class="ledger-header"><div><h3>${escapeHtml(people[personId].name)}</h3><span class="ledger-balance">Balance: ₹${formatMoney(balance)}</span></div><div class="ledger-totals"><span class="taken-text">+₹${formatMoney(totals.received)}</span><span class="repaid-text">-₹${formatMoney(totals.repaid)}</span></div></div><div class="ledger-transactions"></div>`;
    const list = section.querySelector(".ledger-transactions");
    if (!personTransactions.length) list.innerHTML = "<p class='empty'>No transactions for this person.</p>";
    else personTransactions.forEach(([id, t]) => list.appendChild(createTransactionRow(id, t)));
    container.appendChild(section);
  });
}

function createTransactionRow(id, t) {
  const total = transactionTotal(t);
  const received = t.type === "taken";
  const charges = Array.isArray(t.charges) ? t.charges : [];
  const chargeText = charges.length ? ` • Charges ₹${formatMoney(chargeTotal(charges))}` : (Number(t.charge) > 0 ? ` • Charge ₹${formatMoney(t.charge)}` : "");
  const purpose = t.purpose ? ` • ${t.purpose}` : "";
  const row = document.createElement("div");
  row.className = `transaction ${received ? "received-row" : "repaid-row"}`;
  row.innerHTML = `<div class="transaction-info"><div class="transaction-date">${escapeHtml(t.date || "")}</div><div class="transaction-description">${escapeHtml(t.description || t.purpose || (received ? "Received" : "Repaid"))}</div><div class="transaction-meta">${escapeHtml(t.method || "Other")}${purpose}${chargeText}</div></div><div class="transaction-amount ${received ? "taken-text" : "repaid-text"}">${received ? "+" : "-"}₹${formatMoney(total)}</div><button class="delete-btn" onclick="deleteTransaction('${id}')">Delete</button>`;
  return row;
}

window.deleteTransaction = async function (id) {
  if (!confirm("Delete this transaction?")) return;
  await remove(ref(db, `mypayments/transactions/${id}`));
};

document.getElementById("filterPerson").addEventListener("change", displayTransactions);

function updateDashboard() {
  let totalTaken = 0, totalRepaid = 0;
  Object.values(transactions).forEach((t) => { if (t.type === "taken") totalTaken += transactionTotal(t); else totalRepaid += transactionTotal(t); });
  document.getElementById("totalTaken").textContent = `₹${formatMoney(totalTaken)}`;
  document.getElementById("totalRepaid").textContent = `₹${formatMoney(totalRepaid)}`;
  document.getElementById("totalOutstanding").textContent = `₹${formatMoney(totalTaken - totalRepaid)}`;
}

function formatMoney(number) { return Number(number).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
function escapeHtml(text) { const div = document.createElement("div"); div.textContent = String(text ?? ""); return div.innerHTML; }
function setToday() { document.getElementById("transactionDate").value = new Date().toISOString().split("T")[0]; }

setToday();
calculatePreview();
