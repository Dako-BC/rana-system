import { initializeApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
)

const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null
export const auth = app ? getAuth(app) : null
const db = app ? getFirestore(app) : null
const googleProvider = new GoogleAuthProvider()

const sessionsCollection = (uid) => collection(db, 'users', uid, 'sessions')
const sessionDoc = (uid, sessionId) => doc(db, 'users', uid, 'sessions', sessionId)

function mapSessionDoc(item) {
  const data = item.data()
  const { state, cloudUpdatedAt, ...session } = data
  return {
    ...session,
    id: item.id,
    updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : Date.now(),
  }
}

export function subscribeToAuth(callback) {
  if (!auth) {
    callback(null)
    return () => {}
  }
  return onAuthStateChanged(auth, callback)
}

export async function signInWithGoogleAccount() {
  if (!auth) throw new Error('Firebase is not configured.')
  return signInWithPopup(auth, googleProvider)
}

export async function signInWithEmail(email, password) {
  if (!auth) throw new Error('Firebase is not configured.')
  return signInWithEmailAndPassword(auth, email, password)
}

export async function createAccountWithEmail({ name, email, password }) {
  if (!auth) throw new Error('Firebase is not configured.')
  const credential = await createUserWithEmailAndPassword(auth, email, password)
  if (name?.trim()) {
    await updateProfile(credential.user, { displayName: name.trim() })
  }
  return credential
}

export async function signOutFirebase() {
  if (!auth) return
  await signOut(auth)
}

export async function getFirebaseIdToken() {
  if (!auth?.currentUser) return null
  return auth.currentUser.getIdToken()
}

export async function fetchUserSessions(uid, maxSessions) {
  if (!db || !uid) return []
  const q = query(sessionsCollection(uid), orderBy('updatedAt', 'desc'), limit(maxSessions))
  const snapshot = await getDocs(q)
  return snapshot.docs.map(mapSessionDoc)
}

export function subscribeToUserSessions(uid, maxSessions, callback, onError) {
  if (!db || !uid) {
    callback([])
    return () => {}
  }
  const q = query(sessionsCollection(uid), orderBy('updatedAt', 'desc'), limit(maxSessions))
  return onSnapshot(q, snapshot => {
    callback(snapshot.docs.map(mapSessionDoc))
  }, onError)
}

export async function fetchSessionState(uid, sessionId) {
  if (!db || !uid || !sessionId) return null
  const snapshot = await getDoc(sessionDoc(uid, sessionId))
  if (!snapshot.exists()) return null
  return snapshot.data().state || null
}

export async function saveSessionToCloud(uid, session, state) {
  if (!db || !uid || !session?.id) return
  await setDoc(sessionDoc(uid, session.id), {
    ...session,
    state,
    cloudUpdatedAt: serverTimestamp(),
  }, { merge: true })
}

export async function deleteSessionFromCloud(uid, sessionId) {
  if (!db || !uid || !sessionId) return
  await deleteDoc(sessionDoc(uid, sessionId))
}
