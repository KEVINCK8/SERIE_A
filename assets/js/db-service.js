import { 
    collection, 
    query, 
    where, 
    getDocs, 
    doc, 
    setDoc, 
    updateDoc,
    deleteDoc, 
    orderBy, 
    limit,
    getDoc,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { db } from "./firebase-config.js";

// Cache object
const cache = {
    matches: {},
    predictions: {},
    leaderboard: null,
    lastUpdate: {}
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Real-time Subscriptions
export const subscribeToMatches = (giornata, callback) => {
    const q = query(collection(db, "matches"), where("giornata", "==", parseInt(giornata)));
    return onSnapshot(q, (snapshot) => {
        const matches = [];
        snapshot.forEach(doc => matches.push({ id: doc.id, ...doc.data() }));
        matches.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
        callback(matches);
    }, (error) => {
        console.error("Matches subscription error:", error);
    });
};

export const subscribeToMatchdayConfig = (giornata, callback) => {
    const docRef = doc(db, "matchdays", giornata.toString());
    return onSnapshot(docRef, (docSnap) => {
        const data = docSnap.exists() ? docSnap.data() : {
            lockDateTime: null,
            status: 'open',
            notes: ""
        };
        callback(data);
    }, (error) => {
        console.error("Config subscription error:", error);
    });
};

export const subscribeToLeaderboard = (callback) => {
    const q = query(collection(db, "users"), where("role", "!=", "admin"));
    return onSnapshot(q, (snapshot) => {
        const leaderboard = [];
        snapshot.forEach(doc => leaderboard.push({ uid: doc.id, ...doc.data() }));
        leaderboard.sort((a, b) => {
            if ((b.totalPoints || 0) !== (a.totalPoints || 0)) {
                return (b.totalPoints || 0) - (a.totalPoints || 0);
            }
            return (b.exactResultsCount || 0) - (a.exactResultsCount || 0);
        });
        callback(leaderboard);
    }, (error) => {
        console.error("Leaderboard subscription error:", error);
    });
};

export const subscribeToPredictions = (userId, matchIds, callback) => {
    if (!matchIds || matchIds.length === 0) {
        callback({});
        return () => {};
    }
    const q = query(collection(db, "predictions"), where("userId", "==", userId), where("matchId", "in", matchIds));
    return onSnapshot(q, (snapshot) => {
        const predictions = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            predictions[data.matchId] = { id: doc.id, ...data };
        });
        callback(predictions);
    }, (error) => {
        console.error("Predictions subscription error:", error);
    });
};

export const getMatchesByGiornata = async (giornata, status = null) => {
    const cacheKey = `matches_${giornata}_${status || 'all'}`;
    const now = Date.now();
    if (cache.matches[cacheKey] && (now - cache.lastUpdate[cacheKey] < CACHE_TTL)) {
        return cache.matches[cacheKey];
    }

    try {
        let q = query(collection(db, "matches"), where("giornata", "==", parseInt(giornata)));
        if (status) {
            q = query(q, where("status", "==", status));
        }
        
        const querySnapshot = await getDocs(q);
        const matches = [];
        querySnapshot.forEach((doc) => {
            matches.push({ id: doc.id, ...doc.data() });
        });
        
        // Sort client-side to avoid composite index requirement
        matches.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
        
        cache.matches[cacheKey] = matches;
        cache.lastUpdate[cacheKey] = now;
        return matches;
    } catch (error) {
        console.error("Error getting matches:", error);
        return [];
    }
};

export const getPredictionsByUser = async (userId, matchIds) => {
    if (!matchIds || matchIds.length === 0) return {};
    
    try {
        // Firestore 'in' query supports up to 10 items. For 10 matches it's fine.
        const q = query(collection(db, "predictions"), where("userId", "==", userId), where("matchId", "in", matchIds));
        const querySnapshot = await getDocs(q);
        const predictions = {};
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            predictions[data.matchId] = { id: doc.id, ...data };
        });
        return predictions;
    } catch (error) {
        console.error("Error getting predictions:", error);
        return {};
    }
};

export const deletePrediction = async (userId, matchId) => {
    const predictionId = `${userId}_${matchId}`;
    try {
        await deleteDoc(doc(db, "predictions", predictionId));
        return true;
    } catch (error) {
        console.error("Error deleting prediction:", error);
        return false;
    }
};

export const savePrediction = async (userId, matchId, homeScore, awayScore) => {
    const predictionId = `${userId}_${matchId}`;
    try {
        await setDoc(doc(db, "predictions", predictionId), {
            userId,
            matchId,
            homeScorePred: parseInt(homeScore),
            awayScorePred: parseInt(awayScore),
            updatedAt: new Date().toISOString()
        }, { merge: true });
        return true;
    } catch (error) {
        console.error("Error saving prediction:", error);
        return false;
    }
};

export const getLeaderboard = async () => {
    const now = Date.now();
    if (cache.leaderboard && (now - cache.lastUpdate.leaderboard < CACHE_TTL)) {
        return cache.leaderboard;
    }

    try {
        // Prendiamo tutti gli utenti (tranne admin) e ordiniamo lato client per evitare errori
        const q = query(collection(db, "users"), where("role", "!=", "admin"));
        const querySnapshot = await getDocs(q);
        const leaderboard = [];
        querySnapshot.forEach((doc) => {
            leaderboard.push(doc.data());
        });
        
        // Ordinamento lato client: Punti Totali (desc) e poi Risultati Esatti (desc)
        leaderboard.sort((a, b) => {
            if ((b.totalPoints || 0) !== (a.totalPoints || 0)) {
                return (b.totalPoints || 0) - (a.totalPoints || 0);
            }
            return (b.exactResultsCount || 0) - (a.exactResultsCount || 0);
        });
        
        cache.leaderboard = leaderboard;
        cache.lastUpdate.leaderboard = now;
        return leaderboard;
    } catch (error) {
        console.error("Error getting leaderboard:", error);
        return [];
    }
};

export const getMatchdayConfig = async (giornata) => {
    const cacheKey = `config_${giornata}`;
    const now = Date.now();
    if (cache[cacheKey] && (now - cache.lastUpdate[cacheKey] < CACHE_TTL)) {
        return cache[cacheKey];
    }

    try {
        const docRef = doc(db, "matchdays", giornata.toString());
        const docSnap = await getDoc(docRef);
        const data = docSnap.exists() ? docSnap.data() : {
            lockDateTime: null,
            status: 'open', // open, locked, finished
            isResultsVisible: true,
            notes: ""
        };
        
        cache[cacheKey] = data;
        cache.lastUpdate[cacheKey] = now;
        return data;
    } catch (error) {
        console.error("Error getting matchday config:", error);
        return null;
    }
};

export const getMatchdayLock = async (giornata) => {
    const config = await getMatchdayConfig(giornata);
    return config ? config.lockDateTime : null;
};

export const setMatchdayLock = async (giornata, lockDateTime) => {
    return updateMatchdayConfig(giornata, { 
        lockDateTime,
        status: lockDateTime ? 'locked_scheduled' : 'open' 
    });
};

export const removeMatchdayLock = async (giornata) => {
    return updateMatchdayConfig(giornata, { 
        lockDateTime: null,
        status: 'open'
    });
};

export const updateMatchdayConfig = async (giornata, configData) => {
    try {
        const docRef = doc(db, "matchdays", giornata.toString());
        await setDoc(docRef, {
            ...configData,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        clearCache(`config_${giornata}`);
        clearCache(`lock_${giornata}`);
        return true;
    } catch (error) {
        console.error("Error updating matchday config:", error);
        return false;
    }
};

export const clearCache = (key) => {
    if (key) {
        delete cache[key];
        delete cache.lastUpdate[key];
    } else {
        cache.matches = {};
        cache.predictions = {};
        cache.leaderboard = null;
        cache.lastUpdate = {};
    }
};
