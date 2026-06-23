import { initializeApp }                                      from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithPopup,
         GoogleAuthProvider, createUserWithEmailAndPassword,
         signInWithEmailAndPassword, signOut, updateProfile } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, doc, getDoc, getDocFromServer, setDoc, addDoc,
         updateDoc, deleteDoc, collection, query, where,
         getDocs, orderBy, limit, serverTimestamp,
         writeBatch, onSnapshot, arrayUnion }                 from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            'AIzaSyAPv7gztZ-5q3C0WGrjsmu8cIYVOaLEgIg',
  authDomain:        'plasticnapi.firebaseapp.com',
  projectId:         'plasticnapi',
  storageBucket:     'plasticnapi.firebasestorage.app',
  messagingSenderId: '1077367041645',
  appId:             '1:1077367041645:web:df7ba5d9cc521f3d001964'
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

export {
  onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, updateProfile,
  doc, getDoc, getDocFromServer, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, orderBy, limit,
  serverTimestamp, writeBatch, onSnapshot, arrayUnion
};
