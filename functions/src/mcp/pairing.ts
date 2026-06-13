// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {initializeApp, getApps} from "firebase-admin/app";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {randomInt} from "node:crypto";
import * as logger from "firebase-functions/logger";
import {WORD_LIST} from "./wordList";

if (getApps().length === 0) initializeApp();

/**
 * Mint one candidate WORD-NNNN pairing code (uppercase word, 4 digits).
 * Uses node:crypto randomInt (not Math.random) for unbiased selection.
 *
 * @return {string} A candidate code, e.g. "CRANE-7842".
 */
function mintCode(): string {
  if (WORD_LIST.length === 0) throw new Error("WORD_LIST is empty");
  const idx = randomInt(0, WORD_LIST.length);
  const word = WORD_LIST[idx];
  if (word === undefined) throw new Error("word list internal error");
  const digits = String(randomInt(0, 10000)).padStart(4, "0");
  return `${word}-${digits}`;
}

export const generatePairingCode = onCall(
  {region: "us-central1", cors: true},
  async (request) => {
    const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
    if (WORD_LIST.length < 2000 && !isEmulator) {
      // Handler-level guard only (no module-level throw — that would
      // brick discovery of every function in this codebase).
      throw new HttpsError(
        "failed-precondition",
        `Word list too small (${WORD_LIST.length}; need >= 2000).`,
      );
    }
    if (WORD_LIST.length < 2000 && isEmulator) {
      logger.warn(`[Dev] Word list stub (${WORD_LIST.length} entries).`);
    }

    const {sessionId} = (request.data ?? {}) as {sessionId?: string};
    if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
      throw new HttpsError("invalid-argument", "Invalid sessionId");
    }

    const db = getFirestore();
    const sessionDoc = await db
      .collection("anonymous_sessions")
      .doc(sessionId)
      .get();
    if (!sessionDoc.exists) {
      throw new HttpsError("not-found", "Session not found or expired");
    }

    const exp = new Date(Date.now() + 15 * 60_000);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = mintCode();
      const ref = db.collection("pairing_codes").doc(code);
      try {
        await db.runTransaction(async (tx) => {
          const existing = await tx.get(ref);
          if (existing.exists) {
            const d = existing.data();
            if (d && !d.used && d.expiresAt?.toDate() > new Date()) {
              throw Object.assign(new Error(), {isCollision: true});
            }
          }
          tx.set(ref, {
            sessionId,
            createdAt: FieldValue.serverTimestamp(),
            expiresAt: exp,
            used: false,
          });
        });
        return {code, expiresAt: exp.toISOString()};
      } catch (e: unknown) {
        const typed = e as {isCollision?: boolean};
        // Distinguish collision exhaustion from a transient Firestore
        // error so the client message is accurate.
        if (typed.isCollision && attempt < 4) continue;
        if (typed.isCollision) {
          throw new HttpsError(
            "internal",
            "Could not generate a unique pairing code; retry.",
          );
        }
        throw new HttpsError(
          "internal",
          "Temporary error generating pairing code; retry.",
        );
      }
    }
    // Unreachable (loop always returns or throws), but satisfies
    // noImplicitReturns.
    throw new HttpsError("internal", "Could not generate pairing code");
  },
);
