import { db, ref, push, set, remove, onValue } from "./firebase.js";

let people = {};
let transactions = {};
const peopleRef = ref(db, "mypayments/people");
const transactionsRef = ref(db, "mypayments/transactions");

function chargeTotal(charges = []) { return charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0); }
function transactionTotal(t) { return (Number(t.amount) || 0) + (Array.isArray(t.charges) ? chargeTotal(t.charges) : (Number(t.charge) || 0)); }
function normalizedType(t) { return t.type === "taken" ? "credit" : t.type === "repaid" ? "debit" : (t.type || "other"); }
function typeLabel(t) { const type = normalizedType(t); return type === "credit" ? "Credit" : type === "debit" ? "Debit" : (t.otherType || "Other"); }
function platformLabel(t) { return t.platform || t.method || "Other"; }
function personTotals(personId) {
  return Object.values(transactions).reduce((x, t) => { if (t.personId !== personId) return x; const total = transactionTotal(t); if (normalizedType(t) === "credit") x.credit += total; else if (normalizedType(t) === "debit") x.debit += total; return x; }, { credit: 0, debit: 0 });
}
function getChargesFromForm() {
  return [...document.querySelectorAll(".charge-row")].map(row => ({ amount: Number(row.querySelector(".charge-amount").value) || 0, comment: row.querySelector(".charge-comment").value.trim() })).filter(c => c.amount > 0);
}
function calculatePreview() {
  const amount = Number(document.getElementById("amount").value) || 0, charges = getChargesFromForm(), total = amount + chargeTotal(charges);
  document.getElementById("chargePreview").textContent = `Charges: ₹${formatMoney(chargeTotal(charges))} • Total: ₹${formatMoney(total)}`;
  document.getElementById("noCharges").style.display = charges.length ? "none" : "block";
}
function addChargeRow(amount = "", comment = "") {
  const row = document.createElement("div"); row.className = "charge-row";
  row.innerHTML = `<input class="charge-amount" type="number" min="0" step="0.01" value="${amount}" placeholder="Charge amount"><input class="charge-comment" type="text" value="${escapeHtml(comment)}" placeholder="Charge comment"><button type="button" class="remove-charge">×</button>`;
  row.querySelectorAll("input").forEach(i => i.addEventListener("input", calculatePreview));
  row.querySelector(".remove-charge").addEventListener("click", () => { row.remove(); calculatePreview(); });
  document.getElementById("chargesList").appendChild(row); calculatePreview();
}
function updateConditionalFields() {
  const otherType = document.getElementById("transactionType").value === "other";
  const otherPlatform = document.getElementById("platform").value === "Other";
  document.getElementById("otherTypeWrap").style.display = otherType ? "block" : "none";
  document.getElementById("otherPlatformWrap").style.display = otherPlatform ? "block" : "none";
  if (!otherType) document.getElementById("otherType").value = "";
  if (!otherPlatform) document.getElementById("otherPlatform").value = "";
}
window.addPerson = async function() { const input = document.getElementById("personName"), name = input.value.trim(); if (!name) return alert("Enter a name"); await set(push(peopleRef), { name, createdAt: Date.now() }); input.value = ""; };
document.getElementById("addPersonBtn").addEventListener("click", window.addPerson);
document.getElementById("addChargeBtn").addEventListener("click", () => addChargeRow());
document.getElementById("amount").addEventListener("input", calculatePreview);
document.getElementById("transactionType").addEventListener("change", updateConditionalFields);
document.getElementById("platform").addEventListener("change", updateConditionalFields);

onValue(peopleRef, snapshot => { people = snapshot.val() || {}; updatePersonDropdowns(); renderLedger(); updateDashboard(); });
onValue(transactionsRef, snapshot => { transactions = snapshot.val() || {}; renderLedger(); updateDashboard(); });

document.getElementById("transactionForm").addEventListener("submit", async event => {
  event.preventDefault();
  const personId = document.getElementById("transactionPerson").value, date = document.getElementById("transactionDate").value, type = document.getElementById("transactionType").value, amount = Number(document.getElementById("amount").value), platformSelect = document.getElementById("platform").value, otherPlatform = document.getElementById("otherPlatform").value.trim(), otherType = document.getElementById("otherType").value.trim();
  if (!personId) return alert("Select a person"); if (!date) return alert("Select a date"); if (!amount || amount <= 0) return alert("Enter a valid amount"); if (type === "other" && !otherType) return alert("Enter other type"); if (platformSelect === "Other" && !otherPlatform) return alert("Enter other platform");
  await set(push(transactionsRef), { personId, date, type, otherType, amount, amountComment: document.getElementById("amountComment").value.trim(), charges: getChargesFromForm(), platform: platformSelect === "Other" ? otherPlatform : platformSelect, purpose: document.getElementById("purpose").value.trim(), description: document.getElementById("description").value.trim(), createdAt: Date.now() });
  event.target.reset(); document.getElementById("chargesList").innerHTML = ""; setToday(); updateConditionalFields(); calculatePreview();
});
function updatePersonDropdowns() { const tp = document.getElementById("transactionPerson"), fp = document.getElementById("filterPerson"), selected = fp.value || "all"; tp.innerHTML = '<option value="">Select person</option>'; fp.innerHTML = '<option value="all">All people</option>'; Object.entries(people).forEach(([id, p]) => { const a = document.createElement("option"); a.value = id; a.textContent = p.name; tp.appendChild(a); const b = document.createElement("option"); b.value = id; b.textContent = p.name; fp.appendChild(b); }); if (selected === "all" || people[selected]) fp.value = selected; }
function renderLedger() { displayPeople(); displayTransactions(); }
function displayPeople() { const c = document.getElementById("peopleList"); c.innerHTML = ""; if (!Object.keys(people).length) return c.innerHTML = "<p>No people added yet.</p>"; Object.entries(people).forEach(([id, p]) => { const x = personTotals(id), balance = x.credit - x.debit, d = document.createElement("div"); d.className = "person"; d.innerHTML = `<div><div class="person-name">${escapeHtml(p.name)}</div><div class="person-summary"><span class="taken-text">Credit ₹${formatMoney(x.credit)}</span><span class="repaid-text">Debit ₹${formatMoney(x.debit)}</span></div></div><div class="balance ${balance >= 0 ? "positive" : "negative"}">₹${formatMoney(balance)}</div>`; d.onclick = () => location.href = `person.html?id=${encodeURIComponent(id)}`; c.appendChild(d); }); }
function displayTransactions() {
  const c = document.getElementById("transactionsList"), filter = document.getElementById("filterPerson").value;
  c.innerHTML = "";
  const ids = (filter === "all" ? Object.keys(people) : [filter]).filter(id => people[id]);
  ids.forEach(personId => {
    const section = document.createElement("div"); section.className = "person-ledger"; const x = personTotals(personId);
    section.innerHTML = `<div class="ledger-header"><div><h3>${escapeHtml(people[personId].name)}</h3><span class="ledger-balance">Balance: ₹${formatMoney(x.credit - x.debit)}</span></div></div><div class="ledger-table-wrap"><table class="ledger-table"><thead><tr><th>Amt</th><th>Cmnt</th><th>Charges</th><th>Cmnt</th><th>Total</th><th>Cmnt</th><th>Purpose</th><th>Type</th><th>Platform</th><th></th></tr></thead><tbody></tbody></table></div>`;
    const tbody = section.querySelector("tbody");
    Object.entries(transactions).filter(([,t]) => t.personId === personId).sort((a,b) => new Date(b[1].date)-new Date(a[1].date) || (b[1].createdAt||0)-(a[1].createdAt||0)).forEach(([id,t]) => tbody.appendChild(createTableRow(id,t)));
    c.appendChild(section);
  });
  if (!ids.length) c.innerHTML = "<p>No people added yet.</p>";
}
function createTableRow(id,t) {
  const tr = document.createElement("tr"), charges = Array.isArray(t.charges) ? t.charges : (Number(t.charge) ? [{amount:Number(t.charge),comment:""}] : []), chargeSum = chargeTotal(charges), chargeComments = charges.map(c => c.comment).filter(Boolean).join("; ");
  tr.innerHTML = `<td>₹${formatMoney(t.amount)}</td><td>${escapeHtml(t.amountComment || "")}</td><td>₹${formatMoney(chargeSum)}</td><td>${escapeHtml(chargeComments)}</td><td class="${normalizedType(t)==="credit"?"taken-text":"repaid-text"}">${normalizedType(t)==="credit"?"+":"-"}₹${formatMoney(transactionTotal(t))}</td><td>${escapeHtml(t.description || "")}</td><td>${escapeHtml(t.purpose || "")}</td><td>${escapeHtml(typeLabel(t))}</td><td>${escapeHtml(platformLabel(t))}</td><td><button class="delete-btn" onclick="deleteTransaction('${id}')">Delete</button></td>`;
  return tr;
}
window.deleteTransaction = async id => { if (confirm("Delete this transaction?")) await remove(ref(db, `mypayments/transactions/${id}`)); };
document.getElementById("filterPerson").addEventListener("change", displayTransactions);
function updateDashboard() { let credit=0,debit=0; Object.values(transactions).forEach(t => { if(normalizedType(t)==="credit") credit+=transactionTotal(t); else if(normalizedType(t)==="debit") debit+=transactionTotal(t); }); document.getElementById("totalTaken").textContent=`₹${formatMoney(credit)}`; document.getElementById("totalRepaid").textContent=`₹${formatMoney(debit)}`; document.getElementById("totalOutstanding").textContent=`₹${formatMoney(credit-debit)}`; }
function formatMoney(n){return Number(n).toLocaleString("en-IN",{minimumFractionDigits:0,maximumFractionDigits:2});} function escapeHtml(text){const d=document.createElement("div");d.textContent=String(text??"");return d.innerHTML;} function setToday(){document.getElementById("transactionDate").value=new Date().toISOString().split("T")[0];}
setToday(); updateConditionalFields(); calculatePreview();
