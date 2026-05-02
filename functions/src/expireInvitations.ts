import {
  FieldValue,
  getFirestore,
  Timestamp,
} from "firebase-admin/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";

const BATCH_SIZE = 500;

// TODO(spert-suite): 90-day hard-delete pass deferred.
// Requires composite index (status ASC, updatedAt ASC) on
// spertsuite_invitations. Add the index in a follow-up PR alongside
// the second batch-delete query for status in
// ["accepted","revoked","expired"] AND updatedAt < now-90d.

export const expireInvitations = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "Etc/UTC",
    region: "us-central1",
  },
  async () => {
    logger.info("expireInvitations invoked");

    const db = getFirestore();
    const now = Timestamp.now();

    const snap = await db
      .collection("spertsuite_invitations")
      .where("status", "==", "pending")
      .where("expiresAt", "<", now)
      .get();

    if (snap.empty) {
      logger.info("Expired 0 invitations");
      return;
    }

    let count = 0;
    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const slice = snap.docs.slice(i, i + BATCH_SIZE);
      const batch = db.batch();
      for (const doc of slice) {
        batch.update(doc.ref, {
          status: "expired",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      count += slice.length;
    }

    logger.info(`Expired ${count} invitations`);
  },
);
