import { db, ref, update, remove, onValue } from "./firebase.js";

const personId = new URLSearchParams(location.search).get("id");
const peopleRef = ref(db, "mypayments/people");
const transactionsRef = ref(db, "mypayments/transactions");
let person = null, transactions = {};

function formatMoney(n){return Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:0,maximumFractionDigits:2});}
function escapeHtml(t){const d=document.createElement("div");d.textContent=String(t??"");return d.innerHTML;}
function type(t){return t.type==="credit"||t.type==="taken"?"credit":t.type==="debit"||t.type==="repaid"?"debit":"other";}
function typeLabel(t){return type(t)==="credit"?"Credit":type(t)==="debit"?"Debit":(t.otherType||"Other");}
function chargeValue(c,base){const v=Number(c.value??c.amount)||0;if(c.kind==="percentage")return c.included?base-base/(1+v/100):base*v/100;return v;}
function isIncluded(c){return c.kind==="percentage"&&c.included===true;}
function chargesOf(t){return Array.isArray(t.charges)?t.charges:(Number(t.charge)?[{kind:"fixed",value:Number(t.charge),amount:Number(t.charge),comment:""}]:[]);}
function chargeTotal(t){const base=Number(t.amount)||0;return chargesOf(t).reduce((s,c)=>s+chargeValue(c,base),0);}
function total(t){const base=Number(t.amount)||0;return base+chargesOf(t).reduce((s,c)=>s+(isIncluded(c)?0:chargeValue(c,base)),0);}
function chargeText(c,base){const v=chargeValue(c,base);return c.kind==="percentage"?formatMoney(c.value)+"% "+(c.included?"included":"added")+" = ₹"+formatMoney(v):"₹"+formatMoney(v);}
function fallbackTime(t){if(t.time)return t.time;if(t.createdAt){const d=new Date(t.createdAt);return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");}return "00:00";}
function sortValue(t){return (t.date||"0000-00-00")+"T"+(t.time||"00:00");}

window.deleteDetailTransaction=async id=>{if(!confirm("Delete this transaction permanently?"))return;try{await remove(ref(db,"mypayments/transactions/"+id));}catch(e){alert("Could not delete transaction: "+e.message);}};
window.editDetailTransaction=async id=>{const t=transactions[id];if(!t)return;const amount=prompt("Amount:",t.amount??"");if(amount===null)return;const value=Number(amount);if(!value||value<=0)return alert("Enter a valid amount");const date=prompt("Date (YYYY-MM-DD):",t.date||"");if(date===null)return;const time=prompt("Time (HH:MM):",fallbackTime(t));if(time===null)return;const purpose=prompt("Purpose:",t.purpose||"");if(purpose===null)return;const comment=prompt("Total comment:",t.description||"");if(comment===null)return;try{await update(ref(db,"mypayments/transactions/"+id),{amount:value,date,time,purpose:purpose.trim(),description:comment.trim()});}catch(e){alert("Could not update transaction: "+e.message);}};

function render(){
 const title=document.getElementById("personTitle"),c=document.getElementById("detailTransactions");
 if(!personId||!person){title.textContent="Person not found";c.innerHTML='<p class="empty">This person does not exist.</p>';return;}
 title.textContent=person.name;
 const list=Object.entries(transactions).filter(([,t])=>t.personId===personId).sort((a,b)=>sortValue(b[1]).localeCompare(sortValue(a[1]))||(b[1].createdAt||0)-(a[1].createdAt||0));
 let credit=0,debit=0;list.forEach(([,t])=>{if(type(t)==="credit")credit+=total(t);else if(type(t)==="debit")debit+=total(t);});
 document.getElementById("detailReceived").textContent="₹"+formatMoney(credit);
 document.getElementById("detailRepaid").textContent="₹"+formatMoney(debit);
 document.getElementById("detailBalance").textContent="₹"+formatMoney(credit-debit);
 c.innerHTML="";if(!list.length){c.innerHTML='<p class="empty">No transactions for this person.</p>';return;}
 const wrap=document.createElement("div");wrap.className="ledger-table-wrap";
 wrap.innerHTML='<table class="ledger-table"><thead><tr><th>Date</th><th>Time</th><th>Amt</th><th>Cmnt</th><th>Charges</th><th>Cmnt</th><th>Total</th><th>Cmnt</th><th>Purpose</th><th>Type</th><th>Platform</th><th>Actions</th></tr></thead><tbody></tbody></table>';
 const tbody=wrap.querySelector("tbody");
 list.forEach(([id,t])=>{
  const base=Number(t.amount)||0,cs=chargesOf(t),sum=chargeTotal(t),comments=cs.map(x=>x.comment).filter(Boolean).join("; "),chargeTextValue=cs.length?cs.map(x=>chargeText(x,base)).join(" • "):"₹0";
  const tr=document.createElement("tr");
  tr.innerHTML='<td>'+escapeHtml(t.date||"")+'</td><td>'+escapeHtml(fallbackTime(t))+'</td><td class="amount-cell">₹'+formatMoney(base)+'</td><td class="comment-cell" title="'+escapeHtml(t.amountComment||"")+'">'+escapeHtml(t.amountComment||"")+'</td><td class="charge-detail" title="'+escapeHtml(chargeTextValue)+'">₹'+formatMoney(sum)+(cs.length?"<small> ("+escapeHtml(chargeTextValue)+")</small>":"")+'</td><td class="comment-cell" title="'+escapeHtml(comments)+'">'+escapeHtml(comments)+'</td><td class="total-cell '+(type(t)==="credit"?"taken-text":type(t)==="debit"?"repaid-text":"")+'">'+(type(t)==="credit"?"+":type(t)==="debit"?"-":"")+"₹"+formatMoney(total(t))+'</td><td class="comment-cell" title="'+escapeHtml(t.description||"")+'">'+escapeHtml(t.description||"")+'</td><td>'+escapeHtml(t.purpose||"")+'</td><td><span class="type-badge '+type(t)+'">'+escapeHtml(typeLabel(t))+'</span></td><td><span class="platform-badge">'+escapeHtml(t.platform||t.method||"Other")+'</span></td><td class="action-cell"><button class="table-action edit-action" onclick="editDetailTransaction(\''+id+'\')">Edit</button><button class="table-action delete-action" onclick="deleteDetailTransaction(\''+id+'\')">Delete</button></td>';
  tbody.appendChild(tr);
 });
 c.appendChild(wrap);
}
function exportPdf(){
 if(!window.jspdf?.jsPDF)return alert("PDF export library is not loaded. Refresh and try again.");
 const list=Object.values(transactions).filter(t=>t.personId===personId).sort((a,b)=>sortValue(a).localeCompare(sortValue(b)));
 if(!list.length)return alert("No transactions to export.");
 const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:"landscape",unit:"pt",format:"a4"}),margin=28;
 doc.setFontSize(18);doc.setTextColor(23,32,51);doc.text((person?.name||"Person")+" - Payment Ledger",margin,30);
 doc.setFontSize(9);doc.setTextColor(100,110,125);doc.text("Generated: "+new Date().toLocaleString("en-IN"),margin,45);
 const rows=list.map(t=>{const base=Number(t.amount)||0,cs=chargesOf(t);return[t.date||"-",fallbackTime(t),"₹"+formatMoney(base),t.amountComment||"-",cs.length?cs.map(c=>chargeText(c,base)).join("\n"):"₹0",cs.map(c=>c.comment).filter(Boolean).join("; ")||"-","₹"+formatMoney(total(t)),t.description||"-",t.purpose||"-",typeLabel(t),t.platform||t.method||"Other"];});
 doc.autoTable({head:[["Date","Time","Amt","Amt Cmnt","Charges","Charge Cmnt","Total","Total Cmnt","Purpose","Type","Platform"]],body:rows,startY:58,margin:{left:margin,right:margin},theme:"grid",styles:{fontSize:7,cellPadding:3,overflow:"linebreak",valign:"middle"},headStyles:{fillColor:[23,32,51],textColor:[255,255,255],fontStyle:"bold",fontSize:7},alternateRowStyles:{fillColor:[247,249,251]},columnStyles:{0:{cellWidth:58},1:{cellWidth:38},2:{cellWidth:52},3:{cellWidth:68},4:{cellWidth:105},5:{cellWidth:75},6:{cellWidth:55},7:{cellWidth:72},8:{cellWidth:62},9:{cellWidth:55},10:{cellWidth:70}}});
 doc.save((person?.name||"person").replace(/[^a-z0-9]+/gi,"-").toLowerCase()+"-ledger-"+new Date().toISOString().slice(0,10)+".pdf");
}
document.getElementById("backBtn").addEventListener("click",()=>history.back());
document.getElementById("detailPdfBtn").addEventListener("click",exportPdf);
onValue(peopleRef,s=>{person=(s.val()||{})[personId]||null;render();});
onValue(transactionsRef,s=>{transactions=s.val()||{};render();});