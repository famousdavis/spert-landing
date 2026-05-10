import {
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import {Resend} from "resend";

import {
  denormalizeLastFirst,
  sanitizeDisplayName,
  stripCrlf,
} from "./mailHeaders";
import {
  getAppName,
  resolveUrlBase,
  sendInvitationToNewUser,
} from "./invitationMailer";
import {redactToken} from "./logging";

const resendApiKey = defineSecret("RESEND_API_KEY");

const MAX_RESEND_COUNT = 5;

interface ResendRequest {
  tokenId: string;
}

interface ResendResponse {
  resent: true;
  emailSendCount: number;
}

export const resendInvite = onCall(
  {
    cors: true,
    secrets: [resendApiKey],
    region: "us-central1",
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request): Promise<ResendResponse> => {
    logger.info("resendInvite invoked");

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const data = (request.data ?? {}) as ResendRequest;
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

    // Read OUTSIDE a transaction — we need the full doc to call
    // Resend before incrementing. Status / cap re-checked inside the
    // post-send transaction for safety.
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Invitation not found.");
    }
    const inviterUid = snap.get("inviterUid") as string | undefined;
    if (inviterUid !== callerUid) {
      throw new HttpsError(
        "permission-denied",
        "Only the model owner can resend this invitation.",
      );
    }
    const status = snap.get("status") as string | undefined;
    if (status !== "pending") {
      throw new HttpsError(
        "failed-precondition",
        "This invitation can no longer be resent.",
      );
    }
    const currentCount =
      (snap.get("emailSendCount") as number | undefined) ?? 0;
    if (currentCount >= MAX_RESEND_COUNT) {
      throw new HttpsError(
        "resource-exhausted",
        "This invitation has reached its resend limit (5). " +
          "Revoke and re-invite to start over.",
      );
    }

    const inviteeEmail = snap.get("inviteeEmail") as string;
    // Defensive: legacy invitation docs (created before the Phase 3.1
    // fix) may still have the unnormalized "Last, First" form stored
    // in inviterName. Re-normalize at every send so resends produce
    // clean From headers regardless of doc age.
    const rawInviterName =
      (snap.get("inviterName") as string | undefined) ?? "";
    const inviterEmail =
      (snap.get("inviterEmail") as string | undefined) ?? "";
    const modelName =
      (snap.get("modelName") as string | undefined) ?? "Untitled";
    // Defensive: legacy invitations created before the multi-app
    // generalization may have no appId field — assume spertahp.
    const inviteAppId =
      (snap.get("appId") as string | undefined) ?? "spertahp";
    const appName = getAppName(inviteAppId);

    // Origin allowlist — same pattern as sendInvitationEmail. Spoofed
    // or unknown origins fall back to the per-app prod domain so
    // resend emails never ship a localhost or attacker-controlled URL.
    const requestOrigin =
      (request.rawRequest.headers.origin as string | undefined) ?? "";
    const urlBase = resolveUrlBase(requestOrigin, inviteAppId);

    const ownerName = denormalizeLastFirst(rawInviterName);
    // displayOwnerName / displayModelName: visible-text safe (CRLF stripped
    // only). safeOwnerName: RFC 5322-quoted form for the From header. We keep
    // both pairs because mixing them caused the v0.29 double-quoted project
    // name regression — see invitationMailer.tsx sendInvitationToNewUser.
    const displayOwnerName = (() => {
      const stripped = stripCrlf(ownerName);
      return stripped.length > 0 ? stripped : `${appName} user`;
    })();
    const safeOwnerName = sanitizeDisplayName(displayOwnerName);
    const displayModelName = stripCrlf(modelName);

    const resend = new Resend(resendApiKey.value());

    try {
      await sendInvitationToNewUser(
        resend,
        inviteeEmail,
        safeOwnerName,
        displayOwnerName,
        inviterEmail,
        displayModelName,
        tokenId,
        urlBase,
        appName,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("resendInvite Resend failed", {
        tokenId: redactToken(tokenId),
        reason: msg,
      });
      throw new HttpsError(
        "internal",
        "Could not resend the invitation right now. Please try again.",
      );
    }

    // Resend succeeded — atomically bump the counter. Re-check status
    // inside the transaction (defensive against a revoke landing
    // between our pre-check and the Resend call). If status flipped,
    // the email already shipped — succeed anyway, log a warning, and
    // do not increment.
    let newCount = currentCount + 1;
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        if (!fresh.exists) {
          logger.warn("resendInvite: invite vanished post-send", {
            tokenId: redactToken(tokenId),
          });
          return;
        }
        if (fresh.get("status") !== "pending") {
          logger.warn(
            "resendInvite: invite no longer pending post-send",
            {tokenId: redactToken(tokenId), status: fresh.get("status")},
          );
          return;
        }
        const freshCount =
          (fresh.get("emailSendCount") as number | undefined) ?? 0;
        newCount = freshCount + 1;
        tx.update(ref, {
          emailSendCount: FieldValue.increment(1),
          lastEmailSentAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (err) {
      // Email already sent — surface success to caller. Counter drift
      // is recoverable; a stuck owner can revoke + re-invite to reset.
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("resendInvite: post-send tx failed", {
        tokenId: redactToken(tokenId),
        reason: msg,
      });
    }

    logger.info("resendInvite done", {emailSendCount: newCount});
    return {resent: true, emailSendCount: newCount};
  },
);
