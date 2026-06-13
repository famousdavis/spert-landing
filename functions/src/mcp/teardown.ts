// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {initializeApp, getApps} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

if (getApps().length === 0) initializeApp();

// Firestore batch hard limit is 500 ops; leave headroom at 499.
const CHUNK = 499;

export const teardownAiSession = onCall(
  {region: "us-central1", cors: true},
  async (request) => {
    const {sessionId} = (request.data ?? {}) as {sessionId?: string};
    if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
      throw new HttpsError("invalid-argument", "Invalid sessionId");
    }
    const db = getFirestore();
    const sessionRef = db.collection("anonymous_sessions").doc(sessionId);
    // listDocuments() returns refs for every op/snapshot doc (no reads).
    const [opRefs, snapRefs] = await Promise.all([
      sessionRef.collection("ops").listDocuments(),
      sessionRef.collection("snapshot").listDocuments(),
    ]);
    const allRefs = [...opRefs, ...snapRefs, sessionRef];
    for (let i = 0; i < allRefs.length; i += CHUNK) {
      const batch = db.batch();
      for (const ref of allRefs.slice(i, i + CHUNK)) batch.delete(ref);
      await batch.commit();
    }
    return {status: "ok", deletedDocs: allRefs.length};
  },
);
