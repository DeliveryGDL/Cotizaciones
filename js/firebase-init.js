/* =========================================================
   DELIVERY GDL · Conexión a Firebase
   Un solo negocio, un solo usuario (correo/contraseña), datos
   compartidos entre todos sus dispositivos vía Firestore.
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCNooFiG2Yv6ot18lsDTl6HSlYekJr6ALI",
  authDomain: "deliveryg5-cotizador.firebaseapp.com",
  projectId: "deliveryg5-cotizador",
  storageBucket: "deliveryg5-cotizador.firebasestorage.app",
  messagingSenderId: "50757253291",
  appId: "1:50757253291:web:b5d7bbbc110154fefedfee",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Caché local persistente (IndexedDB): la app sigue funcionando sin señal
// y sincroniza sola en cuanto vuelve la conexión.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }),
});

export {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
};
