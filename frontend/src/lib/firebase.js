import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
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
googleProvider.addScope('email')
googleProvider.addScope('profile')
googleProvider.setCustomParameters({ prompt: 'select_account' })

const GOOGLE_REDIRECT_ERRORS = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported',
])

async function prepareAuth() {
  if (!auth) throw new Error('Firebase is not configured.')
  await setPersistence(auth, browserLocalPersistence)
}

export function getGoogleAuthErrorMessage(error) {
  const code = error?.code || ''
  const messages = {
    'auth/account-exists-with-different-credential': 'This email already uses another login method. Log in with that method first, then connect Google.',
    'auth/cancelled-popup-request': 'The previous Google login window was cancelled. Please try again.',
    'auth/network-request-failed': 'Google login could not reach Firebase. Check your internet connection and try again.',
    'auth/operation-not-allowed': 'Google login is not enabled in Firebase Authentication. Enable the Google provider in Firebase Console.',
    'auth/popup-blocked': 'The browser blocked the Google login window. Allow popups for this site and try again.',
    'auth/popup-closed-by-user': 'The Google login window was closed before sign-in completed.',
    'auth/unauthorized-domain': `This domain (${window.location.hostname}) is not authorized in Firebase. Add it under Authentication > Settings > Authorized domains.`,
    'auth/web-storage-unsupported': 'Google login needs browser storage. Enable cookies/site storage or use a normal browser window.',
  }
  return messages[code] || error?.message || 'Google login failed. Please try again.'
}

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
  await prepareAuth()
  try {
    return await signInWithPopup(auth, googleProvider)
  } catch (error) {
    if (!GOOGLE_REDIRECT_ERRORS.has(error?.code)) throw error
    await signInWithRedirect(auth, googleProvider)
    return null
  }
}

export async function completeGoogleRedirectSignIn() {
  await prepareAuth()
  return getRedirectResult(auth)
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
