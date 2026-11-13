import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  updateProfile,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  addDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export type CreatorRole = 'artist' | 'creator' | 'dj';

export interface CreatorProfile {
  uid: string;
  displayName: string;
  role: CreatorRole;
  buyMeSodaHandle?: string;
  bio?: string;
}

export interface CreatorPrivateInfo {
  uid: string;
  email?: string;
  phone?: string;
  instagramHandle?: string;
  facebookPage?: string;
  tiktokHandle?: string;
  whatsappNumber?: string;
}

export interface SavedMusicProject {
  id: string;
  ownerId: string;
  title: string;
  genre: string;
  bpm: number;
  lyrics?: string;
  alignmentNotes?: string;
  kitName?: string;
}

export interface SavedSocialCampaign {
  id: string;
  ownerId: string;
  platform: 'instagram' | 'facebook' | 'tiktok' | 'whatsapp';
  headline: string;
  caption: string;
  trackTitle?: string;
}

export interface SodaSupportRecord {
  id: string;
  supporterId: string;
  supporterName: string;
  recipientHandle: string;
  recipientRole: 'artist' | 'creator' | 'dj' | 'owner';
  sodaCount: number;
  amountUsd: number;
  message?: string;
}

export interface PadSampleAssignment {
  id: string;
  ownerId: string;
  padId: string;
  sampleName: string;
  sourceType: 'catalog' | 'custom_audio';
  sourceTrackId: string;
  grooveStyle: 'afro' | 'house' | 'trap';
  bpm: number;
  sliceStartSec: number;
  sliceDurationSec: number;
  audioBase64?: string;
}

// Auth helpers
export async function signInWithGooglePopup(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const res = await signInWithPopup(auth, provider);
  return res.user;
}

export async function registerWithEmail(
  email: string,
  password: string,
  displayName: string
): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName.trim()) {
    await updateProfile(cred.user, { displayName: displayName.trim().slice(0, 80) });
  }
  await sendEmailVerification(cred.user);
  return cred.user;
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export function createPhoneRecaptcha(containerId: string): RecaptchaVerifier {
  return new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
}

export async function startPhoneSignIn(
  phoneNumber: string,
  verifier: RecaptchaVerifier
): Promise<ConfirmationResult> {
  return signInWithPhoneNumber(auth, phoneNumber, verifier);
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

// Firestore profile & private info
export async function upsertCreatorProfile(
  uid: string,
  data: {
    displayName: string;
    role: CreatorRole;
    buyMeSodaHandle?: string;
    bio?: string;
  }
): Promise<void> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  const safeName = data.displayName.trim().slice(0, 80) || 'Creator';
  const safeSoda = (data.buyMeSodaHandle || '').trim().slice(0, 80);
  const safeBio = (data.bio || '').trim().slice(0, 300);

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await setDoc(
        ref,
        {
          uid,
          displayName: safeName,
          role: data.role,
          buyMeSodaHandle: safeSoda,
          bio: safeBio,
          createdAt: snap.data().createdAt,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      await setDoc(ref, {
        uid,
        displayName: safeName,
        role: data.role,
        buyMeSodaHandle: safeSoda,
        bio: safeBio,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function getCreatorProfile(uid: string): Promise<CreatorProfile | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      uid: d.uid,
      displayName: d.displayName,
      role: d.role,
      buyMeSodaHandle: d.buyMeSodaHandle,
      bio: d.bio,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function upsertPrivateInfo(
  uid: string,
  info: Partial<Omit<CreatorPrivateInfo, 'uid'>>
): Promise<void> {
  const path = `users/${uid}/private/info`;
  const ref = doc(db, 'users', uid, 'private', 'info');
  try {
    const snap = await getDoc(ref);
    const prev = snap.exists() ? snap.data() : {};
    await setDoc(ref, {
      uid,
      email: (info.email ?? prev.email ?? '').slice(0, 160),
      phone: (info.phone ?? prev.phone ?? '').slice(0, 40),
      instagramHandle: (info.instagramHandle ?? prev.instagramHandle ?? '').slice(0, 80),
      facebookPage: (info.facebookPage ?? prev.facebookPage ?? '').slice(0, 120),
      tiktokHandle: (info.tiktokHandle ?? prev.tiktokHandle ?? '').slice(0, 80),
      whatsappNumber: (info.whatsappNumber ?? prev.whatsappNumber ?? '').slice(0, 40),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function getPrivateInfo(uid: string): Promise<CreatorPrivateInfo | null> {
  const path = `users/${uid}/private/info`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'private', 'info'));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      uid: d.uid,
      email: d.email,
      phone: d.phone,
      instagramHandle: d.instagramHandle,
      facebookPage: d.facebookPage,
      tiktokHandle: d.tiktokHandle,
      whatsappNumber: d.whatsappNumber,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveMusicProject(
  ownerId: string,
  payload: {
    title: string;
    genre: string;
    bpm: number;
    lyrics?: string;
    alignmentNotes?: string;
    kitName?: string;
  }
): Promise<string> {
  const path = 'projects';
  try {
    const docRef = await addDoc(collection(db, 'projects'), {
      ownerId,
      title: payload.title.trim().slice(0, 120) || 'Untitled Studio Session',
      genre: payload.genre.trim().slice(0, 60) || 'Afrobeats',
      bpm: Math.min(240, Math.max(40, Number(payload.bpm) || 112)),
      lyrics: (payload.lyrics || '').slice(0, 8000),
      alignmentNotes: (payload.alignmentNotes || '').slice(0, 4000),
      kitName: (payload.kitName || '').slice(0, 60),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function removeMusicProject(projectId: string): Promise<void> {
  const path = `projects/${projectId}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeUserProjects(
  ownerId: string,
  onData: (items: SavedMusicProject[]) => void
): Unsubscribe {
  const path = 'projects';
  const q = query(
    collection(db, 'projects'),
    where('ownerId', '==', ownerId),
    orderBy('updatedAt', 'desc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SavedMusicProject, 'id'>),
      }));
      onData(rows);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function saveSocialCampaign(
  ownerId: string,
  payload: {
    platform: 'instagram' | 'facebook' | 'tiktok' | 'whatsapp';
    headline: string;
    caption: string;
    trackTitle?: string;
  }
): Promise<void> {
  const path = 'social_campaigns';
  try {
    await addDoc(collection(db, 'social_campaigns'), {
      ownerId,
      platform: payload.platform,
      headline: payload.headline.trim().slice(0, 140) || 'Studio Release',
      caption: payload.caption.trim().slice(0, 2200) || 'New drop out now.',
      trackTitle: (payload.trackTitle || '').trim().slice(0, 120),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeUserCampaigns(
  ownerId: string,
  onData: (items: SavedSocialCampaign[]) => void
): Unsubscribe {
  const path = 'social_campaigns';
  const q = query(
    collection(db, 'social_campaigns'),
    where('ownerId', '==', ownerId),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SavedSocialCampaign, 'id'>),
      }));
      onData(rows);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function createSodaSupportPledge(payload: {
  supporterId: string;
  supporterName: string;
  recipientHandle: string;
  recipientRole: 'artist' | 'creator' | 'dj' | 'owner';
  sodaCount: number;
  amountUsd: number;
  message?: string;
}): Promise<void> {
  const path = 'soda_supports';
  try {
    await addDoc(collection(db, 'soda_supports'), {
      supporterId: payload.supporterId,
      supporterName: payload.supporterName.trim().slice(0, 80) || 'Supporter',
      recipientHandle: payload.recipientHandle.trim().slice(0, 80),
      recipientRole: payload.recipientRole,
      sodaCount: Math.max(1, Math.min(100, Math.round(payload.sodaCount))),
      amountUsd: Math.max(1, Math.min(1000, Number(payload.amountUsd))),
      message: (payload.message || '').trim().slice(0, 280),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeMySodaSupports(
  supporterId: string,
  onData: (items: SodaSupportRecord[]) => void
): Unsubscribe {
  const path = 'soda_supports';
  const q = query(
    collection(db, 'soda_supports'),
    where('supporterId', '==', supporterId),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SodaSupportRecord, 'id'>),
      }));
      onData(rows);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribePublicCreators(onData: (items: CreatorProfile[]) => void): Unsubscribe {
  const path = 'users';
  const q = query(collection(db, 'users'), orderBy('updatedAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({
        uid: d.id,
        displayName: d.data().displayName,
        role: d.data().role,
        buyMeSodaHandle: d.data().buyMeSodaHandle,
        bio: d.data().bio,
      }));
      onData(rows);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function savePadSampleAssignment(
  ownerId: string,
  payload: Omit<PadSampleAssignment, 'id' | 'ownerId'>
): Promise<void> {
  const safeOwner = ownerId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safePad = payload.padId.replace(/[^a-zA-Z0-9_-]/g, '');
  const docId = `${safeOwner}_${safePad}`.slice(0, 128);
  const path = `pad_assignments/${docId}`;
  const ref = doc(db, 'pad_assignments', docId);

  try {
    const snap = await getDoc(ref);
    const data: Record<string, unknown> = {
      ownerId,
      padId: payload.padId,
      sampleName: payload.sampleName.trim().slice(0, 120) || 'Discover Sample',
      sourceType: payload.sourceType,
      sourceTrackId: payload.sourceTrackId.trim().slice(0, 80) || 'custom',
      grooveStyle: payload.grooveStyle,
      bpm: Math.min(240, Math.max(40, Number(payload.bpm) || 112)),
      sliceStartSec: Math.max(0, Math.min(600, Number(payload.sliceStartSec) || 0)),
      sliceDurationSec: Math.max(0.1, Math.min(8, Number(payload.sliceDurationSec) || 1.5)),
      createdAt: snap.exists() ? snap.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (payload.audioBase64 && payload.audioBase64.length <= 300000) {
      data.audioBase64 = payload.audioBase64;
    }
    await setDoc(ref, data);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removePadSampleAssignment(ownerId: string, padId: string): Promise<void> {
  const safeOwner = ownerId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safePad = padId.replace(/[^a-zA-Z0-9_-]/g, '');
  const docId = `${safeOwner}_${safePad}`.slice(0, 128);
  const path = `pad_assignments/${docId}`;
  try {
    await deleteDoc(doc(db, 'pad_assignments', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeUserPadAssignments(
  ownerId: string,
  onData: (items: PadSampleAssignment[]) => void
): Unsubscribe {
  const path = 'pad_assignments';
  const q = query(
    collection(db, 'pad_assignments'),
    where('ownerId', '==', ownerId),
    orderBy('updatedAt', 'desc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<PadSampleAssignment, 'id'>),
      }));
      onData(rows);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}
