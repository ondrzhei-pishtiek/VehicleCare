const API_URL = 'http://127.0.0.1:8000';
let currentCarId = null;
let currentCarData = null;
let currentIssues = [];
let expenseChartInstance = null;
let issuesPieChartInstance = null;
let base64Receipt = ""; // Для фото чеку

async function fetchAPI(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    if (!options.headers) options.headers = {};
    options.headers['Authorization'] = token;
    if(!(options.body instanceof FormData)) options.headers['Content-Type'] = 'application/json';
    const res = await fetch(API_URL + endpoint, options);
    if (res.status === 401) { logout(); return null; }
    return res;
}

document.addEventListener('DOMContentLoaded', () => {
    // Темна тема ініціалізація
    if(localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-theme');

    if(localStorage.getItem('token')) {
        document.getElementById('landingScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'flex';
        document.getElementById('userNameDisplay').textContent = localStorage.getItem('user');
        initApp();
    }
    setupAuth();
    setupThemeToggle();
});

function setupThemeToggle() {
    document.getElementById('themeToggleBtn').onclick = () => {
        document.body.classList.toggle('dark-theme');
        localStorage.setItem('theme', document.body.classList.contains('dark-theme') ? 'dark' : 'light');
        if(expenseChartInstance) loadAnalytics(); // Перемальовуємо графіки під тему
    };
}

function setupAuth() {
    const tL=document.getElementById('tabLogin'), tR=document.getElementById('tabRegister');
    const fL=document.getElementById('formLogin'), fR=document.getElementById('formRegister');
    tL.onclick = () => { tL.classList.add('active'); tR.classList.remove('active'); fL.style.display='block'; fR.style.display='none'; };
    tR.onclick = () => { tR.classList.add('active'); tL.classList.remove('active'); fR.style.display='block'; fL.style.display='none'; };

    document.getElementById('loginBtn').onclick = async () => {
        const u = document.getElementById('loginUser').value, p = document.getElementById('loginPass').value;
        const res = await fetch(`${API_URL}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:u, password:p}) });
        if(res.ok) { const data = await res.json(); localStorage.setItem('token', data.token); localStorage.setItem('user', data.user); location.reload(); }
        else alert("Невірний логін або пароль");
    };

    document.getElementById('registerBtn').onclick = async () => {
        const u = document.getElementById('regUser').value, p = document.getElementById('regPass').value;
        const res = await fetch(`${API_URL}/register`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:u, password:p}) });
        if(res.ok) { const data = await res.json(); localStorage.setItem('token', data.token); localStorage.setItem('user', data.user); location.reload(); }
        else alert("Користувач вже існує");
    };
}

function logout() { localStorage.removeItem('token'); localStorage.removeItem('user'); location.reload(); }

function initApp() {
    setupNavigation();
    setupModals();
    setupAIChat();
    loadGarageData();
}

function setupNavigation() {
    const links = document.querySelectorAll('#navMenu a');
    links.forEach(link => {
        link.onclick = (e) => {
            e.preventDefault();
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
            document.getElementById('view-' + link.dataset.view).classList.add('active');
            if(link.dataset.view === 'analytics') loadAnalytics();
        };
    });
}

// МОК TELEGRAM
window.mockTelegram = function() {
    alert("✅ Бот @VehicleCare_bot успішно підключено!\nТепер ви будете отримувати нагадування про ТО та критичні поломки прямо в Telegram.");
}

// АВТО ДЕКОДЕР VIN (Через NHTSA API)
window.decodeVIN = async function() {
    const vin = document.getElementById('carVin').value.trim();
    if(vin.length < 10) return alert("Введіть коректний VIN код!");
    try {
        const btn = event.target; btn.textContent = "Завантаження...";
        const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`);
        const data = await res.json();
        const results = data.Results;

        let make = "", model = "", year = "";
        results.forEach(r => {
            if(r.VariableId === 26) make = r.Value;
            if(r.VariableId === 28) model = r.Value;
            if(r.VariableId === 29) year = r.Value;
        });

        if(make && make !== "null") document.getElementById('carMake').value = make;
        if(model && model !== "null") document.getElementById('carModel').value = model;
        if(year && year !== "null") document.getElementById('carYear').value = year;

        btn.textContent = "Розшифрувати";
    } catch(e) { alert("Помилка сервісу розшифровки."); event.target.textContent = "Розшифрувати"; }
}

async function loadGarageData() {
    const res = await fetchAPI('/cars');
    if(!res) return;
    const cars = await res.json();
    const sel = document.getElementById('carSelector');
    sel.innerHTML = '';

    if (cars.length > 0) {
        cars.forEach(car => {
            const opt = document.createElement('option');
            opt.value = car.id; opt.textContent = `${car.make} ${car.model}`;
            sel.appendChild(opt);
        });
        currentCarId = cars[0].id;
        sel.onchange = (e) => {
            currentCarId = e.target.value;
            currentCarData = cars.find(c=>c.id==currentCarId);
            loadCarStats(currentCarData); loadIssues();
            if(document.getElementById('view-analytics').classList.contains('active')) loadAnalytics();
        };
        currentCarData = cars[0];
        loadCarStats(currentCarData);
        loadIssues();
    } else {
        document.getElementById('carInfoCard').innerHTML = "<h2>Гараж порожній</h2><p>Додайте своє перше авто!</p>";
        sel.style.display = 'none';
    }
}

function loadCarStats(car) {
    document.getElementById('carInfoCard').innerHTML = `
        <h2>${car.make} ${car.model} <i class="fas fa-edit edit-car-icon" onclick="openEditCarModal()" title="Редагувати"></i></h2>
        <p style="color: var(--text-muted); margin-bottom: 10px;">Рік: ${car.year} | Колір: ${car.color} | VIN: ${car.vin || 'Не вказано'}</p>
        <div class="badges">
            <span class="badge"><i class="fas fa-cogs"></i> ${car.engine}</span>
            <span class="badge"><i class="fas fa-hashtag"></i> ${car.license_plate}</span>
        </div>
    `;

    document.getElementById('uiMileage').textContent = `${car.current_mileage} км`;
    const nextService = car.last_service_mileage + 10000;
    const left = nextService - car.current_mileage;
    const sCard = document.getElementById('serviceCard');

    if (left > 0) {
        document.getElementById('uiNextService').textContent = `${left} км`;
        document.getElementById('uiNextService').style.color = 'var(--text-main)';
        document.getElementById('uiServiceText').textContent = 'До наступного ТО';
        sCard.style.borderTopColor = '#f59e0b';
        sCard.classList.remove('pulse-anim');
    } else {
        document.getElementById('uiNextService').textContent = `${Math.abs(left)} км`;
        document.getElementById('uiNextService').style.color = 'var(--critical)';
        document.getElementById('uiServiceText').textContent = 'ПРОТЕРМІНОВАНО ТО!';
        sCard.style.borderTopColor = 'var(--critical)';
        sCard.classList.add('pulse-anim');
    }
}

window.openCarModal = function() {
    document.getElementById('carModalTitle').textContent = "Додати автомобіль";
    document.getElementById('editCarId').value = "";
    document.getElementById('addCarForm').reset();
    document.getElementById('carModal').style.display = 'flex';
}

window.openEditCarModal = function() {
    if(!currentCarData) return;
    document.getElementById('carModalTitle').textContent = "Редагувати авто";
    document.getElementById('editCarId').value = currentCarData.id;
    document.getElementById('carMake').value = currentCarData.make;
    document.getElementById('carModel').value = currentCarData.model;
    document.getElementById('carEngine').value = currentCarData.engine;
    document.getElementById('carYear').value = currentCarData.year;
    document.getElementById('carColor').value = currentCarData.color;
    document.getElementById('carPlate').value = currentCarData.license_plate;
    document.getElementById('carVin').value = currentCarData.vin || "";
    document.getElementById('carMil').value = currentCarData.current_mileage;
    document.getElementById('carServMil').value = currentCarData.last_service_mileage;
    document.getElementById('carModal').style.display = 'flex';
}

window.openIssueModal = function(categoryText) {
    if(!currentCarData) return alert("Спочатку додайте авто!");
    if(categoryText) document.getElementById('issueCat').value = categoryText;
    document.getElementById('issueMil').value = currentCarData.current_mileage;
    base64Receipt = ""; // скидаємо фото
    document.getElementById('issueReceipt').value = "";
    document.getElementById('issueModal').style.display = 'flex';
}

// Конвертація файлу в Base64
document.getElementById('issueReceipt').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = function(event) { base64Receipt = event.target.result; };
    reader.readAsDataURL(file);
});

async function loadIssues() {
    if(!currentCarId) return;
    const res = await fetchAPI(`/cars/${currentCarId}/issues`);
    currentIssues = await res.json();

    const activeIssues = currentIssues.filter(i => !i.is_resolved);
    const resolvedIssues = currentIssues.filter(i => i.is_resolved);

    const list = document.getElementById('issuesList');
    list.innerHTML = '';
    let criticalCount = 0;

    if(activeIssues.length === 0) list.innerHTML = "<p style='color: var(--text-muted); text-align:center; padding:20px;'>Актуальних задач немає.</p>";

    activeIssues.forEach((i, idx) => {
        if(i.priority === 'Критично') criticalCount++;
        const isCrit = i.priority === 'Критично' ? 'critical' : '';
        const critTag = i.priority === 'Критично' ? '<span class="crit-tag">Критично</span>' : '';
        const imgTag = i.receipt_image ? `<i class="fas fa-image" style="color:var(--accent); margin-left:10px;" title="Є прикріплене фото"></i>` : '';

        list.insertAdjacentHTML('beforeend', `
            <div class="issue-item ${isCrit}" style="animation-delay: ${idx * 0.1}s">
                <div style="flex:1;">
                    <strong style="font-size: 1.1rem; display:block; margin-bottom:5px;">${i.category} ${imgTag}</strong>
                    <div class="issue-tags"><span>${i.issue_type}</span> ${critTag}</div>
                    <p style="margin-top:8px;">${i.description}</p>
                    <span class="issue-mil-tag"><i class="fas fa-road"></i> Пробіг: ${i.mileage_at_issue || 0} км</span>
                </div>
                <div style="display:flex; align-items:center;">
                    <input type="checkbox" style="width: 24px; height: 24px; cursor: pointer; accent-color: var(--success);" onchange="toggleIssue(${i.id})">
                    <button class="del-issue-btn" onclick="delIssue(${i.id})"><i class="fas fa-trash-alt"></i></button>
                </div>
            </div>
        `);
    });
    document.getElementById('uiHealth').textContent = criticalCount;
    document.getElementById('uiTotalIssues').textContent = currentIssues.length;

    // РЕНДЕР ІСТОРІЇ
    const timeline = document.getElementById('historyTimeline');
    timeline.innerHTML = '';
    if(resolvedIssues.length === 0) {
        timeline.innerHTML = "<p style='color: var(--text-muted);'>Історія порожня.</p>";
    } else {
        resolvedIssues.forEach((i, idx) => {
            const imgHtml = i.receipt_image ? `<br><img src="${i.receipt_image}" class="receipt-img" title="Клікніть для збільшення (наведіть)">` : '';
            timeline.insertAdjacentHTML('beforeend', `
                <div class="timeline-item" style="animation-delay: ${idx * 0.1}s">
                    <h4>${i.category} <span style="font-size:0.8rem; color: var(--success); margin-left:10px;"><i class="fas fa-check-circle"></i> Вирішено</span></h4>
                    <p>${i.description}</p>
                    ${imgHtml}
                    <div style="margin-top: 10px; font-size:0.85rem; color:var(--text-muted);">
                        <i class="fas fa-road"></i> Пробіг: ${i.mileage_at_issue || 0} км
                        <button class="add-btn" style="float:right; background:none; color:var(--accent); padding:0; box-shadow:none;" onclick="toggleIssue(${i.id})"><i class="fas fa-undo"></i></button>
                    </div>
                </div>
            `);
        });
    }
}

async function toggleIssue(id) { await fetchAPI(`/issues/${id}/toggle`, {method:'PUT'}); loadIssues(); }
async function delIssue(id) { if(confirm("Видалити запис?")) { await fetchAPI(`/issues/${id}`, {method:'DELETE'}); loadIssues(); } }

// === ЕКСПОРТ CSV ===
window.exportCSV = function() {
    if(currentIssues.length === 0) return alert("Немає даних для експорту!");
    let csv = "ID,Category,Description,Type,Priority,Status,Mileage,HasPhoto\n";
    currentIssues.forEach(i => {
        const status = i.is_resolved ? "Resolved" : "Active";
        const hasPhoto = i.receipt_image ? "Yes" : "No";
        // Екрануємо опис, якщо там є коми
        const desc = `"${i.description.replace(/"/g, '""')}"`;
        csv += `${i.id},${i.category},${desc},${i.issue_type},${i.priority},${status},${i.mileage_at_issue},${hasPhoto}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `VehicleCare_Export_${currentCarData.license_plate}.csv`;
    a.click();
}

// === АНАЛІТИКА ===
async function loadAnalytics() {
    if(!currentCarId) return;
    const resExp = await fetchAPI(`/cars/${currentCarId}/expenses`);
    const expenses = await resExp.json();

    const totalExp = expenses.reduce((sum, item) => sum + item.amount, 0);
    document.getElementById('uiTotalExpenses').textContent = `${totalExp.toLocaleString('uk-UA')} грн`;

    const labels = expenses.map(e => e.date);
    const data = expenses.map(e => e.amount);

    const textColor = document.body.classList.contains('dark-theme') ? '#f8fafc' : '#334155';

    if(expenseChartInstance) expenseChartInstance.destroy();
    expenseChartInstance = new Chart(document.getElementById('expenseChart').getContext('2d'), {
        type: 'line',
        data: { labels: labels.length ? labels : ['Пусто'], datasets: [{ label: 'Витрати (грн)', data: data.length ? data : [0], borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.2)', fill: true, tension: 0.4 }] },
        options: { responsive: true, maintainAspectRatio: false, color: textColor, scales: { x: { ticks:{color: textColor} }, y: { ticks:{color: textColor} } } }
    });

    const categoryCounts = {};
    currentIssues.forEach(i => { categoryCounts[i.category] = (categoryCounts[i.category] || 0) + 1; });
    const pieLabels = Object.keys(categoryCounts);
    const pieData = Object.values(categoryCounts);

    if(issuesPieChartInstance) issuesPieChartInstance.destroy();
    issuesPieChartInstance = new Chart(document.getElementById('issuesPieChart').getContext('2d'), {
        type: 'doughnut',
        data: { labels: pieLabels.length ? pieLabels : ['Немає'], datasets: [{ data: pieData.length ? pieData : [1], backgroundColor: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#64748b'] }] },
        options: { responsive: true, maintainAspectRatio: false, color: textColor, plugins: { legend: { position: 'right', labels: {color: textColor} } } }
    });
}

// === ГЕНЕРАЦІЯ PDF (ВИПРАВЛЕНО) ===
window.generatePDF = function() {
    if(!currentCarData || currentIssues.length === 0) return alert("Немає даних для формування заявки.");

    document.getElementById('pdfCarName').textContent = `${currentCarData.make} ${currentCarData.model}`;
    document.getElementById('pdfCarEngine').textContent = `${currentCarData.engine} / ${currentCarData.year} р.в.`;
    document.getElementById('pdfCarVin').textContent = currentCarData.vin || "Не вказано";
    document.getElementById('pdfCarPlate').textContent = currentCarData.license_plate;
    document.getElementById('pdfCarMileage').textContent = `${currentCarData.current_mileage} км`;

    const d = new Date();
    document.getElementById('pdfDate').textContent = `Сформовано: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;

    const tbody = document.getElementById('pdfIssuesBody');
    tbody.innerHTML = '';
    const unresolved = currentIssues.filter(i => !i.is_resolved);

    if(unresolved.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 10px;">Актуальних проблем не виявлено.</td></tr>';
    } else {
        unresolved.forEach((iss, idx) => {
            tbody.insertAdjacentHTML('beforeend', `
                <tr>
                    <td style="padding: 8px; border: 1px solid #ccc; text-align: center;">${idx + 1}</td>
                    <td style="padding: 8px; border: 1px solid #ccc; font-weight:bold;">${iss.category}</td>
                    <td style="padding: 8px; border: 1px solid #ccc;">${iss.description}</td>
                    <td style="padding: 8px; border: 1px solid #ccc; text-align:center;">${iss.issue_type}</td>
                </tr>
            `);
        });
    }

    const element = document.getElementById('pdfTemplate');
    const parentContainer = element.parentElement;

    // Робимо батьківський блок видимим перед генерацією PDF
    parentContainer.style.display = 'block';

    const opt = {
        margin: [10, 10, 15, 10],
        filename: `Service_Act_${currentCarData.license_plate}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).save().then(() => {
        // Ховаємо блок назад після завершення
        parentContainer.style.display = 'none';
    });
}

function setupModals() {
    document.getElementById('addIssueForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = {
            category: document.getElementById('issueCat').value, description: document.getElementById('issueDesc').value,
            issue_type: document.getElementById('issueType').value, priority: document.getElementById('issuePriority').value,
            mileage_at_issue: parseInt(document.getElementById('issueMil').value) || 0,
            receipt_image: base64Receipt
        };
        await fetchAPI(`/cars/${currentCarId}/issues`, {method:'POST', body:JSON.stringify(data)});
        document.getElementById('issueModal').style.display = 'none'; e.target.reset(); base64Receipt = ""; loadIssues();
    };

    document.getElementById('addCarForm').onsubmit = async (e) => {
        e.preventDefault();
        const editId = document.getElementById('editCarId').value;
        const data = {
            make: document.getElementById('carMake').value, model: document.getElementById('carModel').value,
            engine: document.getElementById('carEngine').value, year: parseInt(document.getElementById('carYear').value),
            color: document.getElementById('carColor').value, license_plate: document.getElementById('carPlate').value,
            vin: document.getElementById('carVin').value,
            current_mileage: parseInt(document.getElementById('carMil').value), last_service_mileage: parseInt(document.getElementById('carServMil').value)
        };

        if (editId) { await fetchAPI(`/cars/${editId}`, {method:'PUT', body:JSON.stringify(data)}); }
        else { await fetchAPI(`/cars`, {method:'POST', body:JSON.stringify(data)}); }

        document.getElementById('carModal').style.display = 'none'; e.target.reset(); loadGarageData();
    };

    document.getElementById('addExpenseForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = { amount: parseFloat(document.getElementById('expAmount').value), description: document.getElementById('expDesc').value, date: document.getElementById('expDate').value };
        await fetchAPI(`/cars/${currentCarId}/expenses`, {method:'POST', body:JSON.stringify(data)});
        document.getElementById('expenseModal').style.display = 'none'; e.target.reset();
        if(document.getElementById('view-analytics').classList.contains('active')) loadAnalytics();
    };
}

function setupAIChat() {
    const win = document.getElementById('aiChatWindow');
    const msgs = document.getElementById('aiMessages');
    const inp = document.getElementById('aiInput');
    const typingIndicator = document.getElementById('aiTypingIndicator');

    document.getElementById('aiOpenBtn').onclick = () => win.style.display = 'flex';
    document.getElementById('aiCloseBtn').onclick = () => win.style.display = 'none';

    // Очищення пам'яті ШІ
    document.getElementById('aiClearBtn').onclick = async () => {
        if(confirm("Очистити історію діалогу з ШІ?")) {
            await fetchAPI(`/ai-chat/clear`, { method:'POST' });
            msgs.innerHTML = '<div class="msg ai">Пам\'ять очищено. Почнемо з початку. Опишіть проблему.</div>';
            msgs.appendChild(typingIndicator); // Повертаємо індикатор в кінець
        }
    };

    document.getElementById('aiSendBtn').onclick = async () => {
        if(!inp.value || !currentCarId) return;

        // Відображення повідомлення користувача
        msgs.insertBefore(Object.assign(document.createElement('div'), {className: 'msg user', textContent: inp.value}), typingIndicator);
        const text = inp.value;
        inp.value = '';
        msgs.scrollTop = msgs.scrollHeight;

        // Показуємо індикатор завантаження
        typingIndicator.style.display = 'inline-flex';
        msgs.scrollTop = msgs.scrollHeight;

        try {
            const res = await fetchAPI(`/ai-chat`, { method:'POST', body: JSON.stringify({message: text, car_id: currentCarId}) });

            // Ховаємо індикатор
            typingIndicator.style.display = 'none';

            if(res) {
                const data = await res.json();
                msgs.insertBefore(Object.assign(document.createElement('div'), {className: 'msg ai', textContent: data.reply}), typingIndicator);
                msgs.scrollTop = msgs.scrollHeight;
                loadIssues(); // Оновлюємо гараж, бо ШІ міг викликати функцію і створити запис
            }
        } catch (error) {
            // Граціозна деградація при помилках мережі
            typingIndicator.style.display = 'none';
            msgs.insertBefore(Object.assign(document.createElement('div'), {className: 'msg ai', style: 'color: red;', textContent: "Помилка підключення до сервера."}), typingIndicator);
        }
    };

    inp.addEventListener("keypress", (e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById('aiSendBtn').click(); } });
}