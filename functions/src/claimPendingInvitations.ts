import {
  FieldValue,
  getFirestore,
  Timestamp,
} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

interface ClaimedItem {
  appId: string;
  modelId: string;
  modelName: string;
}

interface ClaimResponse {
  claimed: ClaimedItem[];
}

interface CollaboratorDoc {
  userId: string;
  role: "owner" | "editor" | "viewer";
  isVoting: boolean;
}

export const claimPendingInvitations = onCall(
  {region: "us-central1"},
  async (request): Promise<ClaimResponse> => {
    logger.info("claimPendingInvitations invoked");

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    if (request.auth.token.email_verified !== true) {
      throw new HttpsError(
        "failed-precondition",
        "Your sign-in account's email could not be verified. " +
          "Please sign in with Google, or use a Microsoft work or " +
          "school account.",
      );
    }

    const callerUid = request.auth.uid;
    const tokenEmail =
      (request.auth.token.email as string | undefined) ?? "";
    const email = tokenEmail.toLowerCase().trim();
    if (email.length === 0) {
      return {claimed: []};
    }

    const db = getFirestore();
    const now = Timestamp.now();
    const inviteSnap = await db
      .collection("spertsuite_invitations")
      .where("inviteeEmail", "==", email)
      .where("status", "==", "pending")
      .orderBy("createdAt", "asc")
      .get();

    const claimed: ClaimedItem[] = [];

    for (const inviteDoc of inviteSnap.docs) {
      const expiresAt = inviteDoc.get("expiresAt") as Timestamp | undefined;
      if (!expiresAt || expiresAt.toMillis() <= now.toMillis()) {
        // Will be cleaned up by the scheduled expireInvitations.
        continue;
      }
      const inviteAppId = inviteDoc.get("appId") as string | undefined;
      if (inviteAppId !== "spertahp") {
        // Defense in depth — never read an arbitrary collection
        // derived from a doc field.
        logger.debug("skipping non-spertahp invitation", {
          tokenId: inviteDoc.id,
          appId: inviteAppId,
        });
        continue;
      }
      const modelId = inviteDoc.get("modelId") as string;
      const role = inviteDoc.get("role") as "editor" | "viewer";
      const isVoting = inviteDoc.get("isVoting") as boolean;
      const modelName =
        (inviteDoc.get("modelName") as string | undefined) ?? "Untitled";

      try {
        const outcome = await db.runTransaction(async (tx) => {
          const inviteRef = inviteDoc.ref;
          const freshInvite = await tx.get(inviteRef);
          if (!freshInvite.exists ||
              freshInvite.get("status") !== "pending") {
            return "skip" as const;
          }
          const modelRef =
            db.collection("spertahp_projects").doc(modelId);
          const modelSnap = await tx.get(modelRef);
          if (!modelSnap.exists) {
            tx.update(inviteRef, {
              status: "expired",
              updatedAt: FieldValue.serverTimestamp(),
            });
            return "model-missing" as const;
          }
          const md = modelSnap.data() ?? {};
          const members = (md.members ?? {}) as Record<string, string>;

          if (typeof members[callerUid] === "string") {
            tx.update(inviteRef, {
              status: "accepted",
              acceptedAt: FieldValue.serverTimestamp(),
              acceptedByUid: callerUid,
              updatedAt: FieldValue.serverTimestamp(),
            });
            return "already-member" as const;
          }

          const existingCollab =
            (md.collaborators ?? []) as CollaboratorDoc[];
          const filtered = existingCollab.filter(
            (c) => c.userId !== callerUid,
          );
          filtered.push({userId: callerUid, role, isVoting});

          const update: Record<string, unknown> = {
            collaborators: filtered,
            [`members.${callerUid}`]: role,
            updatedAt: Date.now(),
          };
          const responses =
            (md.responses ?? {}) as Record<string, unknown>;
          if (!responses[callerUid]) {
            update[`responses.${callerUid}`] = {
              userId: callerUid,
              status: "in_progress",
              criteriaMatrix: {},
              alternativeMatrices: {},
              cr: {},
              lastModifiedAt: Date.now(),
              structureVersionAtSubmission: 0,
            };
          }
          tx.update(modelRef, update);
          tx.update(inviteRef, {
            status: "accepted",
            acceptedAt: FieldValue.serverTimestamp(),
            acceptedByUid: callerUid,
            updatedAt: FieldValue.serverTimestamp(),
          });
          return "added" as const;
        });

        if (outcome === "added" || outcome === "already-member") {
          claimed.push({appId: "spertahp", modelId, modelName});
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("claim transaction failed", {tokenId: inviteDoc.id,
          reason: msg});
        // Continue to next invite; partial claim is better than total
        // failure.
      }
    }

    logger.info("claimPendingInvitations done", {count: claimed.length});
    return {claimed};
  },
);
