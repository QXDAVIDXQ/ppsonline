// --- 1. FIREBASE INITIALISIERUNG ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, where, orderBy, deleteDoc, doc, setDoc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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
const FAKE_DOMAIN = "@familiensystem.local";

// --- KALENDER LOGIK ---
function getISOWeekInfo(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week: weekNo };
}
function getBillingMonth(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diffToSunday = day === 0 ? 0 : 7 - day;
    const sunday = new Date(d.setDate(d.getDate() + diffToSunday));
    return `${sunday.getFullYear()}-${(sunday.getMonth() + 1).toString().padStart(2, '0')}`;
}
const currentDate = new Date();
const currentWeekString = `${getISOWeekInfo(currentDate).year}-W${getISOWeekInfo(currentDate).week.toString().padStart(2, '0')}`;
const currentBillingMonth = getBillingMonth(currentDate);

// --- UI ELEMENTE ---
const loginContainer = document.getElementById('login-container');
const devLoginContainer = document.getElementById('dev-login-container');
const devDashboard = document.getElementById('dev-dashboard');
const dashboardContainer = document.getElementById('dashboard-container');

document.getElementById('theme-toggle').addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    document.body.setAttribute('data-theme', isDark ? 'light' : 'dark');
});

// --- ENTWICKLER ZUGANG ---
document.getElementById('btn-show-dev-login').addEventListener('click', () => {
    loginContainer.classList.add('hidden');
    devLoginContainer.classList.remove('hidden');
});
document.getElementById('btn-cancel-dev').addEventListener('click', () => {
    devLoginContainer.classList.add('hidden');
    loginContainer.classList.remove('hidden');
    document.getElementById('dev-login-error').classList.add('hidden');
});
document.getElementById('dev-login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (document.getElementById('dev-password').value === 'ppsgeheim') {
        devLoginContainer.classList.add('hidden');
        devDashboard.classList.remove('hidden');
        document.getElementById('dev-password').value = '';
        loadDevChores(); // Aufgaben für Entwickler laden
    } else {
        document.getElementById('dev-login-error').classList.remove('hidden');
    }
});
document.getElementById('btn-exit-dev').addEventListener('click', () => {
    devDashboard.classList.add('hidden');
    loginContainer.classList.remove('hidden');
});

// --- LOGIN ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            currentUserData = { uid: user.uid, ...userDoc.data() };
            initDashboard();
        }
    } else {
        currentUserData = null;
        dashboardContainer.classList.add('hidden');
        devDashboard.classList.add('hidden');
        devLoginContainer.classList.add('hidden');
        loginContainer.classList.remove('hidden');
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

// --- DASHBOARD ---
async function initDashboard() {
    loginContainer.classList.add('hidden');
    dashboardContainer.classList.remove('hidden');
    
    document.getElementById('display-name').innerText = currentUserData.username.toUpperCase();
    document.getElementById('user-avatar').innerText = currentUserData.username.charAt(0).toUpperCase();
    document.getElementById('user-role-badge').innerText = currentUserData.role === 'adult' ? 'Verwalter' : 'Kind';
    
    if(currentUserData.role === 'adult') {
        document.getElementById('admin-nav-item').classList.remove('hidden');
    } else {
        document.getElementById('admin-nav-item').classList.add('hidden');
    }

    await loadChoresCatalog();
    await loadStats(); 
}

document.querySelectorAll('.side-nav .nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.side-nav .nav-item').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const targetId = e.target.getAttribute('data-target');
        document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
        document.getElementById(targetId).classList.remove('hidden');
        
        if(targetId === 'view-admin') {
            loadAdminHistory();
            loadAdminKidsConfig(); // Lädt die Kinder für Erwachsene
        }
    });
});

// --- AUFGABEN EINTRAGEN ---
async function loadChoresCatalog() {
    const q = query(collection(db, "chores"), orderBy("points", "asc"));
    const snapshot = await getDocs(q);
    
    const quickGrid = document.getElementById('list-quick-chores');
    const heavyGrid = document.getElementById('list-heavy-chores');
    quickGrid.innerHTML = ''; heavyGrid.innerHTML = '';

    snapshot.forEach(docSnap => {
        const chore = { id: docSnap.id, ...docSnap.data() };
        const el = document.createElement('div');
        el.className = 'chore-item';
        el.innerHTML = `<span class="chore-name">${chore.name}</span><span class="chore-pts">${chore.points} Pkt</span>`;
        el.addEventListener('click', () => logChore(chore));

        if(chore.points <= 2) quickGrid.appendChild(el);
        else heavyGrid.appendChild(el);
    });
}

async function logChore(chore) {
    const logEntry = {
        userId: currentUserData.uid, username: currentUserData.username, choreName: chore.name,
        points: Number(chore.points), timestamp: new Date().toISOString(),
        week: currentWeekString, billingMonth: currentBillingMonth
    };
    try {
        await addDoc(collection(db, "logs"), logEntry);
        await loadStats(); 
    } catch (e) { alert("Fehler beim Eintragen!"); }
}

// --- STATISTIKEN & STRAF-LOGIK (3 von 4 oder 4 von 5) ---
async function loadStats() {
    const qMonth = query(collection(db, "logs"), where("billingMonth", "==", currentBillingMonth));
    const snapshotMonth = await getDocs(qMonth);
    let allLogs = [];
    snapshotMonth.forEach(doc => allLogs.push({ id: doc.id, ...doc.data() }));

    let myLogs = allLogs.filter(log => log.userId === currentUserData.uid).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    const histBody = document.getElementById('personal-history-body');
    histBody.innerHTML = '';
    myLogs.slice(0, 5).forEach(log => {
        const d = new Date(log.timestamp);
        histBody.innerHTML += `<tr>
            <td><strong>${log.choreName}</strong> <span class="text-muted">(${log.points} Pkt)</span></td>
            <td style="text-align:right"><button class="btn-delete" onclick="deleteLog('${log.id}')">Löschen</button></td>
        </tr>`;
    });

    if(currentUserData.role === 'child') {
        document.getElementById('progress-container').classList.remove('hidden');
        const quota = Number(currentUserData.quota);
        document.getElementById('pts-goal').innerText = quota;

        let currentPts = myLogs.filter(l => l.week === currentWeekString).reduce((sum, l) => sum + l.points, 0);
        document.getElementById('pts-current').innerText = currentPts;
        document.getElementById('progress-fill').style.width = Math.min((currentPts / quota) * 100, 100) + '%';

        let weeksInMonth = [...new Set(allLogs.map(l => l.week))];
        if(weeksInMonth.length === 0) weeksInMonth = [currentWeekString];
        let weeksMetTarget = 0;
        let pointsPerWeek = {};
        myLogs.forEach(l => { pointsPerWeek[l.week] = (pointsPerWeek[l.week] || 0) + l.points; });
        weeksInMonth.forEach(w => { if((pointsPerWeek[w] || 0) >= quota) weeksMetTarget++; });

        // EXAKTE LOGIK: 3 von 4 oder 4 von 5 Wochen müssen erreicht sein
        let requiredWeeks = weeksInMonth.length === 5 ? 4 : 3; 
        // Wenn der Monat extrem kurz gestartet ist (z.B. nur 1-2 Wochen alt), Warnung unterdrücken
        if(weeksInMonth.length < 3) requiredWeeks = 0; 

        const alertBox = document.getElementById('alert-banner');
        if (weeksMetTarget < requiredWeeks && requiredWeeks > 0) {
            alertBox.classList.remove('hidden');
            document.getElementById('alert-message').innerText = `⚠️ Achtung: Quoten-Warnung! Konsequenz: ${currentUserData.penalty}`;
        } else {
            alertBox.classList.add('hidden');
        }
    }

    let ptsUser = {};
    allLogs.forEach(log => { ptsUser[log.username] = (ptsUser[log.username] || 0) + log.points; });
    let sortedUsers = Object.keys(ptsUser).sort((a,b) => ptsUser[b] - ptsUser[a]);
    const lb = document.getElementById('leaderboard-list');
    lb.innerHTML = '';
    sortedUsers.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤';
        lb.innerHTML += `<li><span>${medal} ${user.toUpperCase()}</span> <span style="color:var(--primary)">${ptsUser[user]} Pkt.</span></li>`;
    });
}

// --- ERWACHSENE: KINDER-LIMITS VERWALTEN ---
async function loadAdminKidsConfig() {
    const qKids = query(collection(db, "users"), where("role", "==", "child"));
    const snap = await getDocs(qKids);
    const container = document.getElementById('admin-kids-list');
    container.innerHTML = '';

    snap.forEach(docSnap => {
        const kid = docSnap.data();
        container.innerHTML += `
            <div style="background: var(--bg-color); padding: 15px; margin-bottom: 10px; border-radius: 8px;">
                <h4>${kid.username.toUpperCase()}</h4>
                <div style="display:flex; gap:10px; margin-top:5px;">
                    <input type="number" id="quota-${docSnap.id}" value="${kid.quota}" placeholder="Wochenziel" style="width: 80px;">
                    <input type="text" id="penalty-${docSnap.id}" value="${kid.penalty}" placeholder="Strafe">
                    <button class="btn-primary" onclick="updateKid('${docSnap.id}')" style="width: auto;">Speichern</button>
                </div>
            </div>
        `;
    });
}

window.updateKid = async function(userId) {
    const newQuota = document.getElementById(`quota-${userId}`).value;
    const newPenalty = document.getElementById(`penalty-${userId}`).value;
    await updateDoc(doc(db, "users", userId), { quota: Number(newQuota), penalty: newPenalty });
    alert("Erfolgreich gespeichert!");
};

// --- LOGS LÖSCHEN ---
window.deleteLog = async function(docId) {
    if(confirm("Eintrag wirklich löschen?")) {
        await deleteDoc(doc(db, "logs", docId));
        await loadStats();
        if(currentUserData && currentUserData.role === 'adult' && !document.getElementById('view-admin').classList.contains('hidden')) {
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

// --- ENTWICKLER FUNKTIONEN (Aufgaben & Konten) ---
document.getElementById('admin-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('adm-username').value.trim().toLowerCase();
    const pwd = document.getElementById('adm-password').value;
    try {
        const newCred = await createUserWithEmailAndPassword(auth, username + FAKE_DOMAIN, pwd);
        await setDoc(doc(db, "users", newCred.user.uid), {
            username: username, role: document.getElementById('adm-role').value,
            quota: Number(document.getElementById('adm-quota').value), penalty: document.getElementById('adm-penalty').value
        });
        alert(`Konto ${username} erstellt!`); e.target.reset(); signOut(auth);
    } catch (err) { alert("Fehler: " + err.message); }
});

document.getElementById('admin-chore-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await addDoc(collection(db, "chores"), { 
            name: document.getElementById('chore-name').value, points: Number(document.getElementById('chore-points').value) 
        });
        e.target.reset();
        loadDevChores(); // Aktualisiert die Liste sofort
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
            <li style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #ccc;">
                <span><strong>${chore.name}</strong> (${chore.points} Pkt)</span>
                <div>
                    <button class="btn-secondary" onclick="editChore('${docSnap.id}', '${chore.name}', ${chore.points})" style="padding:5px 10px; width:auto; font-size:0.8rem; margin-right:5px;">✏️</button>
                    <button class="btn-delete" onclick="deleteChore('${docSnap.id}')" style="padding:5px 10px;">🗑️</button>
                </div>
            </li>
        `;
    });
}

window.deleteChore = async function(id) {
    if(confirm("Aufgabe wirklich komplett aus dem System löschen?")) {
        await deleteDoc(doc(db, "chores", id));
        loadDevChores(); // Visuelles Feedback
    }
}

window.editChore = async function(id, oldName, oldPoints) {
    const newPoints = prompt(`Neue Punktzahl für "${oldName}" eingeben:`, oldPoints);
    if(newPoints !== null && !isNaN(newPoints) && newPoints.trim() !== "") {
        await updateDoc(doc(db, "chores", id), { points: Number(newPoints) });
        loadDevChores(); // Visuelles Feedback
    }
}
