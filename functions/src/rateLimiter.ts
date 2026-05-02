import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";

/**
 * User-facing message for the daily invitation cap. Surfaced to the
 * client as the message of an HttpsError("resource-exhausted"), and
 * asserted by client error mapping — keep the wording stable.
 */
export const LIMIT_MSG =
  "You've reached today's invitation limit (25). Try again tomorrow.";

const DAILY_CAP = 25;

/**
 * Atomically check and increment the per-user daily invitation
 * counter. Stored at spertsuite_rate_limits/{uid}. Resets when the
 * UTC date rolls over.
 *
 * @param {string} uid Caller uid.
 * @param {number} count How many invites this call wants to consume.
 * @param {string} today UTC date in "YYYY-MM-DD" form.
 * @return {Promise<void>} Resolves on success; throws on cap.
 */
export async function checkAndIncrement(
  uid: string,
  count: number,
  today: string,
): Promise<void> {
  const db = getFirestore();
  const ref = db.collection("spertsuite_rate_limits").doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("date") !== today) {
      tx.set(ref, {
        date: today,
        count: count,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }
    const existing = snap.get("count") as number;
    if (existing + count > DAILY_CAP) {
      throw new HttpsError("resource-exhausted", LIMIT_MSG);
    }
    tx.update(ref, {
      count: existing + count,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}
