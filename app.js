// --- 1. FIREBASE INITIALISIERUNG ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, where, orderBy, deleteDoc, doc, setDoc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// HIER DEINE FIREBASE DATEN EINTRAGEN:
const firebaseConfig = {
  apiKey: "AIzaSyDJyPP0XNh4SZxfT4EWZQPX2jtK-8M0tqU",
  authDomain: "ppsonline-648ba.firebaseapp.com",
  projectId: "ppsonline-648ba",
  storageBucket: "ppsonline-648ba.firebasestorage.app",
  messagingSenderId: "739532566067",
  appId: "1:739532566067:web:4ec1c1705f1344b9e73d46"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUserData = null;
let isDevModeActive = false; // Verhindert UI-Bugs
const FAKE_DOMAIN = "@familiensystem.local";

// --- KALENDER LOGIK ---
function getISOWeekInfo(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return { year: d.getUTCFullYear(), week: Math.ceil((((d - yearStart) / 86400000) + 1) / 7) };
}
function getBillingMonth(date) {
    const d = new Date(date);
    const sunday = new Date(d.setDate(d.getDate() + (d.getDay() === 0 ? 0 : 7 - d.getDay())));
    return `${sunday.getFullYear()}-${(sunday.getMonth() + 1).toString().padStart(2, '0')}`;
}
const currentWeekString = `${getISOWeekInfo(new Date()).year}-W${getISOWeekInfo(new Date()).week.toString().padStart(2, '0')}`;
const currentBillingMonth = getBillingMonth(new Date());

// --- UI ANSICHTEN STEUERUNG (Das behebt den Overlap-Bug!) ---
function switchView(targetViewId) {
    const views = ['view-login', 'view-dev-login', 'view-dev-dashboard', 'view-user-dashboard'];
    views.forEach(v => document.getElementById(v).classList.add('hidden'));
    document.getElementById(targetViewId).classList.remove('hidden');
}

// Dark Mode
document.getElementById('theme-toggle').addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    document.body.setAttribute('data-theme', isDark ? 'light' : 'dark');
});

// --- ENTWICKLER ZUGANG ---
document.getElementById('btn-show-dev-login').addEventListener('click', () => switchView('view-dev-login'));
document.getElementById('btn-cancel-dev').addEventListener('click', () => switchView('view-login'));

document.getElementById('dev-login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (document.getElementById('dev-password').value === 'ppsgeheim') {
        isDevModeActive = true;
        document.getElementById('dev-password').value = '';
        switchView('view-dev-dashboard');
        loadDevChores();
    } else {
        document.getElementById('dev-login-error').classList.remove('hidden');
    }
});

document.getElementById('btn-exit-dev').addEventListener('click', () => {
    isDevModeActive = false;
    switchView('view-login');
});

// --- LOGIN & AUTH STATUS ---
onAuthStateChanged(auth, async (user) => {
    // Wenn Entwickler-Modus an ist, ignorieren wir Firebase-Auto-Logins, um das UI nicht zu zerschießen!
    if (isDevModeActive) return; 

    if (user) {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            currentUserData = { uid: user.uid, ...userDoc.data() };
            initDashboard();
        }
    } else {
        currentUserData = null;
        switchView('view-login');
    }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim().toLowerCase();
    const password = document.getElementById('password').value;
    try {
        await signInWithEmailAndPassword(auth, username + FAKE_DOMAIN, password);
        document.getElementById('login-error').classList.add('hidden');
    } catch (error) {
        document.getElementById('login-error').classList.remove('hidden');
    }
});
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

// --- NUTZER DASHBOARD INIT ---
async function initDashboard() {
    switchView('view-user-dashboard');
    document.getElementById('display-name').innerText = currentUserData.username.toUpperCase();
    document.getElementById('user-avatar').innerText = currentUserData.username.charAt(0).toUpperCase();
    document.getElementById('user-role-badge').innerText = currentUserData.role === 'adult' ? 'Verwalter' : 'Kind';
    
    if(currentUserData.role === 'adult') {
        document.getElementById('admin-nav-item').classList.remove('hidden');
    } else {
        document.getElementById('admin-nav-item').classList.add('hidden');
    }

    await loadChoresCatalog();
    await loadStatsAndFeed(); 
}

// Tabs im Dashboard
document.querySelectorAll('.side-nav .nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.side-nav .nav-item').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const targetId = e.target.getAttribute('data-target');
        document.querySelectorAll('.tab-section').forEach(sec => sec.classList.add('hidden'));
        document.getElementById(targetId).classList.remove('hidden');
        
        if(targetId === 'tab-admin') {
            loadAdminHistory();
            loadAdultConfig();
        }
    });
});

// --- AUFGABEN KATALOG & EINTRAGEN ---
let globalChoresCache = []; // Speichert Aufgaben für das Erwachsenen-Dropdown

async function loadChoresCatalog() {
    const q = query(collection(db, "chores"), orderBy("points", "asc"));
    const snapshot = await getDocs(q);
    globalChoresCache = [];
    
    const quickGrid = document.getElementById('list-quick-chores');
    const heavyGrid = document.getElementById('list-heavy-chores');
    quickGrid.innerHTML = ''; heavyGrid.innerHTML = '';

    snapshot.forEach(docSnap => {
        const chore = { id: docSnap.id, ...docSnap.data() };
        globalChoresCache.push(chore);
        const el = document.createElement('div');
        el.className = 'chore-item';
        el.innerHTML = `<span class="chore-name">${chore.name}</span><span class="chore-pts">${chore.points} Pkt</span>`;
        el.addEventListener('click', () => logChore(chore.name, chore.points, currentUserData.uid, currentUserData.username));

        if(chore.points <= 2) quickGrid.appendChild(el);
        else heavyGrid.appendChild(el);
    });
}

// Die eigentliche Eintragen-Funktion
async function logChore(choreName, chorePoints, targetUid, targetUsername) {
    const logEntry = {
        userId: targetUid, username: targetUsername, choreName: choreName,
        points: Number(chorePoints), timestamp: new Date().toISOString(),
        week: currentWeekString, billingMonth: currentBillingMonth
    };
    try {
        await addDoc(collection(db, "logs"), logEntry);
        await loadStatsAndFeed(); 
        alert("Wurde eingetragen!");
    } catch (e) { alert("Fehler beim Eintragen!"); }
}

// --- STATISTIKEN, STRAFEN & 3-TAGES-FEED ---
async function loadStatsAndFeed() {
    const qAll = query(collection(db, "logs"), orderBy("timestamp", "desc"));
    const snapshotAll = await getDocs(qAll);
    let allLogs = [];
    snapshotAll.forEach(doc => allLogs.push({ id: doc.id, ...doc.data() }));

    // 1. Der 3-Tages-Feed (Rechte Seitenleiste)
    const feedContainer = document.getElementById('recent-logs-feed');
    feedContainer.innerHTML = '';
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    allLogs.filter(l => new Date(l.timestamp) >= threeDaysAgo).slice(0, 15).forEach(log => {
        const d = new Date(log.timestamp);
        const timeStr = d.toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'});
        // Farbklasse je nach Punkten
        let colorClass = `color-pt-${Math.min(log.points, 5)}`; 
        feedContainer.innerHTML += `
            <div class="feed-item ${colorClass}">
                <div><strong>${log.username.toUpperCase()}</strong>: ${log.choreName}</div>
                <div class="feed-time">${timeStr}</div>
            </div>
        `;
    });

    // 2. Persönliche Historie
    let myLogs = allLogs.filter(log => log.userId === currentUserData.uid);
    const histBody = document.getElementById('personal-history-body');
    histBody.innerHTML = '';
    myLogs.slice(0, 5).forEach(log => {
        histBody.innerHTML += `<tr>
            <td><strong>${log.choreName}</strong> <span class="text-muted">(${log.points} Pkt)</span></td>
            <td style="text-align:right"><button class="btn-delete" onclick="deleteLog('${log.id}')">Löschen</button></td>
        </tr>`;
    });

    // 3. Fortschritt (Kinder)
    if(currentUserData.role === 'child') {
        document.getElementById('progress-container').classList.remove('hidden');
        const quota = Number(currentUserData.quota);
        document.getElementById('pts-goal').innerText = quota;

        let currentPts = myLogs.filter(l => l.week === currentWeekString).reduce((sum, l) => sum + l.points, 0);
        document.getElementById('pts-current').innerText = currentPts;
        document.getElementById('progress-fill').style.width = Math.min((currentPts / quota) * 100, 100) + '%';

        let monthLogs = allLogs.filter(l => l.billingMonth === currentBillingMonth);
        let weeksInMonth = [...new Set(monthLogs.map(l => l.week))];
        if(weeksInMonth.length === 0) weeksInMonth = [currentWeekString];
        let weeksMetTarget = 0;
        let pointsPerWeek = {};
        myLogs.forEach(l => { pointsPerWeek[l.week] = (pointsPerWeek[l.week] || 0) + l.points; });
        weeksInMonth.forEach(w => { if((pointsPerWeek[w] || 0) >= quota) weeksMetTarget++; });

        let requiredWeeks = weeksInMonth.length === 5 ? 4 : 3; 
        if(weeksInMonth.length < 3) requiredWeeks = 0; 

        const alertBox = document.getElementById('alert-banner');
        if (weeksMetTarget < requiredWeeks && requiredWeeks > 0) {
            alertBox.classList.remove('hidden');
            document.getElementById('alert-message').innerText = `⚠️ Ziel nicht erreicht! Konsequenz: ${currentUserData.penalty}`;
        } else {
            alertBox.classList.add('hidden');
        }
    }

    // 4. Ranking
    let ptsUser = {};
    allLogs.filter(l => l.billingMonth === currentBillingMonth).forEach(log => { 
        ptsUser[log.username] = (ptsUser[log.username] || 0) + log.points; 
    });
    let sortedUsers = Object.keys(ptsUser).sort((a,b) => ptsUser[b] - ptsUser[a]);
    const lb = document.getElementById('leaderboard-list');
    lb.innerHTML = '';
    sortedUsers.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤';
        lb.innerHTML += `<li><span>${medal} ${user.toUpperCase()}</span> <span style="color:var(--primary)">${ptsUser[user]} Pkt.</span></li>`;
    });
}


// --- ERWACHSENE: KONTROLLE & NACHTRAGEN ---
async function loadAdultConfig() {
    const qKids = query(collection(db, "users"));
    const snap = await getDocs(qKids);
    const container = document.getElementById('admin-kids-list');
    const userSelect = document.getElementById('override-user');
    const choreSelect = document.getElementById('override-chore');
    
    container.innerHTML = ''; userSelect.innerHTML = '<option value="">Familienmitglied wählen...</option>';
    
    // Dropdowns füllen
    snap.forEach(docSnap => {
        const user = {id: docSnap.id, ...docSnap.data()};
        userSelect.innerHTML += `<option value="${user.id}|${user.username}">${user.username.toUpperCase()}</option>`;
        
        if(user.role === 'child') {
            container.innerHTML += `
                <div style="background: var(--bg-color); padding: 15px; margin-bottom: 10px; border-radius: 8px;">
                    <h4>${user.username.toUpperCase()}</h4>
                    <div style="display:flex; gap:10px; margin-top:5px;">
                        <input type="number" id="quota-${user.id}" value="${user.quota}" placeholder="Wochenziel" style="width: 100px; margin:0;">
                        <input type="text" id="penalty-${user.id}" value="${user.penalty}" placeholder="Strafe" style="margin:0;">
                        <button class="btn-primary" onclick="updateKid('${user.id}')" style="width: auto;">Speichern</button>
                    </div>
                </div>
            `;
        }
    });

    choreSelect.innerHTML = '<option value="">Aufgabe wählen...</option>';
    globalChoresCache.forEach(c => {
        choreSelect.innerHTML += `<option value="${c.name}|${c.points}">${c.name} (${c.points} Pkt)</option>`;
    });
}

// Aufgabe für andere eintragen
document.getElementById('adult-override-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userVals = document.getElementById('override-user').value.split('|'); // [uid, username]
    const choreVals = document.getElementById('override-chore').value.split('|'); // [name, points]
    if(userVals.length===2 && choreVals.length===2) {
        await logChore(choreVals[0], choreVals[1], userVals[0], userVals[1]);
        e.target.reset();
        loadAdminHistory();
    }
});

window.updateKid = async function(userId) {
    const newQuota = document.getElementById(`quota-${userId}`).value;
    const newPenalty = document.getElementById(`penalty-${userId}`).value;
    await updateDoc(doc(db, "users", userId), { quota: Number(newQuota), penalty: newPenalty });
    alert("Limit erfolgreich aktualisiert!");
};

window.deleteLog = async function(docId) {
    if(confirm("Eintrag wirklich löschen?")) {
        await deleteDoc(doc(db, "logs", docId));
        await loadStatsAndFeed();
        if(currentUserData && currentUserData.role === 'adult' && !document.getElementById('tab-admin').classList.contains('hidden')) {
            loadAdminHistory();
        }
    }
}

async function loadAdminHistory() {
    const qAll = query(collection(db, "logs"), orderBy("timestamp", "desc"));
    const snap = await getDocs(qAll);
    const tbody = document.getElementById('admin-history-body');
    tbody.innerHTML = '';
    snap.forEach(docSnap => {
        const log = docSnap.data();
        const d = new Date(log.timestamp);
        tbody.innerHTML += `<tr>
            <td><strong>${log.username.toUpperCase()}</strong>: ${log.choreName}</td>
            <td>${d.toLocaleDateString('de-DE')}</td>
            <td><button class="btn-delete" onclick="deleteLog('${docSnap.id}')">Löschen</button></td>
        </tr>`;
    });
}

// --- ENTWICKLER: KONTEN & AUFGABEN VERWALTEN ---
document.getElementById('admin-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('adm-username').value.trim().toLowerCase();
    const pwd = document.getElementById('adm-password').value;
    try {
        // Firebase Auth erstellen
        const newCred = await createUserWithEmailAndPassword(auth, username + FAKE_DOMAIN, pwd);
        // Da Entwickler-Modus aktiv ist, stört uns das automatische Login nicht.
        // Wir speichern die Daten und loggen den unsichtbaren Auth-User sofort wieder aus.
        await setDoc(doc(db, "users", newCred.user.uid), {
            username: username, role: document.getElementById('adm-role').value,
            quota: Number(document.getElementById('adm-quota').value), penalty: document.getElementById('adm-penalty').value
        });
        await signOut(auth); // Verhindert Geister-Sessions
        alert(`Erfolg: Konto ${username} wurde erstellt!`);
        e.target.reset();
    } catch (err) { alert("Fehler: " + err.message); }
});

document.getElementById('admin-chore-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await addDoc(collection(db, "chores"), { 
            name: document.getElementById('chore-name').value, points: Number(document.getElementById('chore-points').value) 
        });
        alert("Neue Aufgabe gespeichert!");
        e.target.reset();
        loadDevChores(); 
    } catch (err) { alert("Fehler: " + err.message); }
});

async function loadDevChores() {
    const q = query(collection(db, "chores"), orderBy("points", "asc"));
    const snapshot = await getDocs(q);
    const list = document.getElementById('dev-chore-list');
    list.innerHTML = '';
    snapshot.forEach(docSnap => {
        const chore = docSnap.data();
        list.innerHTML += `
            <li>
                <span><strong>${chore.name}</strong> (${chore.points} Pkt)</span>
                <div>
                    <button class="btn-edit" onclick="editChore('${docSnap.id}', '${chore.name}', ${chore.points})">✏️ Bearbeiten</button>
                    <button class="btn-delete" onclick="deleteChore('${docSnap.id}')">🗑️ Löschen</button>
                </div>
            </li>
        `;
    });
}

window.deleteChore = async function(id) {
    if(confirm("Aufgabe wirklich aus dem System löschen?")) {
        await deleteDoc(doc(db, "chores", id));
        alert("Gelöscht!");
        loadDevChores(); 
    }
}

window.editChore = async function(id, oldName, oldPoints) {
    const newName = prompt(`Neuer Name für die Aufgabe:`, oldName);
    if(newName === null || newName.trim() === "") return;
    const newPoints = prompt(`Neue Punktzahl für "${newName}":`, oldPoints);
    if(newPoints !== null && !isNaN(newPoints) && newPoints.trim() !== "") {
        await updateDoc(doc(db, "chores", id), { name: newName, points: Number(newPoints) });
        alert("Erfolgreich geändert!");
        loadDevChores();
    }
}
