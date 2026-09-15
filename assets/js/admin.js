import { 
    collection, 
    addDoc, 
    updateDoc, 
    doc, 
    getDocs, 
    query, 
    where,
    getDoc,
    setDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { toggleLoading, showNotification } from "./ui.js";
import { clearCache } from "./db-service.js";
import { calendarData } from "./calendar-data.js";

export const importCalendar = async () => {
    toggleLoading(true);
    try {
        const matchesRef = collection(db, "matches");
        const existingMatches = await getDocs(matchesRef);
        
        let count = 0;
        for (const round of calendarData) {
            const batch = writeBatch(db);
            round.matches.forEach(m => {
                const newMatchRef = doc(matchesRef);
                batch.set(newMatchRef, {
                    giornata: round.giornata,
                    dateTime: round.date,
                    homeTeam: m[0],
                    awayTeam: m[1],
                    homeScoreReal: null,
                    awayScoreReal: null,
                    status: "scheduled",
                    createdAt: new Date().toISOString()
                });
                count++;
            });
            await batch.commit();
        }

        clearCache();
        showNotification(`Calendario importato con successo! ${count} partite caricate.`);
    } catch (error) {
        console.error("Error importing calendar:", error);
        showNotification("Errore durante l'importazione del calendario.", "error");
    } finally {
        toggleLoading(false);
    }
};

export const addMatch = async (matchData) => {
    try {
        await addDoc(collection(db, "matches"), {
            ...matchData,
            homeScoreReal: null,
            awayScoreReal: null,
            status: "scheduled",
            createdAt: new Date().toISOString()
        });
        clearCache();
        return true;
    } catch (error) {
        console.error("Error adding match:", error);
        return false;
    }
};

export const updateMatchResult = async (matchId, homeScore, awayScore) => {
    try {
        const matchRef = doc(db, "matches", matchId);
        await updateDoc(matchRef, {
            homeScoreReal: parseInt(homeScore),
            awayScoreReal: parseInt(awayScore),
            status: "finished"
        });
        clearCache();
        // Automatic points calculation
        await calculatePoints(true); 
        return true;
    } catch (error) {
        console.error("Error updating match result:", error);
        return false;
    }
};

export const updateMatchDetails = async (matchId, data) => {
    try {
        const matchRef = doc(db, "matches", matchId);
        await updateDoc(matchRef, {
            ...data,
            updatedAt: new Date().toISOString()
        });
        clearCache();
        // Se la disabilitazione è cambiata, ricalcoliamo i punti
        await calculatePoints(true);
        return true;
    } catch (error) {
        console.error("Error updating match details:", error);
        return false;
    }
};

export const toggleMatchDisabled = async (matchId, isDisabled) => {
    return updateMatchDetails(matchId, { disabled: isDisabled });
};

export const resetMatchResult = async (matchId) => {
    try {
        const matchRef = doc(db, "matches", matchId);
        await updateDoc(matchRef, {
            homeScoreReal: null,
            awayScoreReal: null,
            status: "scheduled"
        });
        clearCache();
        // Automatic points calculation
        await calculatePoints(true);
        return true;
    } catch (error) {
        console.error("Error resetting match result:", error);
        return false;
    }
};

// I pronostici storici possono contenere punteggi salvati come stringhe (es. "3").
// Per il calcolo, trattiamo sempre i valori numerici e non il loro tipo Firestore.
export const calculatePredictionScore = (match, prediction) => {
    if (!match || match.status !== 'finished' || match.disabled) {
        return { points: 0, isExact: false };
    }

    const values = [
        match.homeScoreReal,
        match.awayScoreReal,
        prediction.homeScorePred,
        prediction.awayScorePred
    ];

    // Evita di assegnare punti a documenti incompleti o con valori non validi.
    if (!values.every(value => value !== '' && value !== null && value !== undefined && Number.isInteger(Number(value)) && Number(value) >= 0)) {
        return { points: 0, isExact: false };
    }

    const [realHome, realAway, predHome, predAway] = values.map(Number);

    if (realHome === predHome && realAway === predAway) {
        return { points: 3, isExact: true };
    }

    const realOutcome = Math.sign(realHome - realAway);
    const predOutcome = Math.sign(predHome - predAway);
    return { points: realOutcome === predOutcome ? 1 : 0, isExact: false };
};

export const calculatePoints = async (silent = false) => {
    if (!silent) toggleLoading(true);
    try {
        // 1. Get all finished matches
        const matchesSnapshot = await getDocs(query(collection(db, "matches"), where("status", "==", "finished")));
        const matches = {};
        matchesSnapshot.forEach(doc => {
            matches[doc.id] = doc.data();
        });

        // 2. Get all predictions
        const predictionsSnapshot = await getDocs(collection(db, "predictions"));
        const userPoints = {}; // { userId: { points: 0, exact: 0 } }

        // Accumuliamo gli aggiornamenti e li inviamo in gruppi sotto il limite Firestore.
        const predictionUpdates = [];

        predictionsSnapshot.forEach(predictionDoc => {
            const pred = predictionDoc.data();
            const match = matches[pred.matchId];

            const { points, isExact } = calculatePredictionScore(match, pred);

            if (!userPoints[pred.userId]) {
                userPoints[pred.userId] = { points: 0, exact: 0 };
            }
            userPoints[pred.userId].points += points;
            if (isExact) userPoints[pred.userId].exact += 1;

            // Update prediction document with points earned if it changed
            if (pred.pointsEarned !== points) {
                predictionUpdates.push({ ref: predictionDoc.ref, points });
            }
        });

        // Un batch Firestore non può superare 500 operazioni. 450 lascia margine
        // e permette il ricalcolo anche con molti utenti e pronostici.
        const batchSize = 450;
        for (let index = 0; index < predictionUpdates.length; index += batchSize) {
            const batch = writeBatch(db);
            predictionUpdates.slice(index, index + batchSize).forEach(({ ref, points }) => {
                batch.update(ref, { pointsEarned: points });
            });
            await batch.commit();
        }

        // 3. Update all users' total points and exact results count (resetting those who might not have predictions anymore)
        const usersSnapshot = await getDocs(collection(db, "users"));
        for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            const stats = userPoints[userId] || { points: 0, exact: 0 };
            
            // Only update if stats changed to save writes
            const userData = userDoc.data();
            if (userData.totalPoints !== stats.points || userData.exactResultsCount !== stats.exact) {
                await updateDoc(userDoc.ref, {
                    totalPoints: stats.points,
                    exactResultsCount: stats.exact
                });
            }
        }

        clearCache();
        if (!silent) showNotification("Punteggi calcolati con successo!");
    } catch (error) {
        console.error("Error calculating points:", error);
        if (!silent) showNotification("Errore durante il calcolo dei punteggi.", "error");
    } finally {
        if (!silent) toggleLoading(false);
    }
};
