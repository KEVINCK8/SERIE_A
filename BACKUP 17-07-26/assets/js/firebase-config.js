import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBDK7pZVyuihhYxRB9phzhRMemkpOtExX0",
    authDomain: "serie-a-sbt.firebaseapp.com",
    projectId: "serie-a-sbt",
    storageBucket: "serie-a-sbt.firebasestorage.app",
    messagingSenderId: "933188306046",
    appId: "1:933188306046:web:a8bba9f5123945bf00842f",
    measurementId: "G-YCK5447JXC"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db, analytics };
