import {
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

interface UpdateRequest {
  tokenId: string;
  isVoting: boolean;
}

interface UpdateResponse {
  updated: true;
}

export const updateInvite = onCall(
  {
    cors: true,
    region: "us-central1",
  },
  async (request): Promise<UpdateResponse> => {
    logger.info("updateInvite invoked");

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const data = (request.data ?? {}) as UpdateRequest;
    const {tokenId, isVoting} = data;
    if (typeof tokenId !== "string" || tokenId.length === 0) {
      throw new HttpsError(
        "invalid-argument",
        "tokenId must be a non-empty string.",
      );
    }
    if (typeof isVoting !== "boolean") {
      throw new HttpsError(
        "invalid-argument",
        "isVoting must be a boolean.",
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
          "Only the model owner can update this invitation.",
        );
      }
      const status = snap.get("status") as string | undefined;
      if (status !== "pending") {
        throw new HttpsError(
          "failed-precondition",
          "This invitation can no longer be updated.",
        );
      }
      tx.update(ref, {
        isVoting,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    logger.info("updateInvite done", {tokenId, isVoting});
    return {updated: true};
  },
);
