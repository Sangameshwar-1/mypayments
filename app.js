import { db, ref, push, set, update, remove, onValue } from "./firebase.js";

let people = {};
let transactions = {};
let editingTransactionId = null;

const peopleRef = ref(db, "mypayments/people");
const transactionsRef = ref(db, "mypayments/transactions");

function formatMoney(n) {
  return Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = String(text ?? "");
  return d.innerHTML;
}
function normalizedType(t) {
  return t.type === "taken" ? "credit" : t.type === "repaid" ? "debit" : (t.type || "other");
}
function typeLabel(t) {
  const type = normalizedType(t);
  return type === "credit" ? "Credit" : type === "debit" ? "Debit" : (t.otherType || "Other");
}
function platformLabel(t) { return t.platform || t.method || "Other"; }

function chargeValue(charge, baseAmount) {
  const value = Number(charge.value ?? charge.amount) || 0;
  if (charge.kind === "percentage") {
    if (!value) return 0;
    return charge.included
      ? baseAmount - baseAmount / (1 + value / 100)
      : baseAmount * value / 100;
  }
  return value;
}
function isIncludedCharge(charge) {
  return charge.kind === "percentage" && charge.included === true;
}
function getCharges(t) {
  return Array.isArray(t.charges)
    ? t.charges
    : (Number(t.charge) ? [{ kind: "fixed", value: Number(t.charge), amount: Number(t.charge), comment: "" }] : []);
}
function chargeTotal(charges, baseAmount = 0) {
  return charges.reduce((sum, charge) => sum + chargeValue(charge, baseAmount), 0);
}
function addedChargeTotal(charges, baseAmount = 0) {
  return charges.reduce((sum, charge) => sum + (isIncludedCharge(charge) ? 0 : chargeValue(charge, baseAmount)), 0);
}
function transactionTotal(t) {
  const amount = Number(t.amount) || 0;
  return amount + addedChargeTotal(getCharges(t), amount);
}
function personTotals(personId) {
  return Object.values(transactions).reduce((x, t) => {
    if (t.personId !== personId) return x;
    const total = transactionTotal(t);
    if (normalizedType(t) === "credit") x.credit += total;
    else if (normalizedType(t) === "debit") x.debit += total;
    return x;
  }, { credit: 0, debit: 0 });
}
function fallbackTime(t) {
  if (t.time) return t.time;
  if (t.createdAt) {
    const d = new Date(t.createdAt);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return "00:00";
}
function transactionSortValue(t) { return `${t.date || "0000-00-00"}T${t.time || "00:00"}`; }

function readChargeRows(selector, edit = false) {
  return [...document.querySelectorAll(`${selector} .charge-row`)]
    .map(row => ({
      kind: row.querySelector(edit ? ".edit-charge-kind" : ".charge-kind").value,
      value: Number(row.querySelector(edit ? ".edit-charge-value" : ".charge-value").value) || 0,
      included: row.querySelector(edit ? ".edit-charge-included" : ".charge-included")?.checked || false,
      comment: row.querySelector(edit ? ".edit-charge-comment" : ".charge-comment").value.trim()
    }))
    .filter(c => c.value > 0);
}
function updateChargePreview(amount, charges, targetId) {
  const all = chargeTotal(charges, amount);
  const added = addedChargeTotal(charges, amount);
  const included = all - added;
  const total = amount + added;
  const target = document.getElementById(targetId);
  if (target) {
    target.textContent = included
      ? `Charges: ₹${formatMoney(all)} (₹${formatMoney(included)} included + ₹${formatMoney(added)} added) • Total: ₹${formatMoney(total)}`
      : `Charges: ₹${formatMoney(all)} • Total: ₹${formatMoney(total)}`;
  }
}
function calculatePreview() {
  const amount = Number(document.getElementById("amount").value) || 0;
  const charges = readChargeRows("#chargesList");
  updateChargePreview(amount, charges, "chargePreview");
  document.getElementById("noCharges").style.display = charges.length ? "none" : "block";
}
function addChargeRow(charge = {}) {
  const row = document.createElement("div");
  row.className = "charge-row";
  row.innerHTML = `<select class="charge-kind"><option value="fixed">Fixed amount</option><option value="percentage">Percentage</option></select><input class="charge-value" type="number" min="0" step="0.01" placeholder="0.00"><label class="check-wrap"><input class="charge-included" type="checkbox">Included</label><input class="charge-comment" type="text" placeholder="Comment"><button type="button" class="remove-charge">Remove</button>`;
  const kind = row.querySelector(".charge-kind");
  const value = row.querySelector(".charge-value");
  const included = row.querySelector(".charge-included");
  const sync = () => {
    included.parentElement.style.visibility = kind.value === "percentage" ? "visible" : "hidden";
    calculatePreview();
  };
  kind.value = charge.kind || (charge.rate != null ? "percentage" : "fixed");
  value.value = charge.value ?? (charge.amount ?? "");
  included.checked = charge.included === true;
  row.querySelector(".charge-comment").value = charge.comment || "";
  row.querySelectorAll("input,select").forEach(el => el.addEventListener("input", sync));
  kind.addEventListener("change", sync);
  row.querySelector(".remove-charge").addEventListener("click", () => { row.remove(); calculatePreview(); });
  document.getElementById("chargesList").appendChild(row);
  sync();
}
function addEditChargeRow(charge = {}) {
  const row = document.createElement("div");
  row.className = "charge-row";
  row.innerHTML = `<select class="edit-charge-kind"><option value="fixed">Fixed amount</option><option value="percentage">Percentage</option></select><input class="edit-charge-value" type="number" min="0" step="0.01" placeholder="0.00"><label class="check-wrap"><input class="edit-charge-included" type="checkbox">Included</label><input class="edit-charge-comment" type="text" placeholder="Comment"><button type="button" class="remove-charge">Remove</button>`;
  const kind = row.querySelector(".edit-charge-kind");
  const value = row.querySelector(".edit-charge-value");
  const included = row.querySelector(".edit-charge-included");
  const sync = () => {
    included.parentElement.style.visibility = kind.value === "percentage" ? "visible" : "hidden";
    updateEditPreview();
  };
  kind.value = charge.kind || (charge.rate != null ? "percentage" : "fixed");
  value.value = charge.value ?? (charge.amount ?? "");
  included.checked = charge.included === true;
  row.querySelector(".edit-charge-comment").value = charge.comment || "";
  row.querySelectorAll("input,select").forEach(el => el.addEventListener("input", sync));
  kind.addEventListener("change", sync);
  row.querySelector(".remove-charge").addEventListener("click", () => { row.remove(); updateEditPreview(); });
  document.getElementById("editChargesList").appendChild(row);
  sync();
}
function getEditCharges() { return readChargeRows("#editChargesList", true); }
function updateEditPreview() {
  const amount = Number(document.getElementById("editAmount").value) || 0;
  updateChargePreview(amount, getEditCharges(), "editChargePreview");
}
function updateConditionalFields() {
  const otherType = document.getElementById("transactionType").value === "other";
  const otherPlatform = document.getElementById("platform").value === "Other";
  document.getElementById("otherTypeWrap").style.display = otherType ? "block" : "none";
  document.getElementById("otherPlatformWrap").style.display = otherPlatform ? "block" : "none";
}
function updateEditFields() {
  document.getElementById("editOtherTypeWrap").style.display = document.getElementById("editType").value === "other" ? "block" : "none";
  document.getElementById("editOtherPlatformWrap").style.display = document.getElementById("editPlatform").value === "Other" ? "block" : "none";
}
function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function localTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function setToday() {
  document.getElementById("transactionDate").value = localDate();
  document.getElementById("transactionTime").value = localTime();
}
function resetTransactionForm() {
  document.getElementById("transactionForm").reset();
  document.getElementById("chargesList").innerHTML = "";
  setToday();
  updateConditionalFields();
  calculatePreview();
}
function updatePersonDropdowns() {
  const tp = document.getElementById("transactionPerson");
  const filter = document.getElementById("filterPerson");
  const selected = filter.value || "all";
  tp.innerHTML = '<option value="">Select person</option>';
  filter.innerHTML = '<option value="all">All people</option>';
  Object.entries(people).forEach(([id, p]) => {
    tp.insertAdjacentHTML("beforeend", `<option value="${id}">${escapeHtml(p.name)}</option>`);
    filter.insertAdjacentHTML("beforeend", `<option value="${id}">${escapeHtml(p.name)}</option>`);
  });
  filter.value = people[selected] ? selected : "all";
}
window.addPerson = async function() {
  const input = document.getElementById("personName"), name = input.value.trim();
  if (!name) return alert("Enter a name");
  try { await set(push(peopleRef), { name }); input.value = ""; }
  catch (e) { alert(`Could not add person: ${e.message}`); }
};
window.editPerson = async function(id) {
  const person = people[id]; if (!person) return;
  const name = prompt("Edit person name:", person.name || "");
  if (name === null) return;
  if (!name.trim()) return alert("Person name cannot be empty");
  try { await update(ref(db, `mypayments/people/${id}`), { name: name.trim() }); }
  catch (e) { alert(`Could not update person: ${e.message}`); }
};
window.deletePerson = async function(id) {
  const person = people[id]; if (!person) return;
  const hasTransactions = Object.values(transactions).some(t => t.personId === id);
  if (!confirm(hasTransactions ? "This person has transactions. Delete the person and all related transactions?" : "Delete this person permanently?")) return;
  try {
    const updates = {};
    updates[`mypayments/people/${id}`] = null;
    Object.entries(transactions).forEach(([txId, t]) => { if (t.personId === id) updates[`mypayments/transactions/${txId}`] = null; });
    await update(ref(db), updates);
  } catch (e) { alert(`Could not delete person: ${e.message}`); }
};
window.deleteTransaction = async id => {
  if (!confirm("Delete this transaction permanently?")) return;
  try { await remove(ref(db, `mypayments/transactions/${id}`)); }
  catch (e) { alert(`Could not delete transaction: ${e.message}`); }
};
window.editTransaction = function(id) {
  const t = transactions[id]; if (!t) return;
  editingTransactionId = id;
  document.getElementById("editPerson").innerHTML = Object.entries(people).map(([pid,p]) => `<option value="${pid}">${escapeHtml(p.name)}</option>`).join("");
  document.getElementById("editPerson").value = t.personId || "";
  document.getElementById("editDate").value = t.date || localDate();
  document.getElementById("editTime").value = fallbackTime(t);
  document.getElementById("editType").value = normalizedType(t);
  document.getElementById("editOtherType").value = t.otherType || "";
  const known = ["PhonePe","GPay","WhatsApp","Paytm","Amazon Pay","Bank Transfer","Cash"];
  const platform = platformLabel(t);
  document.getElementById("editPlatform").value = known.includes(platform) ? platform : "Other";
  document.getElementById("editOtherPlatform").value = known.includes(platform) ? "" : platform;
  document.getElementById("editAmount").value = t.amount ?? "";
  document.getElementById("editAmountComment").value = t.amountComment || "";
  document.getElementById("editPurpose").value = t.purpose || "";
  document.getElementById("editDescription").value = t.description || "";
  const list = document.getElementById("editChargesList"); list.innerHTML = "";
  getCharges(t).forEach(addEditChargeRow);
  updateEditFields();
  updateEditPreview();
  document.getElementById("editModal").classList.add("open");
  document.getElementById("editModal").setAttribute("aria-hidden", "false");
};
window.closeEditModal = function() {
  editingTransactionId = null;
  document.getElementById("editModal").classList.remove("open");
  document.getElementById("editModal").setAttribute("aria-hidden", "true");
};
window.saveEditedTransaction = async function() {
  if (!editingTransactionId) return;
  const type = document.getElementById("editType").value;
  const platformSelect = document.getElementById("editPlatform").value;
  const amount = Number(document.getElementById("editAmount").value);
  const otherType = document.getElementById("editOtherType").value.trim();
  const otherPlatform = document.getElementById("editOtherPlatform").value.trim();
  if (!document.getElementById("editPerson").value || !document.getElementById("editDate").value || !document.getElementById("editTime").value || !amount || amount <= 0) return alert("Please fill in all required fields");
  if (type === "other" && !otherType) return alert("Enter other type");
  if (platformSelect === "Other" && !otherPlatform) return alert("Enter other platform");
  try {
    await update(ref(db, `mypayments/transactions/${editingTransactionId}`), {
      personId: document.getElementById("editPerson").value,
      date: document.getElementById("editDate").value,
      time: document.getElementById("editTime").value,
      type,
      otherType: type === "other" ? otherType : "",
      platform: platformSelect === "Other" ? otherPlatform : platformSelect,
      method: platformSelect === "Other" ? otherPlatform : platformSelect,
      amount,
      amountComment: document.getElementById("editAmountComment").value.trim(),
      purpose: document.getElementById("editPurpose").value.trim(),
      description: document.getElementById("editDescription").value.trim(),
      charges: getEditCharges()
    });
    closeEditModal();
  } catch (e) { alert(`Could not save changes: ${e.message}`); }
};

function chargeDisplay(charge, baseAmount) {
  const computed = chargeValue(charge, baseAmount);
  if (charge.kind === "percentage") return `${formatMoney(charge.value)}% ${charge.included ? "included" : "added"} = ₹${formatMoney(computed)}`;
  return `₹${formatMoney(computed)}`;
}
function createTableRow(id, t) {
  const tr = document.createElement("tr");
  const charges = getCharges(t);
  const base = Number(t.amount) || 0;
  const chargeSum = chargeTotal(charges, base);
  const chargeText = charges.length ? charges.map(c => chargeDisplay(c, base)).join(" • ") : "₹0";
  const chargeComments = charges.map(c => c.comment).filter(Boolean).join("; ");
  const type = normalizedType(t);
  const total = transactionTotal(t);
  tr.innerHTML = `<td>${escapeHtml(t.date || "")}</td><td>${escapeHtml(fallbackTime(t))}</td><td class="amount-cell">₹${formatMoney(base)}</td><td class="comment-cell" title="${escapeHtml(t.amountComment || "")}">${escapeHtml(t.amountComment || "")}</td><td class="charge-detail" title="${escapeHtml(chargeText)}">${escapeHtml(chargeText)}</td><td class="comment-cell" title="${escapeHtml(chargeComments)}">${escapeHtml(chargeComments)}</td><td class="total-cell ${type === "credit" ? "taken-text" : type === "debit" ? "repaid-text" : ""}">${type === "credit" ? "+" : type === "debit" ? "-" : ""}₹${formatMoney(total)}</td><td class="comment-cell" title="${escapeHtml(t.description || "")}">${escapeHtml(t.description || "")}</td><td>${escapeHtml(t.purpose || "")}</td><td><span class="type-badge ${type}">${escapeHtml(typeLabel(t))}</span></td><td><span class="platform-badge">${escapeHtml(platformLabel(t))}</span></td><td class="action-cell"><button class="table-action edit-action" onclick="window.editTransaction('${id}')">Edit</button><button class="table-action delete-action" onclick="window.deleteTransaction('${id}')">Delete</button></td>`;
  return tr;
}
function displayPeople() {
  const c = document.getElementById("peopleList");
  c.innerHTML = "";
  if (!Object.keys(people).length) return c.innerHTML = "<p class='empty'>No people added yet.</p>";
  Object.entries(people).forEach(([id,p]) => {
    const x = personTotals(id), balance = x.credit - x.debit;
    const d = document.createElement("div");
    d.className = "person";
    d.innerHTML = `<div class="person-main" onclick="window.location.href='person.html?id=${encodeURIComponent(id)}'"><div class="person-name">${escapeHtml(p.name)}</div><div class="person-balance ${balance >= 0 ? "positive" : "negative"}">${balance >= 0 ? "Receivable" : "Payable"}: ₹${formatMoney(Math.abs(balance))}</div></div><div class="person-actions"><button type="button" class="small-btn" onclick="event.stopPropagation();window.editPerson('${id}')">Edit</button><button type="button" class="small-btn danger" onclick="event.stopPropagation();window.deletePerson('${id}')">Delete</button></div>`;
    c.appendChild(d);
  });
}
function displayTransactions() {
  const c = document.getElementById("transactionsList");
  const filter = document.getElementById("filterPerson").value;
  c.innerHTML = "";
  const ids = (filter === "all" ? Object.keys(people) : [filter]).filter(id => people[id]);
  ids.forEach(personId => {
    const section = document.createElement("div");
    section.className = "person-ledger";
    const x = personTotals(personId);
    section.innerHTML = `<div class="ledger-header"><div><h3>${escapeHtml(people[personId].name)}</h3><span class="ledger-balance">${x.credit-x.debit >= 0 ? "Receivable" : "Payable"}: ₹${formatMoney(Math.abs(x.credit-x.debit))}</span></div></div><div class="ledger-table-wrap"><table class="ledger-table"><thead><tr><th>Date</th><th>Time</th><th>Amt</th><th>Cmnt</th><th>Charges</th><th>Cmnt</th><th>Total</th><th>Cmnt</th><th>Purpose</th><th>Type</th><th>Platform</th><th>Actions</th></tr></thead><tbody></tbody></table></div>`;
    const tbody = section.querySelector("tbody");
    Object.entries(transactions)
      .filter(([,t]) => t.personId === personId)
      .sort((a,b) => transactionSortValue(b[1]).localeCompare(transactionSortValue(a[1])) || (b[1].createdAt||0)-(a[1].createdAt||0))
      .forEach(([id,t]) => tbody.appendChild(createTableRow(id,t)));
    c.appendChild(section);
  });
  if (!ids.length) c.innerHTML = "<p class='empty'>No people added yet.</p>";
}
function updateDashboard() {
  let credit = 0, debit = 0;
  Object.values(transactions).forEach(t => {
    if (normalizedType(t) === "credit") credit += transactionTotal(t);
    else if (normalizedType(t) === "debit") debit += transactionTotal(t);
  });
  document.getElementById("totalTaken").textContent = `₹${formatMoney(credit)}`;
  document.getElementById("totalGiven").textContent = `₹${formatMoney(debit)}`;
  document.getElementById("totalBalance").textContent = `₹${formatMoney(credit-debit)}`;
}

function pdfRows(filter = "all") {
  return Object.entries(transactions)
    .filter(([,t]) => filter === "all" || t.personId === filter)
    .sort((a,b) => transactionSortValue(a[1]).localeCompare(transactionSortValue(b[1])))
    .map(([,t]) => {
      const charges = getCharges(t);
      const base = Number(t.amount) || 0;
      return [
        people[t.personId]?.name || "Unknown",
        t.date || "-",
        fallbackTime(t),
        `₹${formatMoney(base)}`,
        t.amountComment || "-",
        charges.length ? charges.map(c => chargeDisplay(c,base)).join("\n") : "₹0",
        charges.map(c => c.comment).filter(Boolean).join("; ") || "-",
        `₹${formatMoney(transactionTotal(t))}`,
        t.description || "-",
        t.purpose || "-",
        typeLabel(t),
        platformLabel(t)
      ];
    });
}
function exportToPdf(filter = "all") {
  if (!window.jspdf?.jsPDF) return alert("PDF export library is not loaded. Refresh the page and try again.");
  const rows = pdfRows(filter);
  if (!rows.length) return alert("No transactions to export.");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const margin = 28;
  const title = filter === "all" ? "My Payments Ledger" : `${people[filter]?.name || "Person"} - Payment Ledger`;
  doc.setFontSize(18); doc.setTextColor(23,32,51); doc.text(title, margin, 30);
  doc.setFontSize(9); doc.setTextColor(100,110,125); doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, margin, 45);
  const totals = rows.reduce((x, row) => {
    const t = transactions[Object.keys(transactions).find(id => {
      const p = transactions[id]; return (filter === "all" || p.personId === filter) && p.date === row[1] && fallbackTime(p) === row[2] && formatMoney(p.amount) === formatMoney(Number(String(row[3]).replace(/[₹,]/g,"")));
    })];
    return x;
  }, null);
  doc.autoTable({
    head: [["Person","Date","Time","Amt","Amt Cmnt","Charges","Charge Cmnt","Total","Total Cmnt","Purpose","Type","Platform"]],
    body: rows,
    startY: 58,
    margin: { left: margin, right: margin },
    theme: "grid",
    styles: { fontSize: 6.5, cellPadding: 3, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: [23,32,51], textColor: [255,255,255], fontStyle: "bold", fontSize: 7 },
    alternateRowStyles: { fillColor: [247,249,251] },
    columnStyles: { 0:{cellWidth:70},1:{cellWidth:55},2:{cellWidth:38},3:{cellWidth:52},4:{cellWidth:65},5:{cellWidth:95},6:{cellWidth:70},7:{cellWidth:55},8:{cellWidth:65},9:{cellWidth:60},10:{cellWidth:52},11:{cellWidth:65} }
  });
  doc.save(`my-payments-ledger-${new Date().toISOString().slice(0,10)}.pdf`);
}

document.getElementById("addPersonBtn").addEventListener("click", window.addPerson);
document.getElementById("addChargeBtn").addEventListener("click", () => addChargeRow());
document.getElementById("amount").addEventListener("input", calculatePreview);
document.getElementById("editAmount").addEventListener("input", updateEditPreview);
document.getElementById("transactionType").addEventListener("change", updateConditionalFields);
document.getElementById("platform").addEventListener("change", updateConditionalFields);
document.getElementById("editType").addEventListener("change", updateEditFields);
document.getElementById("editPlatform").addEventListener("change", updateEditFields);
document.getElementById("addEditChargeBtn").addEventListener("click", () => addEditChargeRow());
document.getElementById("cancelEditBtn").addEventListener("click", closeEditModal);
document.getElementById("cancelEditBtn2")?.addEventListener("click", closeEditModal);
document.getElementById("saveEditBtn").addEventListener("click", saveEditedTransaction);
document.getElementById("downloadPdfBtn").addEventListener("click", () => exportToPdf("all"));
document.getElementById("ledgerPdfBtn").addEventListener("click", () => exportToPdf(document.getElementById("filterPerson").value));
document.getElementById("editModal").addEventListener("click", e => { if (e.target.id === "editModal") closeEditModal(); });
document.getElementById("filterPerson").addEventListener("change", displayTransactions);

onValue(peopleRef, snapshot => { people = snapshot.val() || {}; updatePersonDropdowns(); displayPeople(); displayTransactions(); updateDashboard(); });
onValue(transactionsRef, snapshot => { transactions = snapshot.val() || {}; displayPeople(); displayTransactions(); updateDashboard(); });

document.getElementById("transactionForm").addEventListener("submit", async event => {
  event.preventDefault();
  const personId = document.getElementById("transactionPerson").value;
  const date = document.getElementById("transactionDate").value;
  const time = document.getElementById("transactionTime").value;
  const type = document.getElementById("transactionType").value;
  const platform = document.getElementById("platform").value;
  const amount = Number(document.getElementById("amount").value);
  const otherType = document.getElementById("otherType").value.trim();
  const otherPlatform = document.getElementById("otherPlatform").value.trim();
  if (!personId || !date || !time || !amount || amount <= 0) return alert("Please fill in person, date, time and amount");
  if (type === "other" && !otherType) return alert("Enter other type");
  if (platform === "Other" && !otherPlatform) return alert("Enter other platform");
  try {
    await set(push(transactionsRef), {
      personId,date,time,type,
      otherType: type === "other" ? otherType : "",
      amount,
      amountComment: document.getElementById("amountComment").value.trim(),
      purpose: document.getElementById("purpose").value.trim(),
      description: document.getElementById("description").value.trim(),
      charges: readChargeRows("#chargesList"),
      platform: platform === "Other" ? otherPlatform : platform,
      method: platform === "Other" ? otherPlatform : platform,
      createdAt: Date.now()
    });
    resetTransactionForm();
  } catch (e) { alert(`Could not save transaction: ${e.message}`); }
});

setToday();
updateConditionalFields();
calculatePreview();
