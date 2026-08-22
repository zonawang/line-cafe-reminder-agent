import {
  Firestore,
  Timestamp,
  type DocumentSnapshot
} from '@google-cloud/firestore';

import { env } from '../utils/env.js';
import type { Cafe } from './geminiMaps.js';

export type FavoriteCafe = Cafe & {
  id: string;
  savedAtMs: number;
};

export type PendingCafeAction = {
  id: string;
  ownerId: string;
  conversationId: string;
  kind: 'save' | 'remove' | 'visit' | 'reminder' | 'cancel_reminder';
  cafe: Cafe;
  favoriteId?: string;
  startTime?: string;
  durationMinutes?: number;
  remindAt?: string;
  reminderId?: string;
  expiresAtMs: number;
};

export type CafeReminderStatus =
  | 'scheduling'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'cancelled'
  | 'failed';

export type CafeReminder = {
  id: string;
  ownerId: string;
  conversationId: string;
  cafe: Cafe;
  visitAt: string;
  remindAt: string;
  durationMinutes: number;
  status: CafeReminderStatus;
  taskName?: string;
};

type StoredContext = {
  ownerId: string;
  conversationId: string;
  cafes: Cafe[];
  createdAt: Timestamp;
  expiresAt: Timestamp;
};

type StoredFavorite = Cafe & { savedAt: Timestamp };

type StoredPending = Omit<PendingCafeAction, 'id' | 'expiresAtMs'> & {
  createdAt: Timestamp;
  expiresAt: Timestamp;
  status: 'pending' | 'completed';
};

type StoredReminder = {
  ownerId: string;
  conversationId: string;
  cafe: Cafe;
  visitAt: Timestamp;
  remindAt: Timestamp;
  durationMinutes: number;
  status: CafeReminderStatus;
  taskName?: string;
  attempts: number;
  deliveryLockUntil: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  sentAt?: Timestamp;
  cancelledAt?: Timestamp;
  lastError?: string;
  expiresAt: Timestamp;
};

const CONTEXT_TTL_MS = 30 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;

const firestore = new Firestore({ projectId: env.GOOGLE_CLOUD_PROJECT });
const contexts = firestore.collection(env.FIRESTORE_CONTEXT_COLLECTION);
const favoriteOwners = firestore.collection(env.FIRESTORE_FAVORITES_COLLECTION);
const pendingActions = firestore.collection(env.FIRESTORE_PENDING_COLLECTION);
const reminders = firestore.collection(env.FIRESTORE_REMINDERS_COLLECTION);

function favorites(ownerId: string) {
  return favoriteOwners.doc(ownerId).collection('items');
}

export async function saveRecommendationContext(input: {
  ownerId: string;
  conversationId: string;
  cafes: Cafe[];
}): Promise<void> {
  const now = Date.now();
  await contexts.doc(input.ownerId).set({
    ...input,
    createdAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(now + CONTEXT_TTL_MS)
  } satisfies StoredContext);
}

export async function getRecommendationContext(
  ownerId: string,
  conversationId: string
): Promise<Cafe[]> {
  const snapshot = await contexts.doc(ownerId).get();
  if (!snapshot.exists) return [];
  const data = snapshot.data() as StoredContext;
  if (data.conversationId !== conversationId || data.expiresAt.toMillis() <= Date.now()) {
    return [];
  }
  return data.cafes;
}

export async function listFavorites(ownerId: string): Promise<FavoriteCafe[]> {
  const snapshot = await favorites(ownerId).orderBy('savedAt', 'desc').limit(20).get();
  return snapshot.docs.map((document) => {
    const data = document.data() as StoredFavorite;
    return {
      id: document.id,
      title: data.title,
      uri: data.uri,
      savedAtMs: data.savedAt.toMillis()
    };
  });
}

export async function createPendingAction(
  input: Omit<PendingCafeAction, 'id' | 'expiresAtMs'>
): Promise<PendingCafeAction> {
  const now = Date.now();
  const document = pendingActions.doc();
  const stored: StoredPending = {
    ...input,
    createdAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(now + PENDING_TTL_MS),
    status: 'pending'
  };
  await document.set(stored);
  return { ...input, id: document.id, expiresAtMs: stored.expiresAt.toMillis() };
}

export class PendingActionError extends Error {
  constructor(public readonly code: 'not_found' | 'expired' | 'forbidden' | 'completed') {
    super(`Pending cafe action unavailable: ${code}`);
  }
}

export async function executePendingAction(
  pendingId: string,
  ownerId: string,
  conversationId: string
): Promise<PendingCafeAction> {
  const document = pendingActions.doc(pendingId);

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists) throw new PendingActionError('not_found');
    const data = snapshot.data() as StoredPending;
    if (data.ownerId !== ownerId || data.conversationId !== conversationId) {
      throw new PendingActionError('forbidden');
    }
    if (data.expiresAt.toMillis() <= Date.now()) throw new PendingActionError('expired');
    if (data.status !== 'pending') throw new PendingActionError('completed');

    let reminderSnapshot: DocumentSnapshot | undefined;
    if (data.kind === 'cancel_reminder') {
      if (!data.reminderId) throw new Error('Cancel reminder action has no reminder id');
      reminderSnapshot = await transaction.get(reminders.doc(data.reminderId));
      if (!reminderSnapshot.exists) throw new PendingActionError('not_found');
      const reminder = reminderSnapshot.data() as StoredReminder;
      if (reminder.ownerId !== ownerId || reminder.conversationId !== conversationId) {
        throw new PendingActionError('forbidden');
      }
    }

    if (data.kind === 'remove') {
      if (!data.favoriteId) throw new Error('Remove action has no favorite id');
      transaction.delete(favorites(ownerId).doc(data.favoriteId));
    } else if (data.kind === 'cancel_reminder') {
      transaction.update(reminderSnapshot!.ref, {
        status: 'cancelled',
        cancelledAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        deliveryLockUntil: Timestamp.fromMillis(0)
      });
    } else {
      transaction.set(favorites(ownerId).doc(document.id), {
        ...data.cafe,
        savedAt: Timestamp.now()
      } satisfies StoredFavorite);

      if (data.kind === 'reminder') {
        if (!data.startTime || !data.remindAt) {
          throw new Error('Reminder action is missing schedule timestamps');
        }
        const now = Timestamp.now();
        const visitAt = Timestamp.fromDate(new Date(data.startTime));
        transaction.set(reminders.doc(document.id), {
          ownerId,
          conversationId,
          cafe: data.cafe,
          visitAt,
          remindAt: Timestamp.fromDate(new Date(data.remindAt)),
          durationMinutes: data.durationMinutes ?? 90,
          status: 'scheduling',
          attempts: 0,
          deliveryLockUntil: Timestamp.fromMillis(0),
          createdAt: now,
          updatedAt: now,
          expiresAt: Timestamp.fromMillis(visitAt.toMillis() + 30 * 24 * 60 * 60 * 1000)
        } satisfies StoredReminder);
      }
    }
    transaction.update(document, { status: 'completed' });
    return {
      id: document.id,
      ownerId: data.ownerId,
      conversationId: data.conversationId,
      kind: data.kind,
      cafe: data.cafe,
      favoriteId: data.favoriteId,
      startTime: data.startTime,
      durationMinutes: data.durationMinutes,
      remindAt: data.remindAt,
      reminderId: data.reminderId,
      expiresAtMs: data.expiresAt.toMillis()
    };
  });
}

function toPublicReminder(id: string, data: StoredReminder): CafeReminder {
  return {
    id,
    ownerId: data.ownerId,
    conversationId: data.conversationId,
    cafe: data.cafe,
    visitAt: data.visitAt.toDate().toISOString(),
    remindAt: data.remindAt.toDate().toISOString(),
    durationMinutes: data.durationMinutes,
    status: data.status,
    taskName: data.taskName
  };
}

export async function listUpcomingReminders(ownerId: string): Promise<CafeReminder[]> {
  const snapshot = await reminders.where('ownerId', '==', ownerId).limit(50).get();
  return snapshot.docs
    .map((document) => toPublicReminder(document.id, document.data() as StoredReminder))
    .filter((reminder) =>
      ['scheduling', 'scheduled', 'sending'].includes(reminder.status) &&
      Date.parse(reminder.visitAt) > Date.now()
    )
    .sort((left, right) => Date.parse(left.remindAt) - Date.parse(right.remindAt))
    .slice(0, 20);
}

export async function getReminder(reminderId: string): Promise<CafeReminder | undefined> {
  const snapshot = await reminders.doc(reminderId).get();
  return snapshot.exists
    ? toPublicReminder(snapshot.id, snapshot.data() as StoredReminder)
    : undefined;
}

export async function markReminderScheduled(
  reminderId: string,
  taskName: string
): Promise<void> {
  const document = reminders.doc(reminderId);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists) return;
    const data = snapshot.data() as StoredReminder;
    if (data.status !== 'scheduling' && data.status !== 'failed') return;
    transaction.update(document, {
      status: 'scheduled',
      taskName,
      updatedAt: Timestamp.now(),
      lastError: null
    });
  });
}

export async function markReminderScheduleFailed(
  reminderId: string,
  error: string
): Promise<void> {
  const document = reminders.doc(reminderId);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists) return;
    const data = snapshot.data() as StoredReminder;
    if (data.status === 'sent' || data.status === 'cancelled') return;
    transaction.update(document, {
      status: 'failed',
      lastError: error.slice(0, 500),
      updatedAt: Timestamp.now()
    });
  });
}

export async function claimReminderDelivery(
  reminderId: string
): Promise<CafeReminder | undefined> {
  const document = reminders.doc(reminderId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists) return undefined;
    const data = snapshot.data() as StoredReminder;
    const now = Date.now();
    if (data.status === 'sent' || data.status === 'cancelled') return undefined;
    if (data.status === 'sending' && data.deliveryLockUntil.toMillis() > now) return undefined;
    transaction.update(document, {
      status: 'sending',
      attempts: data.attempts + 1,
      deliveryLockUntil: Timestamp.fromMillis(now + 2 * 60 * 1000),
      updatedAt: Timestamp.now()
    });
    return toPublicReminder(snapshot.id, data);
  });
}

export async function markReminderSent(reminderId: string): Promise<void> {
  await reminders.doc(reminderId).update({
    status: 'sent',
    sentAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    deliveryLockUntil: Timestamp.fromMillis(0)
  });
}

export async function releaseReminderDelivery(
  reminderId: string,
  error: string
): Promise<void> {
  await reminders.doc(reminderId).update({
    status: 'scheduled',
    lastError: error.slice(0, 500),
    updatedAt: Timestamp.now(),
    deliveryLockUntil: Timestamp.fromMillis(0)
  });
}

export async function cancelPendingAction(
  pendingId: string,
  ownerId: string,
  conversationId: string
): Promise<void> {
  const document = pendingActions.doc(pendingId);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists) return;
    const data = snapshot.data() as StoredPending;
    if (data.ownerId !== ownerId || data.conversationId !== conversationId) {
      throw new PendingActionError('forbidden');
    }
    transaction.delete(document);
  });
}
