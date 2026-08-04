import { onAuthChange, login, register, logout, getUserData, changeUserPassword, deleteUserAccount, getAllUsers, adminUpdateUser, adminDeleteUser } from "./auth.js";
import { showView, toggleLoading, showNotification, toggleAuthTabs, renderGiornataSelect, renderMatchdayScroll, getTeamLogo, updateMatchdayStatusCard } from "./ui.js";
import { modalManager } from "./modal-manager.js";
import { initPlayerMatchesLive, cleanupPlayerListeners } from "./player.js";
import { getLeaderboard, getMatchesByGiornata, getMatchdayLock, setMatchdayLock, removeMatchdayLock, getMatchdayConfig, updateMatchdayConfig, subscribeToMatches, subscribeToMatchdayConfig, subscribeToLeaderboard, subscribeToPredictions } from "./db-service.js";
import { addMatch, updateMatchResult, resetMatchResult, calculatePoints, importCalendar } from "./admin.js";
import { db } from "./firebase-config.js";
import { collection, query, where, orderBy, limit, getDocs, onSnapshot, doc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// Global State
let currentUser = null;
let currentView = 'auth';
let currentGiornata = 1;
let activeListeners = [];
let userDocUnsubscribe = null;

async function autoSelectGiornata() {
    try {
        const matchesRef = collection(db, "matches");
        // Semplifichiamo la query per evitare la necessità di indici compositi su Firestore
        const q = query(matchesRef, where("status", "==", "scheduled"), limit(50));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            // Ordiniamo in JS invece che in Firestore per evitare l'indice status+dateTime
            const sortedMatches = snapshot.docs
                .map(d => d.data())
                .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
            
            currentGiornata = sortedMatches[0].giornata;
            console.log("Auto-selected current giornata:", currentGiornata);
        } else {
            // Se non ci sono partite in programma, prendi l'ultima giornata inserita
            const qLast = query(matchesRef, orderBy("giornata", "desc"), limit(1));
            const lastSnapshot = await getDocs(qLast);
            if (!lastSnapshot.empty) {
                currentGiornata = lastSnapshot.docs[0].data().giornata;
            }
        }
    } catch (error) {
        console.error("Error auto-selecting giornata:", error);
    }
}

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    await autoSelectGiornata(); // Find the best giornata to start with
    initAuthListener();
    setupEventListeners();
    
    window.addEventListener('navigate', (e) => navigateTo(e.detail));
});

function cleanupListeners() {
    activeListeners.forEach(unsubscribe => {
        if (typeof unsubscribe === 'function') unsubscribe();
    });
    activeListeners = [];
    if (userDocUnsubscribe) {
        userDocUnsubscribe();
        userDocUnsubscribe = null;
    }
    cleanupPlayerListeners();
}

function initAuthListener() {
    onAuthChange(async (user) => {
        try {
            if (user) {
                // Monitoraggio real-time del documento utente per rilevare eliminazioni o cambi ruolo
                if (userDocUnsubscribe) userDocUnsubscribe();
                
                userDocUnsubscribe = onSnapshot(doc(db, "users", user.uid), async (snapshot) => {
                    if (!snapshot.exists()) {
                        console.warn("L'account è stato eliminato dal database. Logout forzato.");
                        showNotification("Il tuo account non è più attivo.", "error");
                        logout();
                        return;
                    }
                    
                    const userData = snapshot.data();
                    const oldRole = currentUser?.role;
                    currentUser = { ...user, ...userData };
                    
                    // Se il ruolo cambia, ricarica la navigazione
                    if (oldRole !== undefined && oldRole !== userData.role) {
                        showNotification("Il tuo ruolo è stato aggiornato.", "info");
                        initAuthUI();
                        navigateTo('dashboard');
                    } else if (!oldRole) {
                        initAuthUI();
                        navigateTo('dashboard');
                    }
                    
                    updateUserSettingsUI();
                }, (error) => {
                    console.error("Errore nel monitoraggio utente:", error);
                    logout();
                });

            } else {
                currentUser = null;
                cleanupListeners();
                document.getElementById('main-nav').classList.add('hidden');
                navigateTo('auth');
            }
        } catch (error) {
            console.error("Auth error:", error);
        } finally {
            toggleLoading(false);
        }
    });
}

function initAuthUI() {
    if (!currentUser) return;
    document.getElementById('main-nav').classList.remove('hidden');
    document.getElementById('welcome-name').textContent = currentUser.displayName || 'Utente';
    
    // Show/Hide nav items based on role
    const adminNav = document.getElementById('nav-admin');
    const predictionsNav = document.getElementById('nav-predictions');
    const resultsNav = document.getElementById('nav-results');
    const leaderboardNav = document.getElementById('nav-leaderboard');
    const btnManageUsers = document.getElementById('btn-manage-users');

    if (currentUser.role === 'admin') {
        adminNav?.classList.remove('hidden');
        predictionsNav?.classList.add('hidden');
        resultsNav?.classList.add('hidden');
        leaderboardNav?.classList.remove('hidden');
        btnManageUsers?.classList.remove('hidden');
    } else {
        adminNav?.classList.add('hidden');
        predictionsNav?.classList.remove('hidden');
        resultsNav?.classList.remove('hidden');
        leaderboardNav?.classList.remove('hidden');
        btnManageUsers?.classList.add('hidden');
    }
}

function setupEventListeners() {
    // Auth Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => toggleAuthTabs(btn.dataset.tab);
    });

    // Forms
    document.getElementById('login-form').onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const pass = document.getElementById('login-password').value;
        toggleLoading(true);
        const { error } = await login(email, pass);
        toggleLoading(false);
        if (error) showNotification("Errore: " + error, 'error');
    };

    document.getElementById('register-form').onsubmit = async (e) => {
        e.preventDefault();
        const name = document.getElementById('register-name').value;
        const email = document.getElementById('register-email').value;
        const pass = document.getElementById('register-password').value;
        toggleLoading(true);
        const { error } = await register(email, pass, name);
        toggleLoading(false);
        if (error) showNotification(error, 'error');
    };

    // Nav Links
    document.querySelectorAll('.mobile-nav a').forEach(link => {
        link.onclick = (e) => {
            e.preventDefault();
            navigateTo(link.dataset.view);
        };
    });

    // Admin Actions
    const addMatchBtn = document.getElementById('add-match-btn');
    if (addMatchBtn) {
        addMatchBtn.onclick = () => {
            const modal = document.getElementById('match-modal');
            modal.classList.add('show');
        };
    }

    const closeMatchModal = document.querySelector('#match-modal .close-modal-btn');
    if (closeMatchModal) {
        closeMatchModal.onclick = () => {
            document.getElementById('match-modal').classList.remove('show');
        };
    }

    const matchForm = document.getElementById('match-form');
    if (matchForm) {
        matchForm.onsubmit = async (e) => {
            e.preventDefault();
            const matchData = {
                giornata: parseInt(document.getElementById('match-giornata').value),
                dateTime: document.getElementById('match-date').value,
                homeTeam: document.getElementById('match-home').value,
                awayTeam: document.getElementById('match-away').value
            };
            toggleLoading(true);
            const success = await addMatch(matchData);
            toggleLoading(false);
            if (success) {
                showNotification("Partita aggiunta!", "success");
                document.getElementById('match-modal').classList.remove('show');
                e.target.reset();
            }
        };
    }

    const importBtn = document.getElementById('import-calendar-btn');
    if (importBtn) {
        importBtn.onclick = async () => {
            modalManager.confirm(
                "Importa Calendario",
                "Vuoi importare tutto il calendario Serie A 26/27? Eventuali duplicati non verranno controllati.",
                async () => {
                    await importCalendar();
                }
            );
        };
    }

    const lockForm = document.getElementById('matchday-lock-form');
    if (lockForm) {
        lockForm.onsubmit = async (e) => {
            e.preventDefault();
            const lockDateTime = document.getElementById('lock-datetime').value;
            const notes = document.getElementById('matchday-notes').value;
            toggleLoading(true);
            const success = await updateMatchdayConfig(currentGiornata, {
                lockDateTime: lockDateTime || null,
                notes: notes || "",
                status: lockDateTime ? 'locked_scheduled' : 'open'
            });
            toggleLoading(false);
            if (success) showNotification("Configurazione salvata!", "success");
        };
    }

    const removeLockBtn = document.getElementById('remove-lock-btn');
    if (removeLockBtn) {
        removeLockBtn.onclick = async () => {
            modalManager.confirm(
                "Rimuovi Blocco",
                "Vuoi rimuovere il blocco per questa giornata?",
                async () => {
                    toggleLoading(true);
                    await removeMatchdayLock(currentGiornata);
                    toggleLoading(false);
                    showNotification("Blocco rimosso!", "success");
                }
            );
        };
    }

    // Menu Actions
    document.getElementById('logout-btn').onclick = () => logout();

    document.getElementById('btn-change-password').onclick = () => {
        modalManager.openModal({
            title: 'Cambia Password',
            content: `
                <div class="input-group">
                    <label>Vecchia Password</label>
                    <input type="password" id="old-pass" placeholder="Inserisci vecchia password">
                </div>
                <div class="input-group">
                    <label>Nuova Password</label>
                    <input type="password" id="new-pass" placeholder="Minimo 6 caratteri">
                </div>
            `,
            buttons: [
                { text: 'Annulla', type: 'secondary' },
                { text: 'Aggiorna', type: 'primary', action: async (close) => {
                    const oldP = document.getElementById('old-pass').value;
                    const newP = document.getElementById('new-pass').value;
                    if (!oldP || newP.length < 6) return showNotification("Dati non validi", "error");
                    toggleLoading(true);
                    const { error } = await changeUserPassword(oldP, newP);
                    toggleLoading(false);
                    if (error) showNotification(error, "error");
                    else {
                        showNotification("Password aggiornata!", "success");
                        close();
                    }
                }}
            ]
        });
    };

    document.getElementById('btn-delete-account').onclick = () => {
        modalManager.openModal({
            title: 'Elimina Account',
            content: `
                <p style="color: var(--danger-color); margin-bottom: 15px;">Attenzione: questa azione è irreversibile!</p>
                <div class="input-group">
                    <label>Conferma la tua password</label>
                    <input type="password" id="del-pass" placeholder="Password per confermare">
                </div>
            `,
            buttons: [
                { text: 'Annulla', type: 'secondary' },
                { text: 'ELIMINA DEFINITIVAMENTE', type: 'danger', action: async (close) => {
                    const pass = document.getElementById('del-pass').value;
                    if (!pass) return;
                    toggleLoading(true);
                    const { error } = await deleteUserAccount(pass);
                    toggleLoading(false);
                    if (error) showNotification(error, "error");
                    else close();
                }}
            ]
        });
    };

    document.getElementById('btn-personal-info').onclick = () => {
        modalManager.openModal({
            title: 'Informazioni Account',
            content: `
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <p><strong>Nome:</strong> ${currentUser.displayName}</p>
                    <p><strong>Email:</strong> ${currentUser.email}</p>
                    <p><strong>Ruolo:</strong> ${currentUser.role}</p>
                    <p><strong>ID:</strong> ${currentUser.uid}</p>
                </div>
            `,
            buttons: [{ text: 'Chiudi', type: 'secondary' }]
        });
    };

    const btnManageUsers = document.getElementById('btn-manage-users');
    if (btnManageUsers) {
        btnManageUsers.onclick = () => navigateTo('user-management');
    }

    const userSearchInput = document.getElementById('user-search-input');
    if (userSearchInput) {
        userSearchInput.oninput = (e) => {
            const term = e.target.value.toLowerCase();
            const cards = document.querySelectorAll('.user-manage-card');
            cards.forEach(card => {
                const text = card.textContent.toLowerCase();
                card.style.display = text.includes(term) ? 'flex' : 'none';
            });
        };
    }
}

function updateLockInfo(lockDateTime, notes = "") {
    const info = document.getElementById('current-lock-info');
    if (!info) return;
    
    let html = '';
    if (lockDateTime) {
        const date = new Date(lockDateTime);
        html += `<i class="fas fa-lock"></i> Pronostici bloccati: <strong>${date.toLocaleDateString()} alle ${date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</strong>`;
    } else {
        html += `<i class="fas fa-unlock"></i> Nessun blocco impostato.`;
    }

    if (notes) {
        html += `<div style="margin-top: 5px; font-style: italic; color: var(--accent-color)"><i class="fas fa-info-circle"></i> ${notes}</div>`;
    }

    info.innerHTML = html;
    info.style.display = (lockDateTime || notes) ? 'block' : 'none';
}

async function navigateTo(view) {
    // Controllo di sicurezza: se non c'è sessione e non siamo in auth, reindirizza
    if (!currentUser && view !== 'auth') {
        showView('auth');
        return;
    }

    if ((view === 'predictions' || view === 'results') && currentUser?.role === 'admin') {
        showNotification("L'admin gestisce le partite dal pannello dedicato.", "info");
        return;
    }

    currentView = view;
    showView(view);
    cleanupListeners();

    if (view === 'dashboard' && currentUser) {
        initDashboardLive();
    } else if (view === 'predictions' && currentUser) {
        renderMatchdayScroll(currentGiornata, 'predictions-giornata-scroll', (g) => {
            currentGiornata = g;
            cleanupListeners();
            initPlayerMatchesLive(currentGiornata, currentUser.uid);
        });
        initPlayerMatchesLive(currentGiornata, currentUser.uid);
    } else if (view === 'results') {
        renderMatchdayScroll(currentGiornata, 'results-giornata-scroll', (g) => {
            currentGiornata = g;
            cleanupListeners();
            initResultsLive(currentGiornata);
        });
        initResultsLive(currentGiornata);
    } else if (view === 'leaderboard') {
        initLeaderboardLive();
    } else if (view === 'admin' && currentUser?.role === 'admin') {
        renderMatchdayScroll(currentGiornata, 'admin-giornata-scroll', (g) => {
            currentGiornata = g;
            cleanupListeners();
            initAdminMatchesLive();
        });
        initAdminMatchesLive();
    } else if (view === 'settings' && currentUser) {
        updateUserSettingsUI();
    } else if (view === 'user-management' && currentUser?.role === 'admin') {
        initUserManagement();
    }
}

async function initUserManagement() {
    const container = document.getElementById('user-management-list');
    container.innerHTML = '<div class="spinner"></div>';

    const users = await getAllUsers();
    container.innerHTML = '';

    if (users.length === 0) {
        container.innerHTML = '<p class="no-data">Nessun utente trovato.</p>';
        return;
    }

    users.forEach(user => {
        const initials = (user.displayName || 'U').substring(0, 2).toUpperCase();
        const card = document.createElement('div');
        card.className = 'user-manage-card glass-card';
        card.innerHTML = `
            <div class="user-avatar-mini">${initials}</div>
            <div class="user-manage-info">
                <h4>${user.displayName || 'Utente'}</h4>
                <p>${user.email}</p>
                <span class="badge" style="background: ${user.role === 'admin' ? 'var(--primary-color)' : 'var(--secondary-color)'}; font-size: 0.6rem;">${user.role.toUpperCase()}</span>
            </div>
            <div class="user-manage-actions">
                <button class="action-btn edit" title="Modifica"><i class="fas fa-user-pen"></i></button>
                <button class="action-btn delete" title="Elimina"><i class="fas fa-user-xmark"></i></button>
            </div>
        `;

        card.querySelector('.edit').onclick = () => {
            modalManager.openModal({
                title: `Modifica ${user.displayName || 'Utente'}`,
                content: `
                    <div class="input-group">
                        <label>Nome Visualizzato</label>
                        <input type="text" id="edit-user-name" value="${user.displayName || ''}" placeholder="Nome utente">
                    </div>
                    <div class="input-group">
                        <label>Ruolo Sistema</label>
                        <select id="edit-user-role" class="score-input" style="width: 100%; height: auto; padding: 12px; font-size: 0.9rem; background: rgba(0,0,0,0.2); color: white; border: 1px solid var(--glass-border); border-radius: 12px;">
                            <option value="player" ${user.role === 'player' ? 'selected' : ''}>Player (Standard)</option>
                            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin (Gestore)</option>
                        </select>
                    </div>
                `,
                buttons: [
                    { text: 'Annulla', type: 'secondary' },
                    { text: 'Salva Modifiche', type: 'primary', action: async (close) => {
                        const newName = document.getElementById('edit-user-name').value;
                        const newRole = document.getElementById('edit-user-role').value;
                        toggleLoading(true);
                        const { error } = await adminUpdateUser(user.uid, { displayName: newName, role: newRole });
                        toggleLoading(false);
                        if (error) showNotification(error, 'error');
                        else {
                            showNotification("Utente aggiornato con successo!", "success");
                            close();
                            initUserManagement(); // Refresh list
                        }
                    }}
                ]
            });
        };

        card.querySelector('.delete').onclick = () => {
            if (user.uid === currentUser.uid) return showNotification("Non puoi eliminare il tuo stesso account admin!", "warning");
            
            modalManager.confirm(
                "Elimina Partecipante",
                `Sei sicuro di voler rimuovere <strong>${user.displayName || user.email}</strong>? Questa azione non può essere annullata.`,
                async () => {
                    toggleLoading(true);
                    const { error } = await adminDeleteUser(user.uid);
                    toggleLoading(false);
                    if (error) showNotification(error, 'error');
                    else {
                        showNotification("Utente rimosso dal sistema.", "success");
                        initUserManagement(); // Refresh list
                    }
                }
            );
        };

        container.appendChild(card);
    });
}

function initDashboardLive() {
    // Role-based shortcuts visibility
    const shortcuts = document.querySelectorAll('.shortcut-item');
    shortcuts.forEach(item => {
        const view = item.getAttribute('onclick').match(/'([^']+)'/)[1];
        if (currentUser.role === 'admin') {
            if (view === 'predictions' || view === 'results') item.classList.add('hidden');
            else item.classList.remove('hidden');
        } else {
            if (view === 'admin') item.classList.add('hidden');
            else item.classList.remove('hidden');
        }
    });

    // Matchday Status Logic
    let currentMatches = [];
    let currentPredictions = {};
    let currentConfig = null;
    let predictionsUnsubscribe = null;

    const refreshDashboardUI = () => {
        const totalMatches = currentMatches.length;
        const predictionsCount = Object.keys(currentPredictions).length;
        const lockDate = currentConfig?.lockDateTime;
        const notes = currentConfig?.notes;

        updateMatchdayStatusCard(
            currentGiornata, 
            predictionsCount, 
            totalMatches, 
            lockDate, 
            notes
        );
    };

    // 1. Subscribe to Matchday Config (Lock date & Notes)
    activeListeners.push(subscribeToMatchdayConfig(currentGiornata, (config) => {
        currentConfig = config;
        refreshDashboardUI();
    }));

    // 2. Subscribe to Matches for the current giornata
    activeListeners.push(subscribeToMatches(currentGiornata, (matches) => {
        currentMatches = matches;
        const matchIds = matches.map(m => m.id);
        
        // 3. Subscribe to user predictions for THESE specific matches
        if (predictionsUnsubscribe) predictionsUnsubscribe();
        
        predictionsUnsubscribe = subscribeToPredictions(currentUser.uid, matchIds, (predictions) => {
            currentPredictions = predictions;
            refreshDashboardUI();
        });
        
        // Add to activeListeners for cleanup
        activeListeners.push(predictionsUnsubscribe);
        
        refreshDashboardUI();
    }));

    // Stats Logic
    activeListeners.push(subscribeToLeaderboard((users) => {
        const me = users.find(u => u.uid === currentUser.uid);
        if (me) {
            document.getElementById('home-user-points').textContent = me.totalPoints || 0;
            const rank = users.indexOf(me) + 1;
            document.getElementById('home-user-rank').textContent = `#${rank}`;
            
            // Also update settings/profile stats
            document.getElementById('profile-total-points').textContent = me.totalPoints || 0;
            document.getElementById('profile-exact-scores').textContent = me.exactResultsCount || 0;
        }
    }));
}

function initLeaderboardLive() {
    const tbody = document.getElementById('leaderboard-body');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px;"><div class="spinner"></div></td></tr>';

    activeListeners.push(subscribeToLeaderboard((users) => {
        tbody.innerHTML = '';
        users.forEach((user, index) => {
            const rank = index + 1;
            const isMe = user.uid === currentUser?.uid;
            const initials = (user.displayName || 'U').substring(0, 2).toUpperCase();
            
            let rankClass = 'rank-other';
            if (rank === 1) rankClass = 'rank-1';
            else if (rank === 2) rankClass = 'rank-2';
            else if (rank === 3) rankClass = 'rank-3';

            const tr = document.createElement('tr');
            tr.className = `leaderboard-row ${isMe ? 'me' : ''}`;
            tr.innerHTML = `
                <td>
                    <div class="rank-badge ${rankClass}">${rank}</div>
                </td>
                <td>
                    <div class="user-cell">
                        <div class="user-avatar-mini">${initials}</div>
                        <span style="font-weight: 600;">${user.displayName || user.email}</span>
                        ${isMe ? '<span class="badge" style="background: var(--primary-color); margin-left: 8px; font-size: 0.55rem;">TU</span>' : ''}
                    </div>
                </td>
                <td style="text-align: center;">
                    <span class="points-cell">${user.totalPoints || 0}</span>
                </td>
                <td style="text-align: center;">
                    <span class="exact-cell">${user.exactResultsCount || 0}</span>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }));
}

function initResultsLive(giornata) {
    const container = document.getElementById('results-list');
    container.innerHTML = '<div class="spinner"></div>';

    activeListeners.push(subscribeToMatches(giornata, (matches) => {
        container.innerHTML = '';
        if (matches.length === 0) {
            container.innerHTML = `<div class="no-data"><p>Nessun risultato per la Giornata ${giornata}.</p></div>`;
            return;
        }

        // Group matches by date
        const groupedMatches = {};
        matches.forEach(match => {
            const date = new Date(match.dateTime).toLocaleDateString('it-IT', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });
            if (!groupedMatches[date]) groupedMatches[date] = [];
            groupedMatches[date].push(match);
        });

        for (const [date, dayMatches] of Object.entries(groupedMatches)) {
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.textContent = date;
            container.appendChild(divider);

            dayMatches.forEach(match => {
                const isFinished = match.status === 'finished';
                const div = document.createElement('div');
                div.className = 'match-card glass-card';
                div.innerHTML = `
                    <div class="match-info">
                        <span>${new Date(match.dateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        ${isFinished ? '<span class="badge" style="background:var(--success-color)">Terminata</span>' : '<span class="badge" style="background:var(--secondary-color)">In attesa</span>'}
                    </div>
                    <div class="match-teams">
                        <div class="team">
                            <img src="${getTeamLogo(match.homeTeam)}" class="team-logo">
                            <span class="team-name">${match.homeTeam}</span>
                        </div>
                        <div class="score-display">
                            <span class="score-input">${isFinished ? match.homeScoreReal : '-'}</span>
                            <span class="vs">-</span>
                            <span class="score-input">${isFinished ? match.awayScoreReal : '-'}</span>
                        </div>
                        <div class="team">
                            <img src="${getTeamLogo(match.awayTeam)}" class="team-logo">
                            <span class="team-name">${match.awayTeam}</span>
                        </div>
                    </div>
                `;
                container.appendChild(div);
            });
        }
    }));
}

function initAdminMatchesLive() {
    const container = document.getElementById('admin-matches-list');
    container.innerHTML = '<div class="spinner"></div>';

    let currentMatches = null;
    let currentConfig = null;
    const targetGiornata = currentGiornata;

    const render = () => {
        if (currentMatches === null) return;
        const lockDate = currentConfig?.lockDateTime;
        const notes = currentConfig?.notes || "";
        
        // Update lock form fields
        const lockInput = document.getElementById('lock-datetime');
        const notesInput = document.getElementById('matchday-notes');
        if (lockInput) lockInput.value = lockDate || '';
        if (notesInput) notesInput.value = notes;
        
        updateLockInfo(lockDate, notes);
        
        container.innerHTML = '';
        
        if (currentMatches.length === 0) {
            container.innerHTML = `<p class="no-data">Nessuna partita per la Giornata ${targetGiornata}.</p>`;
            return;
        }

        const isLocked = lockDate && new Date() >= new Date(lockDate);

        currentMatches.forEach(match => {
            const isFinished = match.status === 'finished';
            const div = document.createElement('div');
            div.className = `match-card glass-card ${!isLocked ? 'locked' : ''}`;
            div.innerHTML = `
                <div class="match-info">
                    <span>${new Date(match.dateTime).toLocaleDateString()}</span>
                    <span class="badge ${isFinished ? 'badge-player' : 'badge-admin'}">${isFinished ? 'Terminata' : 'In attesa'}</span>
                </div>
                <div class="match-teams">
                    <div class="team">
                        <img src="${getTeamLogo(match.homeTeam)}" class="team-logo">
                        <span class="team-name">${match.homeTeam}</span>
                    </div>
                    <div class="result-inputs">
                        <input type="number" class="score-input res-home" value="${match.homeScoreReal ?? ''}" placeholder="H" ${!isLocked ? 'disabled' : ''}>
                        <span class="vs">-</span>
                        <input type="number" class="score-input res-away" value="${match.awayScoreReal ?? ''}" placeholder="A" ${!isLocked ? 'disabled' : ''}>
                    </div>
                    <div class="team">
                        <img src="${getTeamLogo(match.awayTeam)}" class="team-logo">
                        <span class="team-name">${match.awayTeam}</span>
                    </div>
                </div>
                <div class="match-footer">
                    <button class="btn-save-res btn-primary" ${!isLocked ? 'disabled' : ''}>
                        <i class="fas fa-check"></i> ${isFinished ? 'Aggiorna' : 'Salva'}
                    </button>
                    ${isFinished ? `
                        <button class="btn-reset-res" title="Resetta Risultato">
                            <i class="fas fa-rotate-left"></i>
                        </button>
                    ` : ''}
                </div>
            `;

            const saveBtn = div.querySelector('.btn-save-res');
            saveBtn.onclick = async () => {
                const h = div.querySelector('.res-home').value;
                const a = div.querySelector('.res-away').value;
                if (h === '' || a === '') return showNotification("Inserisci i risultati!", "error");
                toggleLoading(true);
                const success = await updateMatchResult(match.id, h, a);
                toggleLoading(false);
                if (success) showNotification("Risultato salvato e punti calcolati!", "success");
            };

            const resetBtn = div.querySelector('.btn-reset-res');
            if (resetBtn) {
                resetBtn.onclick = async () => {
                    modalManager.confirm(
                        "Resetta Risultato",
                        "Vuoi resettare il risultato di questa partita? I punti verranno ricalcolati.",
                        async () => {
                            toggleLoading(true);
                            const success = await resetMatchResult(match.id);
                            toggleLoading(false);
                            if (success) showNotification("Risultato resettato!", "info");
                        }
                    );
                };
            }

            container.appendChild(div);
        });
    };

    activeListeners.push(subscribeToMatchdayConfig(targetGiornata, (config) => {
        currentConfig = config;
        render();
    }));

    activeListeners.push(subscribeToMatches(targetGiornata, (matches) => {
        currentMatches = matches;
        render();
    }));
}

function updateUserSettingsUI() {
    if (!currentUser) return;
    document.getElementById('profile-email-display').textContent = currentUser.email;
    document.getElementById('welcome-name').textContent = currentUser.displayName || 'Utente';
}
