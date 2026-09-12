import { db, ref, push, set, update, remove, onValue } from "./firebase.js";

let people = {};
let transactions = {};
let editingTransactionId = null;
const peopleRef = ref(db, "mypayments/people");
const transactionsRef = ref(db, "mypayments/transactions");

function chargeValue(c, baseAmount) {
  const value = Number(c.value ?? c.amount) || 0;
  if (c.kind === "percentage") {
    const rate = value;
    if (!rate) return 0;
    if (c.included) return baseAmount - (baseAmount / (1 + rate / 100));
    return baseAmount * rate / 100;
  }
  return value;
}
function chargeTotal(charges = [], baseAmount = 0) {
  return charges.reduce((sum, c) => sum + chargeValue(c, baseAmount), 0);
}
function transactionTotal(t) {
  const amount = Number(t.amount) || 0;
  const charges = Array.isArray(t.charges) ? t.charges : (Number(t.charge) ? [{ amount: Number(t.charge), kind: "fixed", comment: "" }] : []);
  return amount + chargeTotal(charges, amount);
}
function normalizedType(t) { return t.type === "taken" ? "credit" : t.type === "repaid" ? "debit" : (t.type || "other"); }
function typeLabel(t) { const type = normalizedType(t); return type === "credit" ? "Credit" : type === "debit" ? "Debit" : (t.otherType || "Other"); }
function platformLabel(t) { return t.platform || t.method || "Other"; }
function personTotals(personId) {
  return Object.values(transactions).reduce((x, t) => {
    if (t.personId !== personId) return x;
    const total = transactionTotal(t);
    if (normalizedType(t) === "credit") x.credit += total;
    else if (normalizedType(t) === "debit") x.debit += total;
    return x;
  }, { credit: 0, debit: 0 });
}
function getChargesFromForm(selector = "#chargesList") {
  return [...document.querySelectorAll(`${selector} .charge-row`)].map(row => ({
    kind: row.querySelector(".charge-kind").value,
    value: Number(row.querySelector(".charge-value").value) || 0,
    included: row.querySelector(".charge-included")?.checked || false,
    comment: row.querySelector(".charge-comment").value.trim()
  })).filter(c => c.value > 0);
}
function chargeLabel(c, baseAmount) {
  const value = chargeValue(c, baseAmount);
  return c.kind === "percentage" ? `${c.value}%${c.included ? " included" : ""} = ₹${formatMoney(value)}` : `₹${formatMoney(value)}`;
}
function calculatePreview() {
  const amount = Number(document.getElementById("amount").value) || 0;
  const charges = getChargesFromForm();
  const total = amount + chargeTotal(charges, amount);
  document.getElementById("chargePreview").textContent = `Charges: ₹${formatMoney(chargeTotal(charges, amount))} • Total: ₹${formatMoney(total)}`;
  document.getElementById("noCharges").style.display = charges.length ? "none" : "block";
}
function addChargeRow(charge = {}) {
  const row = document.createElement("div");
  row.className = "charge-row charge-row-flex";
  row.innerHTML = `<select class="charge-kind"><option value="fixed">Fixed amount</option><option value="percentage">Percentage</option></select><input class="charge-value" type="number" min="0" step="0.01" value="${charge.value ?? charge.amount ?? ""}" placeholder="Amount / %"><label class="included-option"><input class="charge-included" type="checkbox" ${charge.included ? "checked" : ""}> Included</label><input class="charge-comment" type="text" value="${escapeHtml(charge.comment || "")}" placeholder="Charge comment"><button type="button" class="remove-charge">×</button>`;
  const kind = row.querySelector(".charge-kind");
  const included = row.querySelector(".charge-included");
  function sync() {
    included.parentElement.style.visibility = kind.value === "percentage" ? "visible" : "hidden";
    calculatePreview();
  }
  kind.value = charge.kind || (charge.rate != null ? "percentage" : "fixed");
  row.querySelectorAll("input,select").forEach(el => el.addEventListener("input", sync));
  row.querySelector(".remove-charge").addEventListener("click", () => { row.remove(); calculatePreview(); });
  document.getElementById("chargesList").appendChild(row);
  sync();
}
function addEditChargeRow(charge = {}) {
  const row = document.createElement("div");
  row.className = "charge-row charge-row-flex";
  row.innerHTML = `<select class="edit-charge-kind"><option value="fixed">Fixed amount</option><option value="percentage">Percentage</option></select><input class="edit-charge-value" type="number" min="0" step="0.01" value="${charge.value ?? charge.amount ?? ""}" placeholder="Amount / %"><label class="included-option"><input class="edit-charge-included" type="checkbox" ${charge.included ? "checked" : ""}> Included</label><input class="edit-charge-comment" type="text" value="${escapeHtml(charge.comment || "")}" placeholder="Charge comment"><button type="button" class="remove-charge">×</button>`;
  const kind = row.querySelector(".edit-charge-kind");
  const included = row.querySelector(".edit-charge-included");
  function sync() { included.parentElement.style.visibility = kind.value === "percentage" ? "visible" : "hidden"; }
  kind.value = charge.kind || (charge.rate != null ? "percentage" : "fixed");
  kind.addEventListener("change", sync);
  row.querySelector(".remove-charge").addEventListener("click", () => row.remove());
  document.getElementById("editChargesList").appendChild(row);
  sync();
}
function getEditCharges() {
  return [...document.querySelectorAll("#editChargesList .charge-row")].map(row => ({
    kind: row.querySelector(".edit-charge-kind").value,
    value: Number(row.querySelector(".edit-charge-value").value) || 0,
    included: row.querySelector(".edit-charge-included")?.checked || false,
    comment: row.querySelector(".edit-charge-comment").value.trim()
  })).filter(c => c.value > 0);
}
function updateConditionalFields() {
  const otherType = document.getElementById("transactionType").value === "other";
  const otherPlatform = document.getElementById("platform").value === "Other";
  document.getElementById("otherTypeWrap").style.display = otherType ? "block" : "none";
  document.getElementById("otherPlatformWrap").style.display = otherPlatform ? "block" : "none";
  if (!otherType) document.getElementById("otherType").value = "";
  if (!otherPlatform) document.getElementById("otherPlatform").value = "";
}
function localDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function localTime() { const d = new Date(); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
function fallbackTime(t) { if (t.time) return t.time; if (t.createdAt) { const d = new Date(t.createdAt); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; } return ""; }
function setToday() { document.getElementById("transactionDate").value = localDate(); document.getElementById("transactionTime").value = localTime(); }
function resetTransactionForm() { document.getElementById("transactionForm").reset(); document.getElementById("chargesList").innerHTML = ""; setToday(); updateConditionalFields(); calculatePreview(); }
function transactionSortValue(t) { return `${t.date || "0000-00-00"}T${t.time || "00:00"}`; }

window.addPerson = async function() { const input = document.getElementById("personName"), name = input.value.trim(); if (!name) return alert("Enter a name"); try { await set(push(peopleRef), { name, createdAt: Date.now() }); input.value = ""; } catch (e) { alert(`Could not add person: ${e.message}`); } };
window.editPerson = async function(id) { const person = people[id]; if (!person) return; const name = prompt("Edit person name:", person.name || ""); if (name === null) return; const value = name.trim(); if (!value) return alert("Name cannot be empty"); try { await update(ref(db, `mypayments/people/${id}`), { name: value }); } catch (e) { alert(`Could not edit person: ${e.message}`); } };
window.deletePerson = async function(id) { const person = people[id]; if (!person) return; const hasTransactions = Object.values(transactions).some(t => t.personId === id); const message = hasTransactions ? `Delete ${person.name} and all transactions for this person?` : `Delete ${person.name}?`; if (!confirm(message)) return; if (hasTransactions && !confirm("This will permanently delete the transaction history. Continue?")) return; const updates = {}; updates[`mypayments/people/${id}`] = null; Object.entries(transactions).forEach(([txId,t]) => { if (t.personId === id) updates[`mypayments/transactions/${txId}`] = null; }); try { await update(ref(db), updates); } catch (e) { alert(`Could not delete: ${e.message}`); } };
window.deleteTransaction = async id => { if (!confirm("Delete this transaction permanently?")) return; try { await remove(ref(db, `mypayments/transactions/${id}`)); } catch (e) { alert(`Could not delete transaction: ${e.message}`); } };
window.editTransaction = function(id) {
  const t = transactions[id]; if (!t) return;
  editingTransactionId = id;
  document.getElementById("editPerson").innerHTML = Object.entries(people).map(([pid,p]) => `<option value="${pid}">${escapeHtml(p.name)}</option>`).join("");
  document.getElementById("editPerson").value = t.personId || "";
  document.getElementById("editDate").value = t.date || localDate();
  document.getElementById("editTime").value = fallbackTime(t);
  document.getElementById("editType").value = normalizedType(t);
  document.getElementById("editOtherType").value = t.otherType || "";
  const knownPlatforms = ["PhonePe","GPay","WhatsApp","Paytm","Amazon Pay","Bank Transfer","Cash"];
  const platform = platformLabel(t);
  document.getElementById("editPlatform").value = knownPlatforms.includes(platform) ? platform : "Other";
  document.getElementById("editOtherPlatform").value = knownPlatforms.includes(platform) ? "" : platform;
  document.getElementById("editAmount").value = t.amount ?? "";
  document.getElementById("editAmountComment").value = t.amountComment || "";
  document.getElementById("editPurpose").value = t.purpose || "";
  document.getElementById("editDescription").value = t.description || "";
  const list = document.getElementById("editChargesList"); list.innerHTML = "";
  const charges = Array.isArray(t.charges) ? t.charges : (Number(t.charge) ? [{amount:Number(t.charge),kind:"fixed",comment:""}] : []);
  charges.forEach(addEditChargeRow);
  updateEditFields();
  document.getElementById("editModal").classList.add("open");
  document.getElementById("editModal").setAttribute("aria-hidden","false");
};
function updateEditFields() { document.getElementById("editOtherTypeWrap").style.display = document.getElementById("editType").value === "other" ? "block" : "none"; document.getElementById("editOtherPlatformWrap").style.display = document.getElementById("editPlatform").value === "Other" ? "block" : "none"; }
window.closeEditModal = function() { editingTransactionId = null; document.getElementById("editModal").classList.remove("open"); document.getElementById("editModal").setAttribute("aria-hidden","true"); };
window.saveEditedTransaction = async function() {
  if (!editingTransactionId) return;
  const type = document.getElementById("editType").value, platformSelect = document.getElementById("editPlatform").value, amount = Number(document.getElementById("editAmount").value);
  const otherType = document.getElementById("editOtherType").value.trim(), otherPlatform = document.getElementById("editOtherPlatform").value.trim();
  if (!document.getElementById("editPerson").value || !document.getElementById("editDate").value || !document.getElementById("editTime").value || !amount || amount <= 0) return alert("Please fill the required fields");
  if (type === "other" && !otherType) return alert("Enter other type");
  if (platformSelect === "Other" && !otherPlatform) return alert("Enter other platform");
  try {
    await update(ref(db, `mypayments/transactions/${editingTransactionId}`), { personId: document.getElementById("editPerson").value, date: document.getElementById("editDate").value, time: document.getElementById("editTime").value, type, otherType, amount, amountComment: document.getElementById("editAmountComment").value.trim(), charges: getEditCharges(), platform: platformSelect === "Other" ? otherPlatform : platformSelect, purpose: document.getElementById("editPurpose").value.trim(), description: document.getElementById("editDescription").value.trim() });
    closeEditModal();
  } catch (e) { alert(`Could not save changes: ${e.message}`); }
};

document.getElementById("addPersonBtn").addEventListener("click", window.addPerson);
document.getElementById("addChargeBtn").addEventListener("click", () => addChargeRow());
document.getElementById("amount").addEventListener("input", calculatePreview);
document.getElementById("transactionType").addEventListener("change", updateConditionalFields);
document.getElementById("platform").addEventListener("change", updateConditionalFields);
document.getElementById("editType").addEventListener("change", updateEditFields);
document.getElementById("editPlatform").addEventListener("change", updateEditFields);
document.getElementById("addEditChargeBtn").addEventListener("click", () => addEditChargeRow());
document.getElementById("cancelEditBtn").addEventListener("click", closeEditModal);
document.getElementById("cancelEditBtn2").addEventListener("click", closeEditModal);
document.getElementById("saveEditBtn").addEventListener("click", saveEditedTransaction);
document.getElementById("editModal").addEventListener("click", e => { if (e.target.id === "editModal") closeEditModal(); });

onValue(peopleRef, snapshot => { people = snapshot.val() || {}; updatePersonDropdowns(); renderLedger(); updateDashboard(); });
onValue(transactionsRef, snapshot => { transactions = snapshot.val() || {}; renderLedger(); updateDashboard(); });

document.getElementById("transactionForm").addEventListener("submit", async event => {
  event.preventDefault();
  const personId = document.getElementById("transactionPerson").value, date = document.getElementById("transactionDate").value, time = document.getElementById("transactionTime").value, type = document.getElementById("transactionType").value, amount = Number(document.getElementById("amount").value), platformSelect = document.getElementById("platform").value, otherPlatform = document.getElementById("otherPlatform").value.trim(), otherType = document.getElementById("otherType").value.trim();
  if (!personId) return alert("Select a person"); if (!date) return alert("Select a date"); if (!time) return alert("Select a time"); if (!amount || amount <= 0) return alert("Enter a valid amount"); if (type === "other" && !otherType) return alert("Enter other type"); if (platformSelect === "Other" && !otherPlatform) return alert("Enter other platform");
  try { await set(push(transactionsRef), { personId, date, time, type, otherType, amount, amountComment: document.getElementById("amountComment").value.trim(), charges: getChargesFromForm(), platform: platformSelect === "Other" ? otherPlatform : platformSelect, purpose: document.getElementById("purpose").value.trim(), description: document.getElementById("description").value.trim(), createdAt: Date.now() }); resetTransactionForm(); } catch (e) { alert(`Could not save transaction: ${e.message}`); }
});
function updatePersonDropdowns() {
  const tp = document.getElementById("transactionPerson"), fp = document.getElementById("filterPerson").value || "all";
  tp.innerHTML = '<option value="">Select person</option>'; document.getElementById("filterPerson").innerHTML = '<option value="all">All people</option>';
  Object.entries(people).forEach(([id,p]) => { tp.insertAdjacentHTML("beforeend", `<option value="${id}">${escapeHtml(p.name)}</option>`); document.getElementById("filterPerson").insertAdjacentHTML("beforeend", `<option value="${id}">${escapeHtml(p.name)}</option>`); });
  document.getElementById("filterPerson").value = people[fp] ? fp : "all";
}
function renderLedger() { displayPeople(); displayTransactions(); }
function displayPeople() {
  const c = document.getElementById("peopleList"); c.innerHTML = "";
  if (!Object.keys(people).length) return c.innerHTML = "<p class='empty'>No people added yet.</p>";
  Object.entries(people).forEach(([id,p]) => { const x=personTotals(id), balance=x.credit-x.debit, d=document.createElement("div"); d.className="person"; d.innerHTML=`<div class="person-main" onclick="location.href='person.html?id=${encodeURIComponent(id)}'"><div class="person-name">${escapeHtml(p.name)}</div><div class="person-summary"><span class="taken-text">Credit ₹${formatMoney(x.credit)}</span><span class="repaid-text">Debit ₹${formatMoney(x.debit)}</span></div></div><div class="person-right"><div class="balance ${balance>=0?'positive':'negative'}">₹${formatMoney(balance)}</div><div class="person-actions"><button class="icon-btn edit-btn" onclick="event.stopPropagation();editPerson('${id}')">Edit</button><button class="icon-btn delete-icon" onclick="event.stopPropagation();deletePerson('${id}')">Delete</button></div></div>`; c.appendChild(d); });
}
function displayTransactions() {
  const c=document.getElementById("transactionsList"), filter=document.getElementById("filterPerson").value; c.innerHTML="";
  const ids=(filter==="all"?Object.keys(people):[filter]).filter(id=>people[id]);
  ids.forEach(personId=>{
    const section=document.createElement("div"); section.className="person-ledger"; const x=personTotals(personId);
    section.innerHTML=`<div class="ledger-header"><div><h3>${escapeHtml(people[personId].name)}</h3><span class="ledger-balance">Balance: ₹${formatMoney(x.credit-x.debit)}</span></div></div><div class="ledger-table-wrap"><table class="ledger-table"><thead><tr><th>Date</th><th>Time</th><th>Amt</th><th>Cmnt</th><th>Charges</th><th>Cmnt</th><th>Total</th><th>Cmnt</th><th>Purpose</th><th>Type</th><th>Platform</th><th>Actions</th></tr></thead><tbody></tbody></table></div>`;
    const tbody=section.querySelector("tbody");
    Object.entries(transactions).filter(([,t])=>t.personId===personId).sort((a,b)=>transactionSortValue(b[1]).localeCompare(transactionSortValue(a[1]))||(b[1].createdAt||0)-(a[1].createdAt||0)).forEach(([id,t])=>tbody.appendChild(createTableRow(id,t)));
    c.appendChild(section);
  });
  if(!ids.length)c.innerHTML="<p class='empty'>No people added yet.</p>";
}
function createTableRow(id,t) {
  const tr=document.createElement("tr"), charges=Array.isArray(t.charges)?t.charges:(Number(t.charge)?[{amount:Number(t.charge),kind:"fixed",comment:""}]:[]), chargeSum=chargeTotal(charges, Number(t.amount)||0), chargeComments=charges.map(c=>`${chargeLabel(c,Number(t.amount)||0)}${c.comment?` (${c.comment})`:""}`).join("; ");
  const date=t.date||"", time=fallbackTime(t);
  tr.innerHTML=`<td>${escapeHtml(date)}</td><td>${escapeHtml(time)}</td><td>₹${formatMoney(t.amount)}</td><td>${escapeHtml(t.amountComment||"")}</td><td>₹${formatMoney(chargeSum)}</td><td>${escapeHtml(chargeComments)}</td><td class="${normalizedType(t)==="credit"?"taken-text":"repaid-text"}">${normalizedType(t)==="credit"?"+":"-"}₹${formatMoney(transactionTotal(t))}</td><td>${escapeHtml(t.description||"")}</td><td>${escapeHtml(t.purpose||"")}</td><td><span class="type-badge ${normalizedType(t)}">${escapeHtml(typeLabel(t))}</span></td><td><span class="platform-badge">${escapeHtml(platformLabel(t))}</span></td><td class="action-cell"><button class="table-action edit-action" onclick="editTransaction('${id}')">Edit</button><button class="table-action delete-action" onclick="deleteTransaction('${id}')">Delete</button></td>`;
  return tr;
}
document.getElementById("filterPerson").addEventListener("change", displayTransactions);
function updateDashboard(){let credit=0,debit=0;Object.values(transactions).forEach(t=>{if(normalizedType(t)==="credit")credit+=transactionTotal(t);else if(normalizedType(t)==="debit")debit+=transactionTotal(t);});document.getElementById("totalTaken").textContent=`₹${formatMoney(credit)}`;document.getElementById("totalRepaid").textContent=`₹${formatMoney(debit)}`;document.getElementById("totalOutstanding").textContent=`₹${formatMoney(credit-debit)}`;}
function formatMoney(n){return Number(n).toLocaleString("en-IN",{minimumFractionDigits:0,maximumFractionDigits:2});}
function escapeHtml(text){const d=document.createElement("div");d.textContent=String(text??"");return d.innerHTML;}
setToday(); updateConditionalFields(); calculatePreview();