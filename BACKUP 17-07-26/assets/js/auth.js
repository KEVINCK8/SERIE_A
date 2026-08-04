import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut,
    updatePassword,
    deleteUser,
    EmailAuthProvider,
    reauthenticateWithCredential,
    updateProfile
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { 
    doc, 
    setDoc, 
    getDoc,
    getDocs,
    collection,
    updateDoc,
    deleteDoc,
    query,
    where,
    writeBatch
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

export const login = async (email, password) => {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // Verifica se l'account esiste ancora nel database Firestore
        const userData = await getUserData(user.uid);
        if (!userData) {
            await signOut(auth);
            return { user: null, error: "Questo account è stato disabilitato o rimosso definitivamente." };
        }
        
        return { user, error: null };
    } catch (error) {
        let message = error.message;
        if (error.code === 'auth/invalid-credential') message = "Email o password non corretti.";
        else if (error.code === 'auth/user-not-found') message = "Utente non trovato.";
        return { user: null, error: message };
    }
};

export const register = async (email, password, displayName) => {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // Aggiorna il profilo Auth subito dopo la creazione
        await updateProfile(user, { displayName });
        
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            email: user.email,
            displayName: displayName,
            role: "player",
            totalPoints: 0,
            exactResultsCount: 0,
            createdAt: new Date().toISOString()
        });
        
        // Effettua il login automatico (Firebase lo fa già internamente al register, 
        // ma noi ritorniamo l'utente per far scattare la UI nel listener)
        return { user, error: null };
    } catch (error) {
        console.error("Registration Error:", error);
        let message = "Errore durante la registrazione.";
        if (error.code === 'permission-denied') message = "Permesso negato sul database.";
        else if (error.code === 'auth/email-already-in-use') message = "Questa email è già registrata.";
        else if (error.code === 'auth/weak-password') message = "La password è troppo debole.";
        else message = `Errore: ${error.message}`;
        
        return { user: null, error: message };
    }
};

export const logout = async () => {
    try {
        await signOut(auth);
        return { error: null };
    } catch (error) {
        return { error: error.message };
    }
};

export const getUserData = async (uid) => {
    try {
        const docRef = doc(db, "users", uid);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? docSnap.data() : null;
    } catch (error) {
        console.error("Error getting user data:", error);
        return null;
    }
};

export const onAuthChange = (callback) => {
    onAuthStateChanged(auth, callback);
};

export const changeUserPassword = async (oldPassword, newPassword) => {
    const user = auth.currentUser;
    if (!user) return { error: "Utente non loggato" };

    try {
        const credential = EmailAuthProvider.credential(user.email, oldPassword);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newPassword);
        return { error: null };
    } catch (error) {
        return { error: error.message };
    }
};

export const deleteUserAccount = async (password) => {
    const user = auth.currentUser;
    if (!user) return { error: "Utente non loggato" };

    try {
        const credential = EmailAuthProvider.credential(user.email, password);
        await reauthenticateWithCredential(user, credential);
        
        // Cancellazione profonda dei dati
        await deleteUserData(user.uid);
        
        // Infine cancella l'utente dall'Auth
        await deleteUser(user);
        return { error: null };
    } catch (error) {
        return { error: error.message };
    }
};

const deleteUserData = async (uid) => {
    try {
        const batch = writeBatch(db);
        
        // 1. Cancella il documento del profilo
        batch.delete(doc(db, "users", uid));
        
        // 2. Trova e cancella tutti i pronostici dell'utente
        const predsQuery = query(collection(db, "predictions"), where("userId", "==", uid));
        const predsSnapshot = await getDocs(predsQuery);
        predsSnapshot.forEach((d) => {
            batch.delete(d.ref);
        });
        
        await batch.commit();
        console.log(`Dati utente ${uid} eliminati correttamente.`);
    } catch (error) {
        console.error("Errore nella cancellazione profonda:", error);
        throw error;
    }
};

export const getAllUsers = async () => {
    try {
        const snapshot = await getDocs(collection(db, "users"));
        const users = [];
        snapshot.forEach(doc => users.push(doc.data()));
        return users;
    } catch (error) {
        console.error("Error getting all users:", error);
        return [];
    }
};

export const adminUpdateUser = async (uid, data) => {
    try {
        const userRef = doc(db, "users", uid);
        await updateDoc(userRef, data);
        return { error: null };
    } catch (error) {
        return { error: error.message };
    }
};

export const adminDeleteUser = async (uid) => {
    try {
        await deleteUserData(uid);
        return { error: null };
    } catch (error) {
        return { error: error.message };
    }
};
