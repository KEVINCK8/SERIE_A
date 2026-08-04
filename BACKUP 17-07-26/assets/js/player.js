import { subscribeToMatches, subscribeToPredictions, subscribeToMatchdayConfig, savePrediction, deletePrediction } from "./db-service.js";
import { showNotification, toggleLoading, getTeamLogo } from "./ui.js";
import { modalManager } from "./modal-manager.js";

let activeMatchesUnsub = null;
let activePredsUnsub = null;
let activeConfigUnsub = null;

export const cleanupPlayerListeners = () => {
    if (activeMatchesUnsub) activeMatchesUnsub();
    if (activePredsUnsub) activePredsUnsub();
    if (activeConfigUnsub) activeConfigUnsub();
};

export const initPlayerMatchesLive = (giornata, userId) => {
    cleanupPlayerListeners();
    
    const container = document.getElementById('matches-list');
    container.innerHTML = '<div class="spinner"></div>';

    let currentMatches = null;
    let currentConfig = null;
    let currentPredictions = {};

    const render = () => {
        // Only render if we have data from matches listener
        if (currentMatches === null) return;

        if (currentMatches.length === 0) {
            container.innerHTML = `<p class="no-data">Nessuna partita inserita per la Giornata ${giornata}.</p>`;
            return;
        }
        
        container.innerHTML = '';
        const now = Date.now();
        const lockDateStr = currentConfig?.lockDateTime;
        const notes = currentConfig?.notes || "";
        const giornataLockDate = lockDateStr ? new Date(lockDateStr) : null;

        // Display matchday notes if any
        if (notes) {
            const notesDiv = document.createElement('div');
            notesDiv.className = 'matchday-notice';
            notesDiv.innerHTML = `<i class="fas fa-info-circle"></i> ${notes}`;
            container.appendChild(notesDiv);
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
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.textContent = date;
            container.appendChild(divider);

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

                    const card = document.createElement('div');
                    card.className = `match-card glass-card ${isLocked ? 'locked' : ''}`;
                    card.innerHTML = `
                        <div class="match-info">
                            <span>${match.dateTime ? matchDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--'}</span>
                            <span class="badge ${statusClass}"><i class="fas fa-${isLocked ? 'lock' : 'edit'}"></i> ${statusText}</span>
                        </div>
                        <div class="match-teams">
                            <div class="team">
                                <img src="${getTeamLogo(match.homeTeam)}" alt="${match.homeTeam || ''}" class="team-logo">
                                <span class="team-name">${match.homeTeam || 'Sconosciuta'}</span>
                            </div>
                            <div class="prediction-inputs">
                                <input type="number" class="score-input home-pred" value="${pred.homeScorePred}" min="0" ${isLocked ? 'disabled' : 'placeholder="0"'}>
                                <span class="vs">-</span>
                                <input type="number" class="score-input away-pred" value="${pred.awayScorePred}" min="0" ${isLocked ? 'disabled' : 'placeholder="0"'}>
                            </div>
                            <div class="team">
                                <img src="${getTeamLogo(match.awayTeam)}" alt="${match.awayTeam || ''}" class="team-logo">
                                <span class="team-name">${match.awayTeam || 'Sconosciuta'}</span>
                            </div>
                        </div>
                        ${match.status === 'finished' ? `
                            <div class="real-result">
                                Risultato: <strong>${match.homeScoreReal} - ${match.awayScoreReal}</strong>
                                ${pred.pointsEarned !== undefined ? `<span class="points-badge">+${pred.pointsEarned} pt</span>` : ''}
                            </div>
                        ` : ''}
                    <div class="match-footer">
                        <button class="btn-save-pred btn-primary" data-match-id="${match.id}" ${isLocked ? 'disabled' : ''}>
                            ${isLocked ? '<i class="fas fa-lock"></i> Scommessa Chiusa' : (hasPrediction ? '<i class="fas fa-sync"></i> Aggiorna Pronostico' : '<i class="fas fa-check"></i> Conferma Pronostico')}
                        </button>
                        ${(!isLocked && hasPrediction) ? `
                            <button class="btn-delete-pred" title="Elimina Pronostico">
                                <i class="fas fa-trash-can"></i>
                            </button>
                        ` : ''}
                    </div>
                `;

                    if (!isLocked) {
                        const saveBtn = card.querySelector('.btn-save-pred');
                        saveBtn.onclick = async () => {
                            const homeScore = card.querySelector('.home-pred').value;
                            const awayScore = card.querySelector('.away-pred').value;
                            
                            if (homeScore === '' || awayScore === '') {
                                showNotification("Inserisci entrambi i punteggi!", "error");
                                return;
                            }

                            toggleLoading(true);
                            const success = await savePrediction(userId, match.id, homeScore, awayScore);
                            toggleLoading(false);
                            
                            if (success) {
                                showNotification("Pronostico salvato!");
                            } else {
                                showNotification("Errore durante il salvataggio.", "error");
                            }
                        };

                        const deleteBtn = card.querySelector('.btn-delete-pred');
                        if (deleteBtn) {
                            deleteBtn.onclick = async () => {
                                modalManager.confirm(
                                    "Elimina Pronostico",
                                    "Vuoi eliminare questo pronostico?",
                                    async () => {
                                        toggleLoading(true);
                                        const success = await deletePrediction(userId, match.id);
                                        toggleLoading(false);
                                        if (success) showNotification("Pronostico eliminato!", "info");
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
        }

        // Add "Conferma Tutti" button at the bottom if there are unlockable matches
        const unlockableMatches = currentMatches.filter(m => {
            const matchDate = new Date(m.dateTime);
            const limitDate = giornataLockDate ? giornataLockDate.getTime() : matchDate.getTime();
            return now < limitDate;
        });

        if (unlockableMatches.length > 1) {
            const footerActions = document.createElement('div');
            footerActions.className = 'view-footer-actions';
            footerActions.style.cssText = 'margin-top: 30px; padding: 20px 0; border-top: 1px solid var(--glass-border);';
            footerActions.innerHTML = `
                <button id="btn-confirm-all" class="btn-primary" style="width: 100%; height: 55px; font-size: 1.1rem;">
                    <i class="fas fa-check-double"></i> Conferma Tutti i Pronostici
                </button>
            `;
            container.appendChild(footerActions);

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
                                if (success) savedCount++;
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
                        if (success) savedCount++;
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
