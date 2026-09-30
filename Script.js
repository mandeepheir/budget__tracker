const CATEGORIES = ["Food", "Transport", "Entertainment", "Utilities", "Other"];
const $ = (id) => document.getElementById(id);
const sum = (list) => list.reduce((total, x) => total + x.amount, 0);
const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
const monthOf = (date) => date.slice(0, 7);

let uid = 0;
const newId = () => Date.now() * 1000 + (uid++ % 1000);

function showMessage(text) { $("msg").textContent = text; }

// ---------- Storage (every read/write is guarded, so bad data never breaks the app) ----------
const store = {
    get(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); }
        catch { showMessage("Could not save. Your browser may be blocking storage."); }
    },
};

// Also upgrades data saved by older versions (string amounts, no id, no date)
const normalize = (list) => (Array.isArray(list) ? list : []).map((x) => ({
    ...x, id: x.id ?? newId(), amount: Number(x.amount) || 0, date: x.date || today(),
}));

let expenses = normalize(store.get("expenses", []));
let incomes = normalize(store.get("incomes", []));
let budgets = store.get("budgets", {});
let settings = { theme: "light", currency: "USD", ...store.get("settings", {}) };
let month = monthOf(today());
let editId = null;

const saveData = () => { store.set("expenses", expenses); store.set("incomes", incomes); };
const money = (n) => new Intl.NumberFormat(undefined, { style: "currency", currency: settings.currency }).format(n);
const inMonth = (list) => list.filter((x) => monthOf(x.date) === month);

function shiftMonth(key, delta) {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function setMonth(key) {
    month = key;
    $("monthPicker").value = key;
    render();
}

// ---------- Small DOM helpers (text is always set with textContent, never innerHTML) ----------
function el(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}
function button(text, className, onClick) {
    const b = el("button", className, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
}
function fillList(ul, items, build, emptyText) {
    ul.replaceChildren();
    if (!items.length) { ul.append(el("li", "empty", emptyText)); return; }
    items.forEach((item) => ul.append(build(item)));
}

function row(item, { title, meta, dot, amount, positive, onEdit, onDelete }) {
    const li = el("li");
    const d = el("span", "dot");
    d.style.background = dot;
    const info = el("div", "info");
    info.append(el("strong", "", title), el("small", "muted", meta));
    const actions = el("span", "actions");
    if (onEdit) actions.append(button("Edit", "edit-btn", onEdit));
    actions.append(button("Delete", "delete-btn", onDelete));
    li.append(d, info, el("span", "amount " + (positive ? "pos" : "neg"), (positive ? "+" : "-") + money(amount)), actions);
    return li;
}

// ---------- Render ----------
function render() {
    const monthExpenses = inMonth(expenses);
    const monthIncomes = inMonth(incomes);
    const spent = sum(monthExpenses);
    const earned = sum(monthIncomes);
    const balance = earned - spent;

    $("incomeTotal").textContent = money(earned);
    $("total").textContent = money(spent);
    $("balance").textContent = money(balance);
    $("balanceCard").classList.toggle("negative", balance < 0);
    $("count").textContent = `(${monthExpenses.length})`;

    renderExpenses(monthExpenses);
    fillList($("incomeList"), monthIncomes.sort((a, b) => b.date.localeCompare(a.date)),
        (i) => row(i, { title: i.source, meta: i.date, dot: "var(--pos)", amount: i.amount, positive: true, onDelete: () => remove("incomes", i.id) }),
        "No income this month.");
    renderBudgets(monthExpenses);
    renderCharts(monthExpenses);
}

const SORTERS = {
    newest: (a, b) => b.date.localeCompare(a.date),
    oldest: (a, b) => a.date.localeCompare(b.date),
    high: (a, b) => b.amount - a.amount,
    low: (a, b) => a.amount - b.amount,
};

function renderExpenses(monthExpenses) {
    const query = $("search").value.trim().toLowerCase();
    const category = $("filterCategory").value;
    const visible = monthExpenses
        .filter((e) => (category === "All" || e.category === category) && e.name.toLowerCase().includes(query))
        .sort(SORTERS[$("sort").value]);
    fillList($("expenseList"), visible,
        (e) => row(e, {
            title: e.name, meta: `${e.date} · ${e.category}`, dot: `var(--c-${e.category.toLowerCase()})`,
            amount: e.amount, positive: false, onEdit: () => editExpense(e.id), onDelete: () => remove("expenses", e.id),
        }),
        monthExpenses.length ? "No expenses match your search." : "No expenses this month. Add your first one.");
}

function renderBudgets(monthExpenses) {
    const box = $("budgetBars");
    box.replaceChildren();
    const active = CATEGORIES.filter((c) => budgets[c] > 0);
    if (!active.length) { box.append(el("p", "muted", "Set a monthly limit for a category to track it here.")); return; }
    for (const c of active) {
        const spent = sum(monthExpenses.filter((e) => e.category === c));
        const pct = (spent / budgets[c]) * 100;
        const wrap = el("div", "bar-row");
        const label = el("div", "bar-label");
        label.append(el("span", "", c), el("span", pct >= 100 ? "neg" : "", `${money(spent)} of ${money(budgets[c])}`));
        const bar = el("div", "bar");
        const fill = el("div", pct >= 100 ? "over" : pct >= 80 ? "warn" : "");
        fill.style.width = Math.min(pct, 100) + "%";
        bar.append(fill);
        wrap.append(label, bar);
        box.append(wrap);
    }
}

// ---------- Charts ----------
let donut, bars;
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function renderCharts(monthExpenses) {
    if (typeof Chart === "undefined") return; // Chart.js did not load (offline?)
    Chart.defaults.color = cssVar("--muted");

    const totals = CATEGORIES.map((c) => sum(monthExpenses.filter((e) => e.category === c)));
    $("donutEmpty").hidden = totals.some((t) => t > 0);
    donut?.destroy();
    donut = new Chart($("donutChart"), {
        type: "doughnut",
        data: { labels: CATEGORIES, datasets: [{ data: totals, backgroundColor: CATEGORIES.map((c) => cssVar("--c-" + c.toLowerCase())), borderColor: cssVar("--surface"), borderWidth: 2 }] },
        options: { maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${money(c.parsed)}` } } } },
    });

    const keys = [-5, -4, -3, -2, -1, 0].map((n) => shiftMonth(month, n));
    const labels = keys.map((k) => new Date(k + "-01T00:00").toLocaleDateString(undefined, { month: "short" }));
    const monthly = keys.map((k) => sum(expenses.filter((e) => monthOf(e.date) === k)));
    bars?.destroy();
    bars = new Chart($("barChart"), {
        type: "bar",
        data: { labels, datasets: [{ data: monthly, borderRadius: 6, backgroundColor: keys.map((_, i) => (i === 5 ? cssVar("--accent") : cssVar("--line"))) }] },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => " " + money(c.parsed.y) } } },
            scales: { y: { beginAtZero: true, grid: { color: cssVar("--line") }, ticks: { callback: (v) => new Intl.NumberFormat(undefined, { notation: "compact" }).format(v) } }, x: { grid: { display: false } } },
        },
    });
}

// ---------- Income ----------
$("incomeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const source = $("incomeSource").value.trim();
    const amount = Number($("incomeAmount").value);
    const date = $("incomeDate").value;
    if (!source || !(amount > 0) || !date) return showMessage("Enter an income source, an amount above 0, and a date.");
    incomes.push({ id: newId(), source, amount, date });
    e.target.reset();
    $("incomeDate").value = today();
    showMessage("");
    saveData();
    setMonth(monthOf(date)); // jump to the month you just added to
});

// ---------- Expenses ----------
$("expenseForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const item = { name: $("expense").value.trim(), amount: Number($("amount").value), date: $("date").value, category: $("category").value };
    if (!item.name || !(item.amount > 0) || !item.date || !item.category)
        return showMessage("Fill in every expense field, with an amount above 0.");
    if (editId === null) expenses.push({ id: newId(), ...item });
    else expenses = expenses.map((x) => (x.id === editId ? { ...x, ...item } : x));
    stopEditing();
    saveData();
    setMonth(monthOf(item.date));
});

function editExpense(id) {
    const item = expenses.find((x) => x.id === id);
    if (!item) return;
    editId = id;
    $("expense").value = item.name;
    $("amount").value = item.amount;
    $("date").value = item.date;
    $("category").value = item.category;
    $("saveBtn").textContent = "Save changes";
    $("cancelBtn").hidden = false;
    showMessage("");
    $("expense").focus();
}

function stopEditing() {
    editId = null;
    $("expenseForm").reset();
    $("date").value = today();
    $("saveBtn").textContent = "Add expense";
    $("cancelBtn").hidden = true;
    showMessage("");
}

function remove(kind, id) {
    if (kind === "expenses") {
        if (id === editId) stopEditing();
        expenses = expenses.filter((x) => x.id !== id);
    } else {
        incomes = incomes.filter((x) => x.id !== id);
    }
    saveData();
    render();
}

// ---------- Budgets ----------
for (const c of CATEGORIES) {
    const label = el("label");
    const input = el("input");
    input.type = "number"; input.min = "0"; input.step = "0.01"; input.placeholder = "No limit";
    input.value = budgets[c] || "";
    input.setAttribute("aria-label", `${c} monthly budget`);
    input.addEventListener("change", () => {
        budgets[c] = Math.max(0, Number(input.value) || 0);
        store.set("budgets", budgets);
        render();
    });
    label.append(el("span", "", c), input);
    $("budgetInputs").append(label);
}

// ---------- Export CSV ----------
$("exportBtn").addEventListener("click", () => {
    const cell = (v) => {
        let text = String(v);
        if (/^[=+\-@]/.test(text)) text = "'" + text; // stop spreadsheets from running typed text as a formula
        return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = [["Type", "Date", "Name", "Category", "Amount"],
        ...expenses.map((e) => ["Expense", e.date, e.name, e.category, e.amount]),
        ...incomes.map((i) => ["Income", i.date, i.source, "", i.amount])];
    const link = el("a");
    link.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(",")).join("\n")], { type: "text/csv" }));
    link.download = "budget-tracker.csv";
    link.click();
    URL.revokeObjectURL(link.href);
});

// ---------- Settings, navigation, filters ----------
function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    $("themeBtn").textContent = settings.theme === "dark" ? "Light mode" : "Dark mode";
}
$("themeBtn").addEventListener("click", () => {
    settings.theme = settings.theme === "dark" ? "light" : "dark";
    store.set("settings", settings);
    applyTheme();
    render(); // redraw charts in the new colours
});
$("currency").addEventListener("change", (e) => {
    settings.currency = e.target.value;
    store.set("settings", settings);
    render();
});
$("prevMonth").addEventListener("click", () => setMonth(shiftMonth(month, -1)));
$("nextMonth").addEventListener("click", () => setMonth(shiftMonth(month, 1)));
$("monthPicker").addEventListener("change", (e) => e.target.value && setMonth(e.target.value));
$("cancelBtn").addEventListener("click", stopEditing);
["search", "filterCategory", "sort"].forEach((id) => $(id).addEventListener("input", () => renderExpenses(inMonth(expenses))));

// ---------- Start ----------
applyTheme();
$("currency").value = settings.currency;
$("date").value = today();
$("incomeDate").value = today();
setMonth(month);