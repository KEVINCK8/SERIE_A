import { onAuthChange, login, register, logout, getUserData, changeUserPassword, deleteUserAccount, getAllUsers, adminUpdateUser, adminDeleteUser } from "./auth.js";
import { showView, toggleLoading, showNotification, toggleAuthTabs, renderGiornataSelect, renderMatchdayScroll, getTeamLogo, updateMatchdayStatusCard } from "./ui.js";
import { modalManager } from "./modal-manager.js";
import { initPlayerMatchesLive, cleanupPlayerListeners } from "./player.js?v=2.2.1";
import { getLeaderboard, getMatchesByGiornata, getMatchdayLock, setMatchdayLock, removeMatchdayLock, getMatchdayConfig, updateMatchdayConfig, getActiveLockedMatchday, subscribeToMatches, subscribeToMatchdayConfig, subscribeToLeaderboard, subscribeToPredictions } from "./db-service.js";
import { addMatch, updateMatchResult, resetMatchResult, calculatePoints, importCalendar, updateMatchDetails, toggleMatchDisabled } from "./admin.js?v=2.2.1";
import { db } from "./firebase-config.js";
import { ICON_FILES } from "./icon-manifest.js";
import { collection, query, where, orderBy, limit, getDocs, onSnapshot, doc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// Global State
let currentUser = null;
let currentView = 'auth';
let currentGiornata = 1;
let activeListeners = [];
let userDocUnsubscribe = null;
let hasSelectedInitialGiornata = false;

// Percorso base per le icone immagine
const IMAGE_ICONS_PATH = 'assets/image/icon/';
const IMAGE_ICON_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];

function isImageIcon(iconId) {
    return IMAGE_ICON_EXTENSIONS.some(ext => iconId?.toLowerCase().endsWith(ext));
}

function escapeHtmlAttribute(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

// Usiamo solo le icone immagine locali (assets)
const AVAILABLE_ICONS = ICON_FILES.map(img => ({ id: img, isImage: true, color: '#38bdf8' }));

function getIconColor(iconId) {
    return '#38bdf8'; // Colore predefinito per tutte le icone asset
}

function isAdminUser() {
    return currentUser?.role === 'admin';
}

function isMatchdayClosed(config) {
    if (!config?.lockDateTime) return false;
    const lockDate = new Date(config.lockDateTime);
    return !Number.isNaN(lockDate.getTime()) && Date.now() >= lockDate.getTime();
}

function renderResultsLockedMessage(container, giornata) {
    container.innerHTML = `
        <div class="no-data results-locked-message glass-card">
            <img src="assets/image/icon/087-shield.png" alt="" style="width: 42px; height: 42px;">
            <p>I risultati della Giornata ${giornata} saranno visibili solo dopo il blocco della giornata.</p>
        </div>
    `;
}

/**
 * Aggiorna l'interfaccia dell'avatar ovunque sia presente (Dashboard e Impostazioni)
 * @param {string} photoURL - L'ID dell'icona (nome file immagine)
 */
function updateUserAvatarUI(photoURL) {
    const color = getIconColor(photoURL);
    
    // Funzione helper per generare l'HTML dell'icona
    const getIconHTML = (id, style = "") => {
        if (!isImageIcon(id)) return `<img src="${IMAGE_ICONS_PATH}088-man.png" alt="Avatar" style="${style}">`;
        return `<img src="${IMAGE_ICONS_PATH}${id}" alt="Avatar" style="${style}">`;
    };

    // 1. Aggiorna shortcut icon nella dashboard (se presente)
    const profileShortcutIcon = document.querySelector('.shortcut-item[onclick="navigateTo(\'settings\')"] .shortcut-icon');
    if (profileShortcutIcon) {
        if (photoURL) {
            profileShortcutIcon.innerHTML = getIconHTML(photoURL);
            profileShortcutIcon.style.background = `linear-gradient(135deg, ${color}, rgba(0,0,0,0.4))`;
            profileShortcutIcon.style.boxShadow = `0 10px 20px ${color}44`;
        } else {
            profileShortcutIcon.innerHTML = `<img src="${IMAGE_ICONS_PATH}088-man.png" alt="Avatar">`;
            profileShortcutIcon.style.background = `linear-gradient(135deg, #94a3b8, #475569)`;
            profileShortcutIcon.style.boxShadow = `0 10px 20px rgba(0,0,0,0.2)`;
        }
    }

    // 2. Aggiorna avatar nelle impostazioni (se presente)
    const profileAvatar = document.querySelector('.profile-avatar');
    if (profileAvatar) {
        const img = profileAvatar.querySelector('#current-profile-img');
        if (img) {
            img.src = photoURL ? `${IMAGE_ICONS_PATH}${photoURL}` : `${IMAGE_ICONS_PATH}088-man.png`;
        }
        profileAvatar.style.borderColor = color || 'var(--primary-color)';
        // Aggiunge l'effetto glow dinamico (stile iOS/Glassmorphism)
        profileAvatar.style.boxShadow = photoURL ? `0 0 30px ${color}88` : `0 0 20px rgba(56, 189, 248, 0.3)`;
    }
}
 
 // Rendi disponibile globalmente per l'uso negli attributi onclick (es. nel modal)
 window.updateUserAvatarUI = updateUserAvatarUI;
 
 async function autoSelectGiornata() {
    try {
        const activeLockedMatchday = await getActiveLockedMatchday();
        if (activeLockedMatchday) {
            currentGiornata = activeLockedMatchday.giornata;
            console.log("Selected active locked giornata:", currentGiornata);
            return;
        }

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
    initAuthListener();
    setupEventListeners();
    
    window.addEventListener('navigate', (e) => navigateTo(e.detail));
});

function cleanupListeners() {
    activeListeners.forEach(unsubscribe => {
        if (typeof unsubscribe === 'function') unsubscribe();
    });
    activeListeners = [];
    cleanupPlayerListeners();
}

function cleanupAuthListener() {
    if (userDocUnsubscribe) {
        userDocUnsubscribe();
        userDocUnsubscribe = null;
    }
}

function initAuthListener() {
    onAuthChange(async (user) => {
        try {
            if (user) {
                cleanupAuthListener();

                let userData = null;
                try {
                    userData = await getUserData(user.uid);
                    if (!userData) {
                        // Durante la registrazione Firebase Auth può notificare prima che il profilo Firestore sia creato.
                        await new Promise(resolve => setTimeout(resolve, 500));
                        userData = await getUserData(user.uid);
                    }
                } catch (error) {
                    console.error("Errore nel caricamento iniziale del profilo:", error);
                }

                currentUser = {
                    ...user,
                    uid: user.uid,
                    email: user.email,
                    displayName: userData?.displayName || user.displayName || user.email?.split('@')[0] || 'Utente',
                    role: userData?.role || 'player',
                    totalPoints: userData?.totalPoints || 0,
                    exactResultsCount: userData?.exactResultsCount || 0,
                    photoURL: userData?.photoURL || user.photoURL || ''
                };
                if (!hasSelectedInitialGiornata) {
                    hasSelectedInitialGiornata = true;
                    await autoSelectGiornata();
                }

                initAuthUI();
                navigateTo('dashboard');
                updateUserSettingsUI();

                // Monitoraggio real-time del documento utente per rilevare eliminazioni o cambi ruolo
                userDocUnsubscribe = onSnapshot(doc(db, "users", user.uid), (snapshot) => {
                    if (!snapshot.exists()) {
                        // Se l'utente era già loggato (avevamo i suoi dati) e il doc sparisce, allora è stato eliminato
                        if (currentUser && currentUser.uid === user.uid) {
                            console.warn("L'account è stato eliminato dal database. Logout forzato.");
                            showNotification("Il tuo account non è più attivo.", "error");
                            logout();
                        } else {
                            // Altrimenti siamo in fase di registrazione/primo login, aspettiamo che venga creato
                            console.log("In attesa della creazione del profilo utente...");
                        }
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
                    showNotification("Aggiornamento live profilo non disponibile. Sessione mantenuta.", "warning");
                });

            } else {
                currentUser = null;
                hasSelectedInitialGiornata = false;
                cleanupListeners();
                cleanupAuthListener();
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
    
    // Aggiorna l'avatar ovunque (Dashboard e Impostazioni)
    updateUserAvatarUI(currentUser.photoURL);

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
        const { user, error } = await register(email, pass, name);
        if (error) {
            toggleLoading(false);
            showNotification(error, "error");
        } else {
            // Il login automatico viene gestito dal listener onAuthChange
            showNotification(`Benvenuto ${name}! Accesso in corso...`, "success");
        }
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
    document.getElementById('logout-btn').onclick = () => {
        modalManager.confirm(
            "Conferma Logout",
            "Vuoi uscire dalla sessione corrente?",
            async () => {
                toggleLoading(true);
                const { error } = await logout();
                toggleLoading(false);
                if (error) showNotification(error, "error");
            }
        );
    };

    const openIconSelector = async () => {
        toggleLoading(true);
        const users = await getAllUsers();
        toggleLoading(false);
        
        const takenIcons = users
            .filter(u => u.uid !== currentUser.uid && u.photoURL)
            .map(u => u.photoURL);
        
        const originalIcon = currentUser.photoURL || '';
        let selectedIcon = originalIcon;
        window.lastSelectedIcon = selectedIcon;

        const selectorModal = modalManager.openModal({
            title: 'Scegli la tua Icona',
            content: `
                <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 15px; text-align: center;">Ogni giocatore deve avere un'icona unica.</p>
                <div class="icon-selector-grid">
                    ${AVAILABLE_ICONS.map(icon => {
                        const isTaken = takenIcons.includes(icon.id);
                        const isSelected = selectedIcon === icon.id;
                        const iconHTML = icon.isImage 
                            ? `<img src="${escapeHtmlAttribute(`${IMAGE_ICONS_PATH}${icon.id}`)}" alt="icon">`
                            : `<i class="fas ${icon.id}"></i>`;
                        
                        return `
                            <div class="icon-option ${isTaken ? 'taken' : ''} ${isSelected ? 'selected' : ''}" 
                                 data-icon="${escapeHtmlAttribute(icon.id)}" 
                                 style="color: ${icon.color}; --hover-color: ${icon.color}">
                                ${iconHTML}
                            </div>
                        `;
                    }).join('')}
                </div>
            `,
            onClose: () => {
                // Se chiudiamo senza aver salvato, ripristiniamo l'avatar originale
                if (window.lastSelectedIcon !== currentUser.photoURL) {
                    updateUserAvatarUI(currentUser.photoURL);
                }
            },
            buttons: [
                { text: 'Annulla', type: 'secondary' },
                { text: 'Salva Icona', type: 'primary', action: async (close) => {
                    const newIcon = window.lastSelectedIcon;
                    if (!newIcon) return showNotification("Seleziona un'icona!", "warning");
                    
                    // Se l'icona è la stessa, chiudi semplicemente
                    if (newIcon === currentUser.photoURL) return close();
                    
                    toggleLoading(true);
                    const { error } = await adminUpdateUser(currentUser.uid, { photoURL: newIcon });
                    toggleLoading(false);
                    
                    if (error) {
                        showNotification(error, "error");
                        // In caso di errore, ripristiniamo l'avatar originale
                        updateUserAvatarUI(currentUser.photoURL);
                    } else {
                        showNotification("Icona aggiornata!", "success");
                        // Non resettiamo l'avatar qui, perché lo farà il listener onSnapshot
                        close();
                    }
                }}
            ]
        });

        const modalEl = document.getElementById(selectorModal.id);
        modalEl?.querySelectorAll('.icon-option:not(.taken)').forEach(option => {
            option.onclick = () => {
                const iconId = option.dataset.icon;
                option.parentElement.querySelectorAll('.icon-option').forEach(el => el.classList.remove('selected'));
                option.classList.add('selected');
                window.lastSelectedIcon = iconId;
                updateUserAvatarUI(iconId);
            };
        });
    };

    document.getElementById('btn-select-icon').onclick = openIconSelector;
    
    const profileAvatarClickable = document.getElementById('profile-avatar-clickable');
    if (profileAvatarClickable) {
        profileAvatarClickable.onclick = openIconSelector;
    }

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
        html += `<img src="assets/image/icon/087-shield.png" style="width: 14px; margin-right: 5px; vertical-align: middle;"> Pronostici bloccati: <strong>${date.toLocaleDateString()} alle ${date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</strong>`;
    } else {
        html += `<img src="assets/image/icon/045-play.png" style="width: 14px; margin-right: 5px; vertical-align: middle; transform: rotate(-90deg);"> Nessun blocco impostato.`;
    }

    if (notes) {
        html += `<div style="margin-top: 5px; font-style: italic; color: var(--accent-color)"><img src="assets/image/icon/017-football-card.png" style="width: 14px; margin-right: 5px; vertical-align: middle;"> ${notes}</div>`;
    }

    info.innerHTML = html;
    info.style.display = (lockDateTime || notes) ? 'block' : 'none';
}

async function showUserProfile(user) {
    navigateTo('user-profile');
    document.getElementById('profile-username').textContent = `Pronostici di ${user.displayName || user.email}`;

    const container = document.getElementById('profile-predictions-list');
    container.innerHTML = '<div class="spinner"></div>';

    const configsByGiornata = {};
    await Promise.all(Array.from({ length: 38 }, async (_, index) => {
        const giornata = index + 1;
        configsByGiornata[giornata] = await getMatchdayConfig(giornata);
    }));

    const canViewProfileGiornata = (giornata) => isAdminUser() || isMatchdayClosed(configsByGiornata[giornata]);
    const latestClosedGiornata = [...Array(38).keys()]
        .map(i => i + 1)
        .filter(giornata => isMatchdayClosed(configsByGiornata[giornata]))
        .pop();

    let selectedProfileGiornata = canViewProfileGiornata(currentGiornata)
        ? currentGiornata
        : (latestClosedGiornata || currentGiornata);

    let currentConfig = null;
    let currentMatches = null;
    let currentPredictions = null;
    let profileMatchesUnsubscribe = null;
    let profilePredictionsUnsubscribe = null;
    let profileConfigUnsubscribe = null;

    const renderProfilePredictions = () => {
        if (!currentConfig || currentMatches === null || currentPredictions === null) return;

        if (!isAdminUser() && !isMatchdayClosed(currentConfig)) {
            renderResultsLockedMessage(container, selectedProfileGiornata);
            return;
        }

        container.innerHTML = '';
        if (currentMatches.length === 0) {
            container.innerHTML = '<p class="no-data">Nessuna partita trovata.</p>';
            return;
        }

        currentMatches.forEach(match => {
            const pred = currentPredictions[match.id];
            const hasPrediction = pred !== undefined;
            const isFinished = match.status === 'finished';
            const isDisabled = match.disabled === true;

            if (isDisabled) return; // Non mostrare partite disabilitate

            let predictionClass = '';
            if (isFinished && hasPrediction) {
                if (pred.pointsEarned === 3) predictionClass = 'prediction-exact';
                else if (pred.pointsEarned === 1) predictionClass = 'prediction-outcome';
                else if (pred.pointsEarned === 0) predictionClass = 'prediction-wrong';
            }

            const card = document.createElement('div');
            card.className = `match-card glass-card ${predictionClass}`;
            card.innerHTML = `
                <div class="match-info">
                    <span>${new Date(match.dateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    ${isFinished ? '<span class="badge" style="background:var(--success-color)">Terminata</span>' : '<span class="badge" style="background:var(--secondary-color)">In attesa</span>'}
                </div>
                <div class="match-teams">
                    <div class="team">
                        <img src="${getTeamLogo(match.homeTeam)}" class="team-logo">
                        <span class="team-name" style="font-size: 0.8rem;">${match.homeTeam}</span>
                    </div>
                    <div class="score-display">
                        <span class="score-input" style="width: 35px; height: 35px; font-size: 1rem;">${isFinished ? match.homeScoreReal : '-'}</span>
                        <span class="vs">-</span>
                        <span class="score-input" style="width: 35px; height: 35px; font-size: 1rem;">${isFinished ? match.awayScoreReal : '-'}</span>
                    </div>
                    <div class="team">
                        <img src="${getTeamLogo(match.awayTeam)}" class="team-logo">
                        <span class="team-name" style="font-size: 0.8rem;">${match.awayTeam}</span>
                    </div>
                </div>
                <div class="real-result glass-card">
                    <div style="font-size: 0.6rem; color: var(--text-muted); margin-bottom: 5px; text-transform: uppercase; font-weight: 800; letter-spacing: 1px;">Pronostico</div>
                    <div style="font-weight: 900; font-size: 1.2rem; margin-bottom: 8px;">${hasPrediction ? `${pred.homeScorePred} - ${pred.awayScorePred}` : 'N.P.'}</div>
                    ${isFinished && hasPrediction ? `<div class="points-badge">+${pred.pointsEarned || 0} PUNTI</div>` : ''}
                </div>
            `;
            container.appendChild(card);
        });
    };

    const cleanupProfileSubscriptions = () => {
        if (profileMatchesUnsubscribe) profileMatchesUnsubscribe();
        if (profilePredictionsUnsubscribe) profilePredictionsUnsubscribe();
        if (profileConfigUnsubscribe) profileConfigUnsubscribe();
        profileMatchesUnsubscribe = null;
        profilePredictionsUnsubscribe = null;
        profileConfigUnsubscribe = null;
    };

    const loadProfileGiornata = (giornata) => {
        cleanupProfileSubscriptions();
        selectedProfileGiornata = giornata;
        currentConfig = configsByGiornata[giornata] || null;
        currentMatches = null;
        currentPredictions = null;
        container.innerHTML = '<div class="spinner"></div>';

        if (!canViewProfileGiornata(giornata)) {
            renderResultsLockedMessage(container, giornata);
            return;
        }

        profileConfigUnsubscribe = subscribeToMatchdayConfig(giornata, (config) => {
            configsByGiornata[giornata] = config;
            currentConfig = config;
            renderProfilePredictions();
        });

        profileMatchesUnsubscribe = subscribeToMatches(giornata, (matches) => {
            currentMatches = matches;
            const matchIds = matches.map(m => m.id);

            if (profilePredictionsUnsubscribe) profilePredictionsUnsubscribe();
            profilePredictionsUnsubscribe = subscribeToPredictions(user.uid, matchIds, (preds) => {
                currentPredictions = preds;
                renderProfilePredictions();
            });
        });
    };

    activeListeners.push(cleanupProfileSubscriptions);

    renderMatchdayScroll(selectedProfileGiornata, 'profile-giornata-scroll', (giornata) => {
        selectedProfileGiornata = giornata;
        loadProfileGiornata(giornata);
    }, {
        isDisabled: (giornata) => !canViewProfileGiornata(giornata),
        onDisabledSelect: (giornata) => {
            renderResultsLockedMessage(container, giornata);
            showNotification(`La Giornata ${giornata} sarà disponibile solo dopo il blocco.`, "info");
        },
        disabledTitle: 'Disponibile solo dopo il blocco della giornata'
    });

    loadProfileGiornata(selectedProfileGiornata);
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
    } else if (view === 'user-profile') {
        const backBtn = document.getElementById('profile-back-btn');
        if (backBtn) backBtn.onclick = () => navigateTo('leaderboard');
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
        let avatarContent = initials;
        let avatarStyle = "";
        let color = 'var(--primary-color)';
        
        if (user.photoURL) {
            color = getIconColor(user.photoURL);
            avatarContent = `<img src="${IMAGE_ICONS_PATH}${user.photoURL}" alt="Avatar" style="width: 100%; height: 100%; object-fit: contain;">`;
            avatarStyle = `style="border: 1px solid ${color}88; background: rgba(0,0,0,0.2); box-shadow: 0 0 10px ${color}44"`;
        }

        const card = document.createElement('div');
        card.className = 'user-manage-card glass-card';
        card.innerHTML = `
            <div class="user-avatar-mini" ${avatarStyle}>${avatarContent}</div>
            <div class="user-manage-info">
                <h4>${user.displayName || 'Utente'}</h4>
                <p>${user.email}</p>
                <span class="badge" style="background: ${user.role === 'admin' ? 'var(--primary-color)' : 'var(--secondary-color)'}; font-size: 0.6rem;">${user.role.toUpperCase()}</span>
            </div>
            <div class="user-manage-actions">
                <button class="action-btn edit" title="Modifica"><img src="assets/image/icon/099-creative-writing.png" style="width: 20px;"></button>
                <button class="action-btn delete" title="Elimina"><img src="assets/image/icon/026-bomb.png" style="width: 20px;"></button>
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

                        const saveUserChanges = async () => {
                            toggleLoading(true);
                            const { error } = await adminUpdateUser(user.uid, { displayName: newName, role: newRole });
                            toggleLoading(false);
                            if (error) showNotification(error, 'error');
                            else {
                                showNotification("Utente aggiornato con successo!", "success");
                                close();
                                initUserManagement(); // Refresh list
                            }
                        };

                        if (newRole !== user.role) {
                            modalManager.confirm(
                                "Conferma Cambio Ruolo",
                                `Vuoi cambiare il ruolo di <strong>${user.displayName || user.email}</strong> da ${user.role} a ${newRole}?`,
                                saveUserChanges
                            );
                            return;
                        }

                        await saveUserChanges();
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
        // Filtriamo le partite disabilitate per il conteggio della dashboard
        const activeMatches = currentMatches.filter(m => !m.disabled);
        const totalMatches = activeMatches.length;
        
        // Contiamo solo i pronostici delle partite attive
        const activeMatchIds = activeMatches.map(m => m.id);
        const predictionsCount = Object.keys(currentPredictions).filter(matchId => activeMatchIds.includes(matchId)).length;
        
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

            // Determina il contenuto dell'avatar (Icona immagine o Iniziali)
            let avatarContent = initials;
            let avatarStyle = "";
            let color = 'var(--primary-color)';
            
            if (user.photoURL) {
                color = getIconColor(user.photoURL);
                avatarContent = `<img src="${IMAGE_ICONS_PATH}${user.photoURL}" alt="Avatar" style="width: 100%; height: 100%; object-fit: contain;">`;
                avatarStyle = `style="border: 1px solid ${color}88; background: rgba(0,0,0,0.2); box-shadow: 0 0 10px ${color}44"`;
            }

            const tr = document.createElement('tr');
            tr.className = `leaderboard-row ${isMe ? 'me' : ''}`;
            tr.style.cursor = 'pointer';
            tr.onclick = () => showUserProfile(user);
            tr.innerHTML = `
                <td>
                    <div class="rank-badge ${rankClass}">${rank}</div>
                </td>
                <td>
                    <div class="user-cell">
                        <div class="user-avatar-mini" ${avatarStyle}>${avatarContent}</div>
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

    let currentMatches = [];
    let currentPredictions = {};
    let currentConfig = null;
    let predictionsUnsubscribe = null;

    const render = () => {
        if (!isAdminUser() && !isMatchdayClosed(currentConfig)) {
            renderResultsLockedMessage(container, giornata);
            return;
        }

        container.innerHTML = '';
        if (currentMatches.length === 0) {
            container.innerHTML = `<div class="no-data"><p>Nessun risultato per la Giornata ${giornata}.</p></div>`;
            return;
        }

        // Group matches by date
        const groupedMatches = {};
        currentMatches.forEach(match => {
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
            const header = document.createElement('div');
            header.className = 'match-day-header';
            
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.textContent = date;
            header.appendChild(divider);
            
            container.appendChild(header);

            dayMatches.forEach(match => {
                const isFinished = match.status === 'finished';
                const isDisabled = match.disabled === true;
                const pred = currentPredictions[match.id];
                const hasPrediction = pred !== undefined;

                // Determina la classe del pronostico basata sui punti guadagnati
                let predictionClass = '';
                if (isFinished && hasPrediction && !isDisabled) {
                    if (pred.pointsEarned === 3) predictionClass = 'prediction-exact';
                    else if (pred.pointsEarned === 1) predictionClass = 'prediction-outcome';
                    else if (pred.pointsEarned === 0) predictionClass = 'prediction-wrong';
                }

                const div = document.createElement('div');
                div.className = `match-card glass-card ${isDisabled ? 'is-disabled' : ''} ${predictionClass}`;
                div.innerHTML = `
                    ${isDisabled ? `
                        <div class="match-disabled-overlay">
                            <img src="assets/image/icon/026-bomb.png" style="width: 50px;">
                            <span>Partita Disabilitata</span>
                        </div>
                    ` : ''}
                    <div class="match-info">
                        <span>${new Date(match.dateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        ${isDisabled ? '<span class="badge" style="background:var(--danger-color)">Disabilitata</span>' : (isFinished ? '<span class="badge" style="background:var(--success-color)">Terminata</span>' : '<span class="badge" style="background:var(--secondary-color)">In attesa</span>')}
                    </div>
                    <div class="match-teams">
                        <div class="team">
                            <img src="${getTeamLogo(match.homeTeam)}" class="team-logo">
                            <span class="team-name">${match.homeTeam}</span>
                        </div>
                        <div class="score-display">
                            <span class="score-input">${isFinished && !isDisabled ? match.homeScoreReal : '-'}</span>
                            <span class="vs">-</span>
                            <span class="score-input">${isFinished && !isDisabled ? match.awayScoreReal : '-'}</span>
                        </div>
                        <div class="team">
                            <img src="${getTeamLogo(match.awayTeam)}" class="team-logo">
                            <span class="team-name">${match.awayTeam}</span>
                        </div>
                    </div>
                    ${hasPrediction && !isDisabled ? `
                        <div class="real-result glass-card">
                            <div style="font-size: 0.6rem; color: var(--text-muted); margin-bottom: 5px; text-transform: uppercase; font-weight: 800; letter-spacing: 1px;">Il tuo pronostico</div>
                            <div style="font-weight: 900; font-size: 1.2rem; margin-bottom: 8px;">${pred.homeScorePred} - ${pred.awayScorePred}</div>
                            ${isFinished ? `<div class="points-badge">+${pred.pointsEarned || 0} PUNTI</div>` : ''}
                        </div>
                    ` : (isFinished && !isDisabled ? '<div style="margin-top: 15px; font-size: 0.75rem; color: var(--text-muted); font-style: italic; text-align: center;">Nessun pronostico inserito</div>' : '')}
                `;
                container.appendChild(div);
            });
        }
    };

    activeListeners.push(subscribeToMatchdayConfig(giornata, (config) => {
        currentConfig = config;
        render();
    }));

    activeListeners.push(subscribeToMatches(giornata, (matches) => {
        currentMatches = matches;
        const matchIds = matches.map(m => m.id);
        
        if (predictionsUnsubscribe) predictionsUnsubscribe();
        predictionsUnsubscribe = subscribeToPredictions(currentUser.uid, matchIds, (preds) => {
            currentPredictions = preds;
            render();
        });
        activeListeners.push(predictionsUnsubscribe);
        render();
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
            const isDisabled = match.disabled === true;
            const div = document.createElement('div');
            div.className = `match-card glass-card ${!isLocked ? 'locked' : ''} ${isDisabled ? 'is-disabled' : ''}`;
            div.innerHTML = `
                ${isDisabled ? `
                    <div class="match-disabled-overlay">
                        <img src="assets/image/icon/026-bomb.png" style="width: 50px;">
                        <span>Partita Disabilitata</span>
                    </div>
                ` : ''}
                <div class="match-header-actions">
                    <button class="btn-match-menu" title="Opzioni Partita">
                        <img src="assets/image/icon/045-play.png" style="width: 15px; transform: rotate(90deg);">
                    </button>
                </div>
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
                        <input type="number" class="score-input res-home" value="${match.homeScoreReal ?? ''}" placeholder="H" ${!isLocked || isDisabled ? 'disabled' : ''}>
                        <span class="vs">-</span>
                        <input type="number" class="score-input res-away" value="${match.awayScoreReal ?? ''}" placeholder="A" ${!isLocked || isDisabled ? 'disabled' : ''}>
                    </div>
                    <div class="team">
                        <img src="${getTeamLogo(match.awayTeam)}" class="team-logo">
                        <span class="team-name">${match.awayTeam}</span>
                    </div>
                </div>
                <div class="match-footer">
                    <button class="btn-save-res btn-primary" ${!isLocked || isDisabled ? 'disabled' : ''}>
                        <img src="assets/image/icon/007-trophy.png" style="width: 18px; margin-right: 8px;"> ${isFinished ? 'Aggiorna' : 'Salva'}
                    </button>
                    ${isFinished && !isDisabled ? `
                        <button class="btn-reset-res" title="Resetta Risultato">
                            <img src="assets/image/icon/068-spaceship.png" style="width: 20px; transform: scaleX(-1);">
                        </button>
                    ` : ''}
                </div>
            `;

            // Gestione Menu a tre punti
            const menuBtn = div.querySelector('.btn-match-menu');
            menuBtn.onclick = () => {
                modalManager.openModal({
                    title: "Gestione Partita",
                    content: `
                        <div class="admin-edit-match-form" style="display: flex; flex-direction: column; gap: 15px;">
                            <div class="input-group">
                                <label style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 5px; display: block;">Squadra Casa</label>
                                <input type="text" id="edit-home-team" value="${match.homeTeam}" class="glass-input" style="width: 100%; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--glass-border); border-radius: 8px; color: white;">
                            </div>
                            <div class="input-group">
                                <label style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 5px; display: block;">Squadra Trasferta</label>
                                <input type="text" id="edit-away-team" value="${match.awayTeam}" class="glass-input" style="width: 100%; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--glass-border); border-radius: 8px; color: white;">
                            </div>
                            <div class="input-group">
                                <label style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 5px; display: block;">Data e Ora</label>
                                <input type="datetime-local" id="edit-match-date" value="${new Date(match.dateTime).toISOString().slice(0, 16)}" class="glass-input" style="width: 100%; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--glass-border); border-radius: 8px; color: white;">
                            </div>
                            <div class="input-group" style="display: flex; align-items: center; gap: 10px; padding: 10px; background: rgba(239, 68, 68, 0.1); border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.2);">
                                <input type="checkbox" id="edit-match-disabled" ${isDisabled ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer;">
                                <label for="edit-match-disabled" style="cursor: pointer; font-weight: 700; color: var(--danger-color);">Disabilita Partita</label>
                            </div>
                            <p style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">La disabilitazione nasconde la partita agli utenti e la esclude dal calcolo punti.</p>
                        </div>
                    `,
                    buttons: [
                        { text: 'Annulla', type: 'secondary' },
                        { 
                            text: 'Salva Modifiche', 
                            type: 'primary', 
                            action: async (close) => {
                                const newHome = document.getElementById('edit-home-team').value;
                                const newAway = document.getElementById('edit-away-team').value;
                                const newDate = document.getElementById('edit-match-date').value;
                                const newDisabled = document.getElementById('edit-match-disabled').checked;

                                const saveMatchDetails = async () => {
                                    toggleLoading(true);
                                    const success = await updateMatchDetails(match.id, {
                                        homeTeam: newHome,
                                        awayTeam: newAway,
                                        dateTime: new Date(newDate).toISOString(),
                                        disabled: newDisabled
                                    });
                                    toggleLoading(false);

                                    if (success) {
                                        showNotification("Partita aggiornata con successo!", "success");
                                        close();
                                    } else {
                                        showNotification("Errore durante l'aggiornamento.", "error");
                                    }
                                };

                                if (newDisabled !== isDisabled) {
                                    modalManager.confirm(
                                        newDisabled ? "Disabilita Partita" : "Riabilita Partita",
                                        `${newDisabled ? "Disabilitare" : "Riabilitare"} questa partita modificherà la visibilità e ricalcolerà i punti. Vuoi continuare?`,
                                        saveMatchDetails
                                    );
                                    return;
                                }

                                await saveMatchDetails();
                            }
                        }
                    ]
                });
            };

            const saveBtn = div.querySelector('.btn-save-res');
            saveBtn.onclick = async () => {
                const h = div.querySelector('.res-home').value;
                const a = div.querySelector('.res-away').value;
                if (h === '' || a === '') return showNotification("Inserisci i risultati!", "error");

                modalManager.confirm(
                    isFinished ? "Aggiorna Risultato" : "Salva Risultato",
                    `Confermi il risultato ${match.homeTeam} ${h} - ${a} ${match.awayTeam}? I punti degli utenti verranno ricalcolati.`,
                    async () => {
                        toggleLoading(true);
                        const success = await updateMatchResult(match.id, h, a);
                        toggleLoading(false);
                        if (success) showNotification("Risultato salvato e punti calcolati!", "success");
                    }
                );
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
    
    // Configura il click sull'avatar nelle impostazioni per aprire il selettore
    const profileAvatar = document.querySelector('.profile-avatar');
    if (profileAvatar) {
        profileAvatar.style.cursor = 'pointer';
        profileAvatar.onclick = () => document.getElementById('btn-select-icon').click();
    }

    // Aggiorna l'avatar ovunque (Dashboard e Impostazioni)
    updateUserAvatarUI(currentUser.photoURL);
}
