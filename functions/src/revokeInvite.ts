import {
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

interface RevokeRequest {
  tokenId: string;
}

interface RevokeResponse {
  revoked: true;
}

export const revokeInvite = onCall(
  {
    cors: true,
    region: "us-central1",
  },
  async (request): Promise<RevokeResponse> => {
    logger.info("revokeInvite invoked");

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const data = (request.data ?? {}) as RevokeRequest;
    const {tokenId} = data;
    if (typeof tokenId !== "string" || tokenId.length === 0) {
      throw new HttpsError(
        "invalid-argument",
        "tokenId must be a non-empty string.",
      );
    }

    const callerUid = request.auth.uid;
    const db = getFirestore();
    const ref = db.collection("spertsuite_invitations").doc(tokenId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError("not-found", "Invitation not found.");
      }
      const inviterUid = snap.get("inviterUid") as string | undefined;
      if (inviterUid !== callerUid) {
        throw new HttpsError(
          "permission-denied",
          "Only the model owner can revoke this invitation.",
        );
      }
      const status = snap.get("status") as string | undefined;
      if (status !== "pending") {
        throw new HttpsError(
          "failed-precondition",
          "This invitation can no longer be revoked.",
        );
      }
      tx.update(ref, {
        status: "revoked",
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    logger.info("revokeInvite done", {tokenId});
    return {revoked: true};
  },
);
