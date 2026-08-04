import { subscribeToMatches, subscribeToPredictions, subscribeToMatchdayConfig, savePrediction, deletePrediction } from "./db-service.js";
import { showNotification, toggleLoading, getTeamLogo } from "./ui.js";
import { modalManager } from "./modal-manager.js";

let activeMatchesUnsub = null;
let activePredsUnsub = null;
let activeConfigUnsub = null;
let largeCountdownInterval = null;

export const cleanupPlayerListeners = () => {
    if (activeMatchesUnsub) activeMatchesUnsub();
    if (activePredsUnsub) activePredsUnsub();
    if (activeConfigUnsub) activeConfigUnsub();
    if (largeCountdownInterval) {
        clearInterval(largeCountdownInterval);
        largeCountdownInterval = null;
    }
};

export const initPlayerMatchesLive = (giornata, userId) => {
    cleanupPlayerListeners();
    
    const container = document.getElementById('matches-list');
    container.innerHTML = '<div class="spinner"></div>';

    let currentMatches = null;
    let currentConfig = null;
    let currentPredictions = {};

    const updateLargeCountdown = (lockDate) => {
        const container = document.getElementById('predictions-countdown-container');
        const timerVal = document.getElementById('predictions-timer-val');
        
        if (largeCountdownInterval) clearInterval(largeCountdownInterval);
        
        if (!lockDate) {
            container.classList.add('hidden');
            return;
        }

        const target = new Date(lockDate).getTime();
        
        const update = () => {
            const now = Date.now();
            const distance = target - now;

            if (distance < 0) {
                container.classList.add('hidden');
                clearInterval(largeCountdownInterval);
                return;
            }

            container.classList.remove('hidden');
            
            const days = Math.floor(distance / (1000 * 60 * 60 * 24));
            const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);

            let timerText = "";
            if (days > 0) timerText += `${days}g `;
            timerText += `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
            timerVal.textContent = timerText;
        };

        update();
        largeCountdownInterval = setInterval(update, 1000);
    };

    const render = () => {
        // Only render if we have data from matches listener
        if (currentMatches === null) return;

        // Update large countdown for this matchday
        updateLargeCountdown(currentConfig?.lockDateTime);

        if (currentMatches.length === 0) {
            container.innerHTML = `<p class="no-data">Nessuna partita inserita per la Giornata ${giornata}.</p>`;
            return;
        }
        
        container.innerHTML = '';
        const now = Date.now();
        const lockDateStr = currentConfig?.lockDateTime;
        const notes = currentConfig?.notes || "";
        const giornataLockDate = lockDateStr ? new Date(lockDateStr) : null;

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

        // Display matchday notes and first date in a header if both exist
        const groupedEntries = Object.entries(groupedMatches);
        
        groupedEntries.forEach(([date, dayMatches], index) => {
            const header = document.createElement('div');
            header.className = 'match-day-header';
            
            // If it's the first date group and there are notes, put them in the same header
            if (index === 0 && notes) {
                const notesDiv = document.createElement('div');
                notesDiv.className = 'matchday-notice';
                notesDiv.innerHTML = `<img src="assets/image/icon/017-football-card.png" style="width: 20px;"> ${notes}`;
                header.appendChild(notesDiv);
            }
            
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.textContent = date;
            header.appendChild(divider);
            
            container.appendChild(header);

            dayMatches.forEach(match => {
                try {
                    const matchDate = new Date(match.dateTime);
                    const limitDate = giornataLockDate ? giornataLockDate.getTime() : matchDate.getTime();
                    const isLocked = now >= limitDate;
                    
                    let statusText = isLocked ? "Chiuso" : "Aperto";
                    let statusClass = isLocked ? "badge-admin" : "badge-player";

                    if (isLocked && giornataLockDate && now >= giornataLockDate.getTime()) {
                        statusText = "Giornata Chiusa";
                    } else if (isLocked) {
                        statusText = "Iniziata";
                    }

                    const pred = currentPredictions[match.id] || { homeScorePred: '', awayScorePred: '' };
                    const hasPrediction = currentPredictions[match.id] !== undefined;
                    const isDisabled = match.disabled === true;
                    const isFinished = match.status === 'finished';

                    // Recupera dati dalla cache locale se non c'è ancora un pronostico salvato
                    const cacheKey = `pred_cache_${userId}_${match.id}`;
                    let cachedData = { home: '', away: '' };
                    if (!hasPrediction) {
                        try {
                            const raw = localStorage.getItem(cacheKey);
                            if (raw) cachedData = JSON.parse(raw);
                        } catch (e) { console.warn("Cache error", e); }
                    }

                    const displayHome = pred.homeScorePred !== '' ? pred.homeScorePred : cachedData.home;
                    const displayAway = pred.awayScorePred !== '' ? pred.awayScorePred : cachedData.away;
                    const hasAnyValue = displayHome !== '' || displayAway !== '';

                    // Determina la classe del pronostico basata sui punti guadagnati
                    let predictionClass = '';
                    if (isFinished && hasPrediction && !isDisabled) {
                        if (pred.pointsEarned === 3) predictionClass = 'prediction-exact';
                        else if (pred.pointsEarned === 1) predictionClass = 'prediction-outcome';
                        else if (pred.pointsEarned === 0) predictionClass = 'prediction-wrong';
                    }

                    const card = document.createElement('div');
                    card.className = `match-card glass-card ${isLocked || isDisabled ? 'locked' : ''} ${isDisabled ? 'is-disabled' : ''} ${predictionClass}`;
                    card.innerHTML = `
                        ${isDisabled ? `
                            <div class="match-disabled-overlay">
                                <img src="assets/image/icon/026-bomb.png" style="width: 50px;">
                                <span>Partita Disabilitata</span>
                            </div>
                        ` : ''}
                        <div class="match-info">
                            <span>${match.dateTime ? matchDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--'}</span>
                            <span class="badge ${statusClass}"><img src="assets/image/icon/${isLocked ? '087-shield.png' : (isDisabled ? '026-bomb.png' : '099-creative-writing.png')}" style="width: 14px; vertical-align: middle; margin-right: 5px;"> ${isDisabled ? 'Disabilitata' : statusText}</span>
                        </div>
                        <div class="match-teams">
                            <div class="team">
                                <img src="${getTeamLogo(match.homeTeam)}" alt="${match.homeTeam || ''}" class="team-logo">
                                <span class="team-name">${match.homeTeam || 'Sconosciuta'}</span>
                            </div>
                            <div class="prediction-inputs">
                                <input type="number" class="score-input home-pred" value="${displayHome}" min="0" ${isLocked || isDisabled ? 'disabled' : 'placeholder="0"'}>
                                <span class="vs">-</span>
                                <input type="number" class="score-input away-pred" value="${displayAway}" min="0" ${isLocked || isDisabled ? 'disabled' : 'placeholder="0"'}>
                            </div>
                            <div class="team">
                                <img src="${getTeamLogo(match.awayTeam)}" alt="${match.awayTeam || ''}" class="team-logo">
                                <span class="team-name">${match.awayTeam || 'Sconosciuta'}</span>
                            </div>
                        </div>
                        ${isFinished && !isDisabled ? `
                            <div class="real-result glass-card">
                                <div style="font-size: 0.65rem; color: var(--text-muted); margin-bottom: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">Risultato Finale</div>
                                <div style="font-size: 1.5rem; font-weight: 900; margin-bottom: 12px; letter-spacing: 2px;">${match.homeScoreReal} - ${match.awayScoreReal}</div>
                                ${pred.pointsEarned !== undefined ? `<div class="points-badge">+${pred.pointsEarned} PUNTI</div>` : ''}
                            </div>
                        ` : ''}
                    <div class="match-footer">
                        <button class="btn-save-pred btn-primary" data-match-id="${match.id}" ${isLocked || isDisabled ? 'disabled' : ''}>
                            ${isDisabled ? '<img src="assets/image/icon/026-bomb.png" style="width: 18px; margin-right: 8px;"> Partita Disabilitata' : (isLocked ? '<img src="assets/image/icon/087-shield.png" style="width: 18px; margin-right: 8px;"> Scommessa Chiusa' : (hasPrediction ? '<img src="assets/image/icon/045-play.png" style="width: 18px; margin-right: 8px; transform: rotate(-90deg);"> Aggiorna Pronostico' : '<img src="assets/image/icon/007-trophy.png" style="width: 18px; margin-right: 8px;"> Conferma Pronostico'))}
                        </button>
                        ${(!isLocked && !isDisabled) ? `
                            <button class="btn-delete-pred" title="Elimina Pronostico" style="display: ${hasAnyValue || hasPrediction ? 'flex' : 'none'}">
                                <img src="assets/image/icon/026-bomb.png" style="width: 20px;">
                            </button>
                        ` : ''}
                    </div>
                `;

                    if (!isLocked && !isDisabled) {
                        const homeInput = card.querySelector('.home-pred');
                        const awayInput = card.querySelector('.away-pred');
                        const deleteBtn = card.querySelector('.btn-delete-pred');

                        // Salvataggio automatico in cache locale
                        const updateCache = () => {
                            const data = { home: homeInput.value, away: awayInput.value };
                            localStorage.setItem(cacheKey, JSON.stringify(data));
                            
                            // Mostra/nascondi cestino in tempo reale
                            if (deleteBtn) {
                                const hasInput = homeInput.value !== '' || awayInput.value !== '';
                                deleteBtn.style.display = (hasInput || hasPrediction) ? 'flex' : 'none';
                            }
                        };

                        homeInput.oninput = updateCache;
                        awayInput.oninput = updateCache;

                        const saveBtn = card.querySelector('.btn-save-pred');
                        saveBtn.onclick = async () => {
                            const homeScore = homeInput.value;
                            const awayScore = awayInput.value;
                            
                            if (homeScore === '' || awayScore === '') {
                                showNotification("Inserisci entrambi i punteggi!", "error");
                                return;
                            }

                            toggleLoading(true);
                            const success = await savePrediction(userId, match.id, homeScore, awayScore);
                            toggleLoading(false);
                            
                            if (success) {
                                localStorage.removeItem(cacheKey); // Pulisci cache dopo salvataggio
                                showNotification("Pronostico salvato!");
                            } else {
                                showNotification("Errore durante il salvataggio.", "error");
                            }
                        };

                        if (deleteBtn) {
                            deleteBtn.onclick = async () => {
                                // Se non è salvato nel DB, puliamo solo localmente
                                if (!hasPrediction) {
                                    homeInput.value = '';
                                    awayInput.value = '';
                                    localStorage.removeItem(cacheKey);
                                    deleteBtn.style.display = 'none';
                                    showNotification("Campi svuotati", "info");
                                    return;
                                }

                                modalManager.confirm(
                                    "Elimina Pronostico",
                                    "Vuoi eliminare questo pronostico?",
                                    async () => {
                                        toggleLoading(true);
                                        const success = await deletePrediction(userId, match.id);
                                        toggleLoading(false);
                                        if (success) {
                                            localStorage.removeItem(cacheKey); // Pulisci anche cache
                                            showNotification("Pronostico eliminato!", "info");
                                        }
                                        else showNotification("Errore durante l'eliminazione.", "error");
                                    }
                                );
                            };
                        }
                    }
                    container.appendChild(card);
                } catch (err) {
                    console.error("Error rendering player match:", match, err);
                }
            });
        });

        // Add "Conferma Tutti" button at the bottom if there are unlockable matches
        const unlockableMatches = currentMatches.filter(m => {
            const matchDate = new Date(m.dateTime);
            const limitDate = giornataLockDate ? giornataLockDate.getTime() : matchDate.getTime();
            return now < limitDate;
        });

        if (unlockableMatches.length > 1) {
            const footerActions = document.createElement('div');
            footerActions.className = 'view-footer-actions';
            footerActions.innerHTML = `
                <button id="btn-confirm-all" class="btn-primary" style="width: 100%; height: 55px; font-size: 1.1rem;">
                    <img src="assets/image/icon/007-trophy.png" style="width: 24px; margin-right: 10px;"> Conferma Tutti i Pronostici
                </button>
            `;
            // Inseriamo in cima alla lista
            container.prepend(footerActions);

            footerActions.querySelector('#btn-confirm-all').onclick = async () => {
                const predictionsToSave = [];
                let hasEmpty = false;

                unlockableMatches.forEach(m => {
                    const card = container.querySelector(`.btn-save-pred[data-match-id="${m.id}"]`).closest('.match-card');
                    const h = card.querySelector('.home-pred').value;
                    const a = card.querySelector('.away-pred').value;
                    if (h !== '' && a !== '') {
                        predictionsToSave.push({ matchId: m.id, home: h, away: a });
                    } else {
                        hasEmpty = true;
                    }
                });

                if (predictionsToSave.length === 0) {
                    return showNotification("Inserisci almeno un pronostico!", "warning");
                }

                if (hasEmpty) {
                    modalManager.confirm(
                        "Attenzione",
                        "Alcuni pronostici sono vuoti. Vuoi confermare solo quelli compilati?",
                        async () => {
                            toggleLoading(true);
                            let savedCount = 0;
                            for (const p of predictionsToSave) {
                                const success = await savePrediction(userId, p.matchId, p.home, p.away);
                                if (success) {
                                    savedCount++;
                                    localStorage.removeItem(`pred_cache_${userId}_${p.matchId}`);
                                }
                            }
                            toggleLoading(false);
                            if (savedCount > 0) showNotification(`${savedCount} pronostici salvati!`, "success");
                        }
                    );
                } else {
                    toggleLoading(true);
                    let savedCount = 0;
                    for (const p of predictionsToSave) {
                        const success = await savePrediction(userId, p.matchId, p.home, p.away);
                        if (success) {
                            savedCount++;
                            localStorage.removeItem(`pred_cache_${userId}_${p.matchId}`);
                        }
                    }
                    toggleLoading(false);
                    if (savedCount > 0) showNotification(`${savedCount} pronostici salvati!`, "success");
                }
            };
        }
    };

    activeConfigUnsub = subscribeToMatchdayConfig(giornata, (config) => {
        currentConfig = config;
        render();
    });

    activeMatchesUnsub = subscribeToMatches(giornata, (matches) => {
        currentMatches = matches;
        const matchIds = matches.map(m => m.id);
        
        if (activePredsUnsub) activePredsUnsub();
        activePredsUnsub = subscribeToPredictions(userId, matchIds, (preds) => {
            currentPredictions = preds;
            render();
        });
    });
};
