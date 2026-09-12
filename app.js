import {
    db,
    ref,
    push,
    set,
    remove,
    onValue
} from "./firebase.js";


// ===============================
// GLOBAL DATA
// ===============================

let people = {};
let transactions = {};


// ===============================
// FIREBASE REFERENCES
// ===============================

const peopleRef = ref(db, "mypayments/people");
const transactionsRef = ref(db, "mypayments/transactions");


// ===============================
// ADD PERSON
// ===============================

window.addPerson = async function () {

    const input = document.getElementById("personName");

    const name = input.value.trim();

    if (!name) {
        alert("Enter a name");
        return;
    }

    const newPersonRef = push(peopleRef);

    await set(newPersonRef, {
        name: name,
        createdAt: Date.now()
    });

    input.value = "";
};


// ===============================
// LOAD PEOPLE
// ===============================

onValue(peopleRef, (snapshot) => {

    people = snapshot.val() || {};

    displayPeople();
    updatePersonDropdowns();
    updateDashboard();

});


// ===============================
// LOAD TRANSACTIONS
// ===============================

onValue(transactionsRef, (snapshot) => {

    transactions = snapshot.val() || {};

    displayTransactions();
    updateDashboard();

});


// ===============================
// DISPLAY PEOPLE
// ===============================

function displayPeople() {

    const container =
        document.getElementById("peopleList");

    container.innerHTML = "";

    const personIds = Object.keys(people);

    if (personIds.length === 0) {

        container.innerHTML =
            "<p>No people added yet.</p>";

        return;
    }


    personIds.forEach(personId => {

        const person = people[personId];

        const balance =
            getPersonBalance(personId);


        const div =
            document.createElement("div");

        div.className = "person";

        div.innerHTML = `
            <div>
                <div class="person-name">
                    ${escapeHtml(person.name)}
                </div>
            </div>

            <div class="balance">
                ₹${formatMoney(balance)}
            </div>
        `;

        container.appendChild(div);

    });

}


// ===============================
// PERSON DROPDOWNS
// ===============================

function updatePersonDropdowns() {

    const transactionPerson =
        document.getElementById("transactionPerson");

    const filterPerson =
        document.getElementById("filterPerson");


    transactionPerson.innerHTML =
        `<option value="">Select person</option>`;

    filterPerson.innerHTML =
        `<option value="all">All people</option>`;


    Object.keys(people).forEach(personId => {

        const person = people[personId];


        const option1 =
            document.createElement("option");

        option1.value = personId;

        option1.textContent = person.name;

        transactionPerson.appendChild(option1);


        const option2 =
            document.createElement("option");

        option2.value = personId;

        option2.textContent = person.name;

        filterPerson.appendChild(option2);

    });

}


// ===============================
// ADD TRANSACTION
// ===============================

document
    .getElementById("transactionForm")
    .addEventListener("submit", async (event) => {

        event.preventDefault();


        const personId =
            document.getElementById("transactionPerson").value;

        const date =
            document.getElementById("transactionDate").value;

        const type =
            document.getElementById("transactionType").value;

        const amount =
            Number(document.getElementById("amount").value);

        const charge =
            Number(document.getElementById("charge").value) || 0;

        const method =
            document.getElementById("method").value;

        const description =
            document.getElementById("description").value.trim();


        if (!personId) {

            alert("Select a person");

            return;
        }


        if (!amount || amount <= 0) {

            alert("Enter a valid amount");

            return;
        }


        const newTransactionRef =
            push(transactionsRef);


        await set(newTransactionRef, {

            personId: personId,

            date: date,

            type: type,

            amount: amount,

            charge: charge,

            method: method,

            description: description,

            createdAt: Date.now()

        });


        document
            .getElementById("transactionForm")
            .reset();


        // Default date to today

        setToday();

    });


// ===============================
// DISPLAY TRANSACTIONS
// ===============================

function displayTransactions() {

    const container =
        document.getElementById("transactionsList");

    const filter =
        document.getElementById("filterPerson").value;


    container.innerHTML = "";


    let list =
        Object.entries(transactions);


    if (filter !== "all") {

        list = list.filter(([id, transaction]) =>
            transaction.personId === filter
        );

    }


    list.sort((a, b) => {

        return new Date(b[1].date) -
               new Date(a[1].date);

    });


    if (list.length === 0) {

        container.innerHTML =
            "<p>No transactions found.</p>";

        return;
    }


    list.forEach(([id, transaction]) => {

        const person =
            people[transaction.personId];

        const personName =
            person ? person.name : "Unknown";


        const baseAmount =
            Number(transaction.amount) || 0;

        const charge =
            Number(transaction.charge) || 0;


        let total = baseAmount;


        if (transaction.type === "taken") {

            total += charge;

        }


        const sign =
            transaction.type === "taken"
                ? "+"
                : "-";


        const div =
            document.createElement("div");

        div.className = "transaction";


        div.innerHTML = `

            <div class="transaction-info">

                <div class="transaction-date">
                    ${transaction.date}
                </div>

                <div class="transaction-description">
                    ${escapeHtml(
                        transaction.description ||
                        transaction.method ||
                        transaction.type
                    )}
                </div>

                <div class="transaction-meta">

                    ${escapeHtml(personName)}
                    •
                    ${escapeHtml(transaction.method)}

                    ${
                        charge > 0
                        ? ` • Charge ₹${formatMoney(charge)}`
                        : ""
                    }

                </div>

            </div>


            <div class="
                transaction-amount
                ${transaction.type}
            ">

                ${sign}₹${formatMoney(total)}

            </div>


            <button
                class="delete-btn"
                onclick="deleteTransaction('${id}')"
            >
                Delete
            </button>

        `;


        container.appendChild(div);

    });

}


// ===============================
// DELETE TRANSACTION
// ===============================

window.deleteTransaction = async function (id) {

    const confirmDelete =
        confirm("Delete this transaction?");


    if (!confirmDelete) {
        return;
    }


    const transactionRef =
        ref(db, `mypayments/transactions/${id}`);


    await remove(transactionRef);

};


// ===============================
// CALCULATE PERSON BALANCE
// ===============================

function getPersonBalance(personId) {

    let balance = 0;


    Object.values(transactions).forEach(transaction => {

        if (transaction.personId !== personId) {
            return;
        }


        const amount =
            Number(transaction.amount) || 0;

        const charge =
            Number(transaction.charge) || 0;


        if (transaction.type === "taken") {

            balance += amount + charge;

        } else {

            balance -= amount;

        }

    });


    return balance;

}


// ===============================
// DASHBOARD
// ===============================

function updateDashboard() {

    let totalTaken = 0;

    let totalRepaid = 0;


    Object.values(transactions).forEach(transaction => {

        const amount =
            Number(transaction.amount) || 0;

        const charge =
            Number(transaction.charge) || 0;


        if (transaction.type === "taken") {

            totalTaken += amount + charge;

        } else {

            totalRepaid += amount;

        }

    });


    const outstanding =
        totalTaken - totalRepaid;


    document.getElementById("totalTaken")
        .textContent =
        `₹${formatMoney(totalTaken)}`;


    document.getElementById("totalRepaid")
        .textContent =
        `₹${formatMoney(totalRepaid)}`;


    document.getElementById("totalOutstanding")
        .textContent =
        `₹${formatMoney(outstanding)}`;


    displayPeople();

}


// ===============================
// FILTER
// ===============================

document
    .getElementById("filterPerson")
    .addEventListener("change", () => {

        displayTransactions();

    });


// ===============================
// HELPERS
// ===============================

function formatMoney(number) {

    return Number(number)
        .toLocaleString("en-IN", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        });

}


function escapeHtml(text) {

    const div =
        document.createElement("div");

    div.textContent = text;

    return div.innerHTML;

}


function setToday() {

    const today =
        new Date().toISOString().split("T")[0];

    document.getElementById("transactionDate")
        .value = today;

}


setToday();
