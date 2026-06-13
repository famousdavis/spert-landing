// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

import {FieldValue} from "firebase-admin/firestore";
import type {DocumentData, Firestore} from "firebase-admin/firestore";

const SESSION_COLLECTION = "anonymous_sessions";

/**
 * Compute a fresh 7-day expiry timestamp from now.
 *
 * @return {Date} A Date 7 days in the future.
 */
function newExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d;
}

/**
 * Load a session document, treating logically-expired sessions as absent
 * (TTL deletion can lag up to 72h behind expiresAt).
 *
 * @param {Firestore} db Admin Firestore instance.
 * @param {string} sessionId Session document id.
 * @return {Promise<DocumentData | null>} Session data, or null if missing
 *   or past its expiresAt.
 */
export async function getSession(
  db: Firestore,
  sessionId: string,
): Promise<DocumentData | null> {
  const snap = await db.collection(SESSION_COLLECTION).doc(sessionId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  const exp = data.expiresAt?.toDate?.();
  if (exp && exp < new Date()) return null;
  return data;
}

/**
 * Refresh a session's activity timestamps and extend its expiry. Records
 * AI presence via aiLastSeenAt (the field the browser reads to show the
 * "AI connected" indicator).
 *
 * @param {Firestore} db Admin Firestore instance.
 * @param {string} sessionId Session document id.
 * @return {Promise<void>} Resolves when the update commits.
 */
export async function touchSession(
  db: Firestore,
  sessionId: string,
): Promise<void> {
  await db.collection(SESSION_COLLECTION).doc(sessionId).update({
    lastActiveAt: FieldValue.serverTimestamp(),
    aiLastSeenAt: FieldValue.serverTimestamp(),
    expiresAt: newExpiry(),
  });
}

/**
 * Whether the browser sent a heartbeat within the last 90 seconds.
 *
 * @param {DocumentData} session Session document data.
 * @return {boolean} True if a recent browserConnectedAt exists.
 */
export function isBrowserConnected(session: DocumentData): boolean {
  const t = session.browserConnectedAt?.toDate?.();
  return !!t && Date.now() - t.getTime() < 90_000;
}

/**
 * Append AI ops to a session's op-log inside a transaction, assigning a
 * gap-free monotonic seq to each. The browser's onSnapshot listener
 * replays ops in seq order; the transaction also refreshes the session's
 * activity timestamps and expiry.
 *
 * @param {Firestore} db Admin Firestore instance.
 * @param {string} sessionId Target session.
 * @param {Array<{op: string, payload: object}>} ops Ops to append.
 * @return {Promise<void>} Resolves when the transaction commits.
 */
export async function writeOpBatch(
  db: Firestore,
  sessionId: string,
  ops: Array<{op: string; payload: object}>,
): Promise<void> {
  if (!ops.length) return;
  if (ops.length > 400) {
    throw new Error(`Op batch too large: ${ops.length} (max 400)`);
  }
  const sessionRef = db.collection(SESSION_COLLECTION).doc(sessionId);
  const exp = newExpiry();
  await db.runTransaction(async (tx) => {
    const sessionDoc = await tx.get(sessionRef);
    if (!sessionDoc.exists) throw new Error("session_not_found");
    const data = sessionDoc.data();
    const currentSeq: number = (data?.lastSeq as number) ?? 0;
    tx.update(sessionRef, {
      lastSeq: currentSeq + ops.length,
      lastActiveAt: FieldValue.serverTimestamp(),
      aiLastSeenAt: FieldValue.serverTimestamp(),
      expiresAt: exp,
    });
    let seq = currentSeq;
    for (const {op, payload} of ops) {
      seq++;
      tx.set(sessionRef.collection("ops").doc(), {
        seq,
        op,
        payload,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: exp,
        source: "ai",
      });
    }
  });
}
