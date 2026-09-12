import { db, ref, push, set, remove, onValue } from "./firebase.js";

let people = {};
let transactions = {};

const peopleRef = ref(db, "mypayments/people");
const transactionsRef = ref(db, "mypayments/transactions");

function percentageCharge(amount, rate, includesRate) {
  const value = Number(amount) || 0;
  const percent = Number(rate) || 0;
  if (!percent) return 0;
  return includesRate ? value - (value / (1 + percent / 100)) : value * percent / 100;
}

function calculateCharges() {
  const amount = Number(document.getElementById("amount").value) || 0;
  const mode = document.getElementById("chargeMode").value;
  const rate = Number(document.getElementById("chargeRate").value) || 0;
  const fixed = Number(document.getElementById("fixedCharge").value) || 0;
  const includesRate = document.getElementById("amountIncludesRate").checked;

  let rateCharge = 0;
  let fixedCharge = 0;
  if (mode === "percent" || mode === "both") rateCharge = percentageCharge(amount, rate, includesRate);
  if (mode === "fixed" || mode === "both") fixedCharge = fixed;

  const total = amount + rateCharge + fixedCharge;
  document.getElementById("chargePreview").textContent =
    `Charge: ₹${formatMoney(rateCharge + fixedCharge)} • Total: ₹${formatMoney(total)}`;
  return { rateCharge, fixedCharge, total };
}

function transactionTotal(t) {
  return (Number(t.amount) || 0) + (Number(t.charge) || 0);
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

window.addPerson = async function () {
  const input = document.getElementById("personName");
  const name = input.value.trim();
  if (!name) return alert("Enter a name");
  await set(push(peopleRef), { name, createdAt: Date.now() });
  input.value = "";
};

document.getElementById("addPersonBtn").addEventListener("click", window.addPerson);

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
  const description = document.getElementById("description").value.trim();
  const { rateCharge, fixedCharge } = calculateCharges();
  const charge = rateCharge + fixedCharge;

  if (!personId) return alert("Select a person");
  if (!date) return alert("Select a date");
  if (!amount || amount <= 0) return alert("Enter a valid amount");
  if (charge < 0) return alert("Charge cannot be negative");

  await set(push(transactionsRef), {
    personId,
    date,
    type,
    amount,
    charge,
    chargeRate: rateCharge,
    fixedCharge,
    method,
    description,
    createdAt: Date.now()
  });

  event.target.reset();
  document.getElementById("chargeMode").value = "none";
  document.getElementById("chargeRate").value = "0";
  document.getElementById("fixedCharge").value = "0";
  updateChargeFields();
  calculateCharges();
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
    div.setAttribute("aria-label", `Open ${people[id].name} details`);
    div.innerHTML = `
      <div>
        <div class="person-name">${escapeHtml(people[id].name)}</div>
        <div class="person-summary">
          <span class="taken-text">Received ₹${formatMoney(totals.received)}</span>
          <span class="repaid-text">Repaid ₹${formatMoney(totals.repaid)}</span>
        </div>
      </div>
      <div class="balance ${balance >= 0 ? "positive" : "negative"}">₹${formatMoney(balance)}</div>
    `;
    const openPerson = () => { window.location.href = `person.html?id=${encodeURIComponent(id)}`; };
    div.addEventListener("click", openPerson);
    div.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPerson();
      }
    });
    container.appendChild(div);
  });
}

function displayTransactions() {
  const container = document.getElementById("transactionsList");
  const filter = document.getElementById("filterPerson").value;
  container.innerHTML = "";

  const peopleToShow = filter === "all" ? Object.keys(people) : [filter];
  const activePeople = peopleToShow.filter((id) => people[id]);

  if (!activePeople.length) {
    container.innerHTML = "<p>No people added yet.</p>";
    return;
  }

  activePeople.forEach((personId) => {
    const personTransactions = Object.entries(transactions)
      .filter(([, t]) => t.personId === personId)
      .sort((a, b) => new Date(b[1].date) - new Date(a[1].date) || (b[1].createdAt || 0) - (a[1].createdAt || 0));

    const totals = personTotals(personId);
    const balance = totals.received - totals.repaid;
    const section = document.createElement("div");
    section.className = "person-ledger";
    section.innerHTML = `
      <div class="ledger-header">
        <div>
          <h3>${escapeHtml(people[personId].name)}</h3>
          <span class="ledger-balance">Balance: ₹${formatMoney(balance)}</span>
        </div>
        <div class="ledger-totals">
          <span class="taken-text">+₹${formatMoney(totals.received)}</span>
          <span class="repaid-text">-₹${formatMoney(totals.repaid)}</span>
        </div>
      </div>
      <div class="ledger-transactions"></div>
    `;

    const list = section.querySelector(".ledger-transactions");
    if (!personTransactions.length) {
      list.innerHTML = "<p class='empty'>No transactions for this person.</p>";
    } else {
      personTransactions.forEach(([id, t]) => list.appendChild(createTransactionRow(id, t)));
    }
    container.appendChild(section);
  });
}

function createTransactionRow(id, t) {
  const total = transactionTotal(t);
  const received = t.type === "taken";
  const chargeText = Number(t.charge) > 0 ? ` • Charge ₹${formatMoney(t.charge)}` : "";
  const row = document.createElement("div");
  row.className = `transaction ${received ? "received-row" : "repaid-row"}`;
  row.innerHTML = `
    <div class="transaction-info">
      <div class="transaction-date">${escapeHtml(t.date || "")}</div>
      <div class="transaction-description">${escapeHtml(t.description || t.method || (received ? "Received" : "Repaid"))}</div>
      <div class="transaction-meta">${escapeHtml(t.method || "Other")}${chargeText}</div>
    </div>
    <div class="transaction-amount ${received ? "taken-text" : "repaid-text"}">${received ? "+" : "-"}₹${formatMoney(total)}</div>
    <button class="delete-btn" onclick="deleteTransaction('${id}')">Delete</button>
  `;
  return row;
}

window.deleteTransaction = async function (id) {
  if (!confirm("Delete this transaction?")) return;
  await remove(ref(db, `mypayments/transactions/${id}`));
};

document.getElementById("filterPerson").addEventListener("change", displayTransactions);
document.getElementById("amount").addEventListener("input", calculateCharges);
document.getElementById("chargeRate").addEventListener("input", calculateCharges);
document.getElementById("fixedCharge").addEventListener("input", calculateCharges);
document.getElementById("amountIncludesRate").addEventListener("change", calculateCharges);
document.getElementById("chargeMode").addEventListener("change", () => {
  updateChargeFields();
  calculateCharges();
});

function updateChargeFields() {
  const mode = document.getElementById("chargeMode").value;
  const rateLabel = document.getElementById("chargeRateLabel");
  const rateInput = document.getElementById("chargeRate");
  const fixedLabel = document.getElementById("fixedChargeLabel");
  const fixedInput = document.getElementById("fixedCharge");
  const checkbox = document.getElementById("amountIncludesRate");
  const usesRate = mode === "percent" || mode === "both";
  const usesFixed = mode === "fixed" || mode === "both";

  rateLabel.style.display = rateInput.style.display = usesRate ? "block" : "none";
  fixedLabel.style.display = fixedInput.style.display = usesFixed ? "block" : "none";
  checkbox.parentElement.style.display = usesRate ? "flex" : "none";
}

function updateDashboard() {
  let totalTaken = 0;
  let totalRepaid = 0;
  Object.values(transactions).forEach((t) => {
    if (t.type === "taken") totalTaken += transactionTotal(t);
    else totalRepaid += transactionTotal(t);
  });
  document.getElementById("totalTaken").textContent = `₹${formatMoney(totalTaken)}`;
  document.getElementById("totalRepaid").textContent = `₹${formatMoney(totalRepaid)}`;
  document.getElementById("totalOutstanding").textContent = `₹${formatMoney(totalTaken - totalRepaid)}`;
}

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
updateChargeFields();
calculateCharges();
