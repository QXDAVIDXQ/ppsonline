// --- 1. FIREBASE INITIALISIERUNG ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, where, orderBy, deleteDoc, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// HIER DEINE FIREBASE DATEN EINTRAGEN:
const firebaseConfig = {
    apiKey: "DEIN_API_KEY",
    authDomain: "dein-projekt.firebaseapp.com",
    projectId: "dein-projekt",
    storageBucket: "dein-projekt.appspot.com",
    messagingSenderId: "DEINE_ID",
    appId: "DEINE_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Globale Variablen für den aktuellen Nutzer
let currentUserData = null;
let currentChores = [];
const FAKE_DOMAIN = "@familiensystem.local";

// --- 2. KOMPLEXE KALENDER-LOGIK ---

// Gibt die Kalenderwoche zurück (ISO 8601)
function getISOWeekInfo(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week: weekNo };
}

// Berechnet den "Abrechnungsmonat".
// Regel: Wenn die Woche am Anfang oder Ende des Monats überlappt, 
// zählt die Woche zu dem Monat, in dem der Sonntag der Woche liegt.
function getBillingMonth(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0 = Sonntag
    const diffToSunday = day === 0 ? 0 : 7 - day;
    const sunday = new Date(d.setDate(d.getDate() + diffToSunday));
    return `${sunday.getFullYear()}-${(sunday.getMonth() + 1).toString().padStart(2, '0')}`;
}

const currentDate = new Date();
const currentWeekInfo = getISOWeekInfo(currentDate);
const currentWeekString = `${currentWeekInfo.year}-W${currentWeekInfo.week.toString().padStart(2, '0')}`;
const currentBillingMonth = getBillingMonth(currentDate);


// --- 3. UI STEUERUNG & AUTH ---
const loginContainer = document.getElementById('login-container');
const dashboardContainer = document.getElementById('dashboard-container');

// Dark Mode Toggle
document.getElementById('theme-toggle').addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    document.body.setAttribute('data-theme', isDark ? 'light' : 'dark');
    document.getElementById('theme-toggle').innerText = isDark ? "🌙 Dark Mode" : "☀️ Light Mode";
});

// Auth State Listener
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Nutzerprofil aus Firestore laden
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            currentUserData = { uid: user.uid, ...userDoc.data() };
            initDashboard();
        }
    } else {
        currentUserData = null;
        loginContainer.classList.remove('hidden');
        dashboardContainer.classList.add('hidden');
    }
});

// Login (Username -> Dummy E-Mail Trick)
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

// Logout
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));


// --- 4. DASHBOARD INITIALISIEREN ---
async function initDashboard() {
    loginContainer.classList.add('hidden');
    dashboardContainer.classList.remove('hidden');
    
    // UI Profil setzen
    document.getElementById('display-name').innerText = currentUserData.username.toUpperCase();
    document.getElementById('user-avatar').innerText = currentUserData.username.charAt(0).toUpperCase();
    document.getElementById('user-role-badge').innerText = currentUserData.role === 'adult' ? 'Verwalter' : 'Kind';
    
    // Admin-Reiter nur für Erwachsene
    if(currentUserData.role === 'adult') {
        document.getElementById('admin-nav-item').classList.remove('hidden');
    } else {
        document.getElementById('admin-nav-item').classList.add('hidden');
    }

    await loadChoresCatalog();
    await loadAndCalculateStats(); // Lädt Historie und prüft Strafen
    setupNavigation();
}

// Navigation Tabs
function setupNavigation() {
    document.querySelectorAll('.side-nav .nav-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.side-nav .nav-item').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const targetId = e.target.getAttribute('data-target');
            document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
            document.getElementById(targetId).classList.remove('hidden');
            
            if(targetId === 'view-admin') loadAdminData();
        });
    });
}

// --- 5. AUFGABEN-KATALOG (Firestore) ---
async function loadChoresCatalog() {
    const q = query(collection(db, "chores"), orderBy("points", "asc"));
    const snapshot = await getDocs(q);
    currentChores = [];
    const quickGrid = document.getElementById('list-quick-chores');
    const heavyGrid = document.getElementById('list-heavy-chores');
    quickGrid.innerHTML = ''; heavyGrid.innerHTML = '';

    snapshot.forEach(docSnap => {
        const chore = { id: docSnap.id, ...docSnap.data() };
        currentChores.push(chore);
        
        const el = document.createElement('div');
        el.className = 'chore-item';
        el.innerHTML = `<strong>${chore.name}</strong><span class="chore-pts">${chore.points} Pkt</span>`;
        
        // Eintragen-Event
        el.addEventListener('click', () => logChore(chore));

        if(chore.points <= 2) quickGrid.appendChild(el);
        else heavyGrid.appendChild(el);
    });
}

// Aufgabe erledigt (in Datenbank schreiben)
async function logChore(chore) {
    const now = new Date();
    const logEntry = {
        userId: currentUserData.uid,
        username: currentUserData.username,
        choreName: chore.name,
        points: Number(chore.points),
        timestamp: now.toISOString(),
        week: getISOWeekInfo(now).year + '-W' + getISOWeekInfo(now).week.toString().padStart(2, '0'),
        billingMonth: getBillingMonth(now)
    };

    try {
        await addDoc(collection(db, "logs"), logEntry);
        await loadAndCalculateStats(); // Aktualisiere alles sofort
    } catch (e) {
        alert("Fehler beim Eintragen: " + e.message);
    }
}


// --- 6. STATISTIKEN, HISTORIE & STRAFEN-BERECHNUNG ---
async function loadAndCalculateStats() {
    // Hole alle Logs des aktuellen Abrechnungsmonats (für die ganze Familie zur Auswertung)
    const qMonth = query(collection(db, "logs"), where("billingMonth", "==", currentBillingMonth));
    const snapshotMonth = await getDocs(qMonth);
    
    let allMonthLogs = [];
    snapshotMonth.forEach(doc => allMonthLogs.push({ id: doc.id, ...doc.data() }));

    // 1. Meine Historie filtern & sortieren (neueste zuerst)
    let myLogs = allMonthLogs.filter(log => log.userId === currentUserData.uid);
    myLogs.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    const histBody = document.getElementById('personal-history-body');
    histBody.innerHTML = '';
    
    myLogs.forEach(log => {
        const d = new Date(log.timestamp);
        histBody.innerHTML += `
            <tr>
                <td>${log.choreName}</td>
                <td><strong style="color:var(--primary)">${log.points}</strong></td>
                <td>${d.toLocaleDateString('de-DE')} - ${d.toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'})}</td>
                <td><button class="btn-delete" onclick="deleteLog('${log.id}')">Löschen</button></td>
            </tr>
        `;
    });

    // 2. Wochen-Fortschritt & Straf-Logik (4 von 5 Wochen)
    if(currentUserData.role === 'child') {
        const quota = Number(currentUserData.quota);
        document.getElementById('pts-goal').innerText = quota;

        // Punkte gruppiert nach Woche für diesen Nutzer berechnen
        let pointsPerWeek = {};
        myLogs.forEach(log => {
            pointsPerWeek[log.week] = (pointsPerWeek[log.week] || 0) + log.points;
        });

        const currentPts = pointsPerWeek[currentWeekString] || 0;
        document.getElementById('pts-current').innerText = currentPts;
        
        let percent = (currentPts / quota) * 100;
        document.getElementById('progress-fill').style.width = Math.min(percent, 100) + '%';

        // Die exakte 4-von-5 / 3-von-4 Logik
        let weeksInMonth = [...new Set(allMonthLogs.map(l => l.week))]; // Alle existierenden Wochen dieses Monats
        if(weeksInMonth.length === 0) weeksInMonth = [currentWeekString];
        
        let weeksMetTarget = 0;
        weeksInMonth.forEach(w => {
            if((pointsPerWeek[w] || 0) >= quota) weeksMetTarget++;
        });

        document.getElementById('weeks-fulfilled-count').innerText = weeksMetTarget;

        const alertBox = document.getElementById('alert-banner');
        const alertMsg = document.getElementById('alert-message');
        
        // Regelwerk Check: Wenn der Monat zu Ende ist (oder fast), und das Ziel mathematisch nicht mehr erreichbar ist.
        // Vereinfacht für Laufzeit: Wir warnen, wenn in der aktuellen Woche das Ziel noch nicht erreicht ist, 
        // und wenden die harte Konsequenz an, wenn (weeksMetTarget / TotalWeeks) < Erwartet
        const requiredRatio = 0.8; // Entspricht 4 von 5 (0.8) oder 3.2 von 4 (aufgerundet 4)
        
        if ((weeksMetTarget / weeksInMonth.length) < requiredRatio && weeksInMonth.length >= 3) {
            alertBox.classList.remove('hidden');
            alertMsg.innerText = `⚠️ Achtung: Quoten-Warnung! Du fällst unter das Monatsziel. Konsequenz: ${currentUserData.penalty}`;
        } else if (currentPts < quota) {
            alertBox.classList.remove('hidden');
            alertMsg.innerText = `💡 Du musst diese Woche noch ${quota - currentPts} Punkte sammeln.`;
        } else {
            alertBox.classList.add('hidden');
        }
    } else {
        // Erwachsene haben keine Quote
        document.querySelector('.weekly-progress').classList.add('hidden');
        document.getElementById('alert-banner').classList.add('hidden');
    }

    // 3. Globale Statistiken (Ranking & All-Logs)
    renderGlobalStats(allMonthLogs);
}

function renderGlobalStats(allMonthLogs) {
    // Ranking berechnen
    let pointsByUser = {};
    allMonthLogs.forEach(log => {
        pointsByUser[log.username] = (pointsByUser[log.username] || 0) + log.points;
    });

    let sortedUsers = Object.keys(pointsByUser).sort((a,b) => pointsByUser[b] - pointsByUser[a]);
    const lb = document.getElementById('leaderboard-list');
    lb.innerHTML = '';
    sortedUsers.forEach(user => {
        lb.innerHTML += `<li><span>👤 ${user.toUpperCase()}</span> <span>${pointsByUser[user]} Pkt.</span></li>`;
    });

    // Detaillierte Tabelle (Global)
    const globStats = document.getElementById('global-stats-body');
    globStats.innerHTML = '';
    let sortedAllLogs = [...allMonthLogs].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    sortedAllLogs.forEach(log => {
        const d = new Date(log.timestamp);
        globStats.innerHTML += `
            <tr>
                <td><strong>${log.username.toUpperCase()}</strong></td>
                <td>${log.choreName}</td>
                <td>${d.toLocaleDateString('de-DE')}</td>
                <td>${d.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'})}</td>
                <td>${log.points}</td>
            </tr>
        `;
    });
}

// Lösch-Funktion (Global für app.js Scope gebunden)
window.deleteLog = async function(docId) {
    if(confirm("Möchtest du diesen Eintrag wirklich löschen?")) {
        await deleteDoc(doc(db, "logs", docId));
        await loadAndCalculateStats(); // Refresh
        if(currentUserData.role === 'adult') loadAdminData(); // Refresh admin log
    }
}


// --- 7. VERWALTUNG (ADMIN BEREICH) ---

async function loadAdminData() {
    // Lade globale Historie in Admin-Tabelle für Löschrechte
    const qAll = query(collection(db, "logs"), orderBy("timestamp", "desc"));
    const snap = await getDocs(qAll);
    const tbody = document.getElementById('admin-history-body');
    tbody.innerHTML = '';
    
    snap.forEach(docSnap => {
        const log = docSnap.data();
        const d = new Date(log.timestamp);
        tbody.innerHTML += `
            <tr>
                <td>${log.username}</td>
                <td>${log.choreName} (${log.points} P)</td>
                <td>${d.toLocaleDateString('de-DE')} ${d.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'})}</td>
                <td><button class="btn-delete" onclick="deleteLog('${docSnap.id}')">Löschen</button></td>
            </tr>
        `;
    });
}

// Benutzer erstellen
document.getElementById('admin-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('adm-username').value.trim().toLowerCase();
    const pwd = document.getElementById('adm-password').value;
    const role = document.getElementById('adm-role').value;
    const quota = document.getElementById('adm-quota').value;
    const penalty = document.getElementById('adm-penalty').value;

    try {
        // Auth Konto anlegen (Im Hintergrund wird der Admin kurz aus- und der neue User eingeloggt,
        // in echten Apps nutzt man dafür Cloud Functions, hier ein funktionaler Workaround)
        const newCredential = await createUserWithEmailAndPassword(auth, username + FAKE_DOMAIN, pwd);
        const newUid = newCredential.user.uid;
        
        // Zusätzliche Daten in Firestore unter der neuen UID speichern
        await setDoc(doc(db, "users", newUid), {
            username: username,
            role: role,
            quota: Number(quota),
            penalty: penalty
        });

        alert(`Konto für ${username} erfolgreich erstellt!`);
        e.target.reset();
        
        // Da Firebase uns beim Erstellen in das neue Konto einloggt, loggen wir sicherheitshalber aus
        // oder man muss sich neu als Admin anmelden. (Standardverhalten von Firebase Client SDK).
        signOut(auth); 

    } catch (err) {
        alert("Fehler beim Erstellen des Nutzers: " + err.message);
    }
});

// Aufgabe zum System hinzufügen
document.getElementById('admin-chore-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('chore-name').value;
    const points = document.getElementById('chore-points').value;

    try {
        await addDoc(collection(db, "chores"), { name: name, points: Number(points) });
        alert("Aufgabe hinzugefügt!");
        e.target.reset();
        loadChoresCatalog(); // UI direkt aktualisieren
    } catch (err) {
        alert("Fehler: " + err.message);
    }
});
