import {randomUUID} from "node:crypto";
import {
  FieldValue,
  getFirestore,
  Timestamp,
} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import {render} from "@react-email/render";
import {Resend} from "resend";

import {checkAndIncrement} from "./rateLimiter";
import {
  denormalizeLastFirst,
  sanitizeDisplayName,
  sanitizeSubject,
} from "./mailHeaders";
import {
  AddedNotificationEmail,
  InvitationEmail,
} from "./emailTemplates";

const resendApiKey = defineSecret("RESEND_API_KEY");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PER_CALL_CAP = 25;
const EXPIRATION_DAYS = 30;
const EXPIRATION_MS = EXPIRATION_DAYS * 86_400_000;
const THROTTLE_MS = 24 * 60 * 60 * 1000;

// Origins permitted to embed their own URL into the email body.
// Anything else falls through to FALLBACK_BASE so a spoofed Origin
// header cannot redirect invitees off-domain.
const ALLOWED_ORIGINS = new Set<string>([
  "https://ahp.spertsuite.com",
  "http://localhost:5176",
  "http://localhost:5177",
  "http://localhost:5173",
]);
const FALLBACK_BASE = "https://ahp.spertsuite.com";

interface SendRequest {
  appId: string;
  modelId: string;
  emails: string[];
  role: "editor" | "viewer";
  isVoting: boolean;
}

interface SendResponse {
  added: string[];
  invited: string[];
  failed: { email: string; reason: string }[];
}

interface CollaboratorDoc {
  userId: string;
  role: "owner" | "editor" | "viewer";
  isVoting: boolean;
}

interface ResponseSlot {
  userId: string;
  status: string;
  criteriaMatrix: Record<string, unknown>;
  alternativeMatrices: Record<string, unknown>;
  cr: Record<string, unknown>;
  lastModifiedAt: number;
  structureVersionAtSubmission: number;
}

/**
 * Build an empty response slot. Without this, the AHP client throws
 * "Response for {userId} not found" the first time the new
 * collaborator submits a judgment.
 *
 * @param {string} uid New collaborator uid.
 * @return {ResponseSlot} Fresh in-progress slot.
 */
function freshResponseSlot(uid: string): ResponseSlot {
  return {
    userId: uid,
    status: "in_progress",
    criteriaMatrix: {},
    alternativeMatrices: {},
    cr: {},
    lastModifiedAt: Date.now(),
    structureVersionAtSubmission: 0,
  };
}

/**
 * Send a "you were added" notification to an existing user, gated
 * by a 24h transactional throttle on
 * spertsuite_notification_throttle/{recipientUid}_{modelId}.
 *
 * @param {Resend} resend Resend client.
 * @param {string} recipientEmail Recipient address.
 * @param {string} recipientUid Recipient uid.
 * @param {string} modelId Model id.
 * @param {string} ownerName Sanitized owner display name.
 * @param {string} ownerEmail Owner email (used in reply-to).
 * @param {string} modelName Sanitized model name.
 * @param {"editor"|"viewer"} role Granted role.
 * @param {string} urlBase Base URL for the "Open SPERT AHP" CTA.
 * @return {Promise<void>}
 */
async function maybeSendAddedNotification(
  resend: Resend,
  recipientEmail: string,
  recipientUid: string,
  modelId: string,
  ownerName: string,
  ownerEmail: string,
  modelName: string,
  role: "editor" | "viewer",
  urlBase: string,
): Promise<void> {
  const db = getFirestore();
  const throttleRef = db
    .collection("spertsuite_notification_throttle")
    .doc(`${recipientUid}_${modelId}`);

  const shouldSend = await db.runTransaction(async (tx) => {
    const snap = await tx.get(throttleRef);
    if (snap.exists) {
      const last = snap.get("lastNotifiedAt") as Timestamp | undefined;
      if (last && Date.now() - last.toMillis() < THROTTLE_MS) {
        return false;
      }
    }
    tx.set(throttleRef, {lastNotifiedAt: FieldValue.serverTimestamp()});
    return true;
  });

  if (!shouldSend) {
    logger.debug("notification throttled", {modelId});
    return;
  }

  const subject = sanitizeSubject(
    `${ownerName} added you to ${modelName} in SPERT AHP`,
  );
  const fromName = ownerName.length > 0 ? ownerName : "SPERT AHP user";
  const html = await render(
    <AddedNotificationEmail
      ownerName={ownerName}
      ownerEmail={ownerEmail}
      modelName={modelName}
      role={role}
      urlBase={urlBase}
    />,
  );
  const text = await render(
    <AddedNotificationEmail
      ownerName={ownerName}
      ownerEmail={ownerEmail}
      modelName={modelName}
      role={role}
      urlBase={urlBase}
    />,
    {plainText: true},
  );

  const {error} = await resend.emails.send({
    from: `${fromName} via SPERT AHP <noreply@spertsuite.com>`,
    to: recipientEmail,
    replyTo: ownerEmail,
    subject: subject,
    html: html,
    text: text,
  });

  if (error) {
    logger.error("Resend send failed", {
      code: error.name,
      message: error.message,
      recipient: "redacted",
    });
    throw new Error("send-failed");
  }
}

/**
 * Send a brand-new InvitationEmail to a user who is not yet in
 * spertsuite_profiles.
 *
 * @param {Resend} resend Resend client.
 * @param {string} recipientEmail Recipient address.
 * @param {string} ownerName Sanitized owner display name.
 * @param {string} ownerEmail Owner email (used in reply-to).
 * @param {string} modelName Sanitized model name.
 * @param {string} tokenId Invitation token id.
 * @param {string} urlBase Base URL for the claim link.
 * @return {Promise<void>}
 */
async function sendInvitationToNewUser(
  resend: Resend,
  recipientEmail: string,
  ownerName: string,
  ownerEmail: string,
  modelName: string,
  tokenId: string,
  urlBase: string,
): Promise<void> {
  const subject = sanitizeSubject(
    `${ownerName} invited you to ${modelName} in SPERT AHP`,
  );
  const fromName = ownerName.length > 0 ? ownerName : "SPERT AHP user";

  const html = await render(
    <InvitationEmail
      ownerName={ownerName}
      ownerEmail={ownerEmail}
      modelName={modelName}
      tokenId={tokenId}
      expirationDays={EXPIRATION_DAYS}
      urlBase={urlBase}
    />,
  );
  const text = await render(
    <InvitationEmail
      ownerName={ownerName}
      ownerEmail={ownerEmail}
      modelName={modelName}
      tokenId={tokenId}
      expirationDays={EXPIRATION_DAYS}
      urlBase={urlBase}
    />,
    {plainText: true},
  );

  const {error} = await resend.emails.send({
    from: `${fromName} via SPERT AHP <noreply@spertsuite.com>`,
    to: recipientEmail,
    replyTo: ownerEmail,
    subject: subject,
    html: html,
    text: text,
  });

  if (error) {
    logger.error("Resend send failed", {
      code: error.name,
      message: error.message,
      recipient: "redacted",
    });
    throw new Error("send-failed");
  }
}

export const sendInvitationEmail = onCall(
  {
    cors: true,
    secrets: [resendApiKey],
    region: "us-central1",
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request): Promise<SendResponse> => {
    logger.info("sendInvitationEmail invoked");

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    // Origin allowlist — only trusted callers' origins are embedded
    // into the email body. Spoofed/unknown origins fall back to prod
    // so invitees never get redirected off-domain.
    const requestOrigin =
      (request.rawRequest.headers.origin as string | undefined) ?? "";
    const urlBase = ALLOWED_ORIGINS.has(requestOrigin) ?
      requestOrigin :
      FALLBACK_BASE;

    const data = request.data as SendRequest;
    const {appId, modelId, emails, role, isVoting} = data;

    if (!Array.isArray(emails) || emails.length === 0 ||
        emails.length > PER_CALL_CAP) {
      throw new HttpsError(
        "invalid-argument",
        `emails must be a non-empty array of at most ${PER_CALL_CAP} entries.`,
      );
    }
    if (role !== "editor" && role !== "viewer") {
      throw new HttpsError(
        "invalid-argument",
        "role must be \"editor\" or \"viewer\".",
      );
    }
    if (typeof isVoting !== "boolean") {
      throw new HttpsError(
        "invalid-argument",
        "isVoting must be a boolean.",
      );
    }
    if (appId !== "spertahp") {
      throw new HttpsError(
        "invalid-argument",
        "appId must be \"spertahp\".",
      );
    }
    if (typeof modelId !== "string" || modelId.length === 0) {
      throw new HttpsError(
        "invalid-argument",
        "modelId must be a non-empty string.",
      );
    }

    const callerUid = request.auth.uid;
    const rawCallerName = (request.auth.token.name as string | undefined) ??
      (request.auth.token.email as string | undefined) ?? "";
    const callerName = denormalizeLastFirst(rawCallerName);
    const callerEmail =
      (request.auth.token.email as string | undefined) ?? "";

    const db = getFirestore();
    const modelRef = db.collection("spertahp_projects").doc(modelId);
    const modelSnap = await modelRef.get();

    if (!modelSnap.exists) {
      throw new HttpsError("not-found", "Model not found.");
    }
    const modelData = modelSnap.data() ?? {};
    const members = (modelData.members ?? {}) as Record<string, string>;
    if (modelData.owner !== callerUid || members[callerUid] !== "owner") {
      throw new HttpsError(
        "permission-denied",
        "Only the model owner can send invitations.",
      );
    }

    const modelName = (modelData.name as string | undefined) ?? "Untitled";

    const today = new Date().toISOString().slice(0, 10);
    await checkAndIncrement(callerUid, emails.length, today);

    const resend = new Resend(resendApiKey.value());

    const safeOwnerName = (() => {
      const sanitized = sanitizeDisplayName(callerName);
      return sanitized.length > 0 ? sanitized : "SPERT AHP user";
    })();
    const safeModelName = sanitizeDisplayName(modelName);

    const result: SendResponse = {added: [], invited: [], failed: []};

    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const raw of emails) {
      if (typeof raw !== "string") continue;
      const e = raw.trim().toLowerCase();
      if (e.length === 0 || seen.has(e)) continue;
      seen.add(e);
      normalized.push(e);
    }

    for (const email of normalized) {
      try {
        if (!EMAIL_RE.test(email)) {
          result.failed.push({email, reason: "invalid-email"});
          continue;
        }

        // Dedup pending-invite check (uses
        // (inviteeEmail, status, createdAt) composite index, then
        // filter modelId in code).
        const dedupSnap = await db
          .collection("spertsuite_invitations")
          .where("inviteeEmail", "==", email)
          .where("status", "==", "pending")
          .get();
        const dup = dedupSnap.docs.find(
          (d) => d.get("modelId") === modelId,
        );
        if (dup) {
          result.failed.push({email, reason: "already-invited"});
          continue;
        }

        // Profile lookup.
        const profileSnap = await db
          .collection("spertsuite_profiles")
          .where("email", "==", email)
          .limit(1)
          .get();

        if (!profileSnap.empty) {
          // Branch A — existing user, auto-add inside a transaction.
          const profileDoc = profileSnap.docs[0];
          const inviteeUid = profileDoc.id;

          type AddOutcome = "already-member" | "added";
          const outcome: AddOutcome = await db.runTransaction(async (tx) => {
            const fresh = await tx.get(modelRef);
            if (!fresh.exists) {
              throw new HttpsError("not-found", "Model not found.");
            }
            const fd = fresh.data() ?? {};
            if (fd.owner !== callerUid) {
              throw new HttpsError(
                "permission-denied",
                "Only the model owner can send invitations.",
              );
            }
            const m = (fd.members ?? {}) as Record<string, string>;
            if (typeof m[inviteeUid] === "string" &&
                (m[inviteeUid] === "owner" ||
                 m[inviteeUid] === "editor" ||
                 m[inviteeUid] === "viewer")) {
              return "already-member";
            }
            const existingCollab =
              (fd.collaborators ?? []) as CollaboratorDoc[];
            const filtered = existingCollab.filter(
              (c) => c.userId !== inviteeUid,
            );
            filtered.push({userId: inviteeUid, role, isVoting});

            const update: Record<string, unknown> = {
              collaborators: filtered,
              [`members.${inviteeUid}`]: role,
              updatedAt: Date.now(),
            };
            const responses =
              (fd.responses ?? {}) as Record<string, unknown>;
            if (!responses[inviteeUid]) {
              update[`responses.${inviteeUid}`] = freshResponseSlot(inviteeUid);
            }
            tx.update(modelRef, update);
            return "added";
          });

          if (outcome === "already-member") {
            result.failed.push({email, reason: "already-member"});
            continue;
          }

          await maybeSendAddedNotification(
            resend,
            email,
            inviteeUid,
            modelId,
            safeOwnerName,
            callerEmail,
            safeModelName,
            role,
            urlBase,
          );
          result.added.push(email);
        } else {
          // Branch B — new user, create a pending invitation token.
          const tokenId = randomUUID();
          const expiresAt = Timestamp.fromMillis(Date.now() + EXPIRATION_MS);

          await db
            .collection("spertsuite_invitations")
            .doc(tokenId)
            .set({
              appId: "spertahp",
              modelId: modelId,
              modelName: modelName,
              inviteeEmail: email,
              role: role,
              isVoting: isVoting,
              inviterUid: callerUid,
              inviterName: callerName.length > 0 ? callerName : callerEmail,
              inviterEmail: callerEmail,
              status: "pending",
              createdAt: FieldValue.serverTimestamp(),
              expiresAt: expiresAt,
              lastEmailSentAt: FieldValue.serverTimestamp(),
              emailSendCount: 1,
              updatedAt: FieldValue.serverTimestamp(),
            });

          await sendInvitationToNewUser(
            resend,
            email,
            safeOwnerName,
            callerEmail,
            safeModelName,
            tokenId,
            urlBase,
          );
          result.invited.push(email);
        }
      } catch (err) {
        // Re-throw permission-denied / not-found from the inner
        // transaction at the batch level — these are owner-state
        // failures, not per-email noise.
        if (err instanceof HttpsError) {
          throw err;
        }
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("per-email failure", {reason: msg});
        result.failed.push({email, reason: "send-failed"});
      }
    }

    logger.info("sendInvitationEmail done", {
      added: result.added.length,
      invited: result.invited.length,
      failed: result.failed.length,
    });
    return result;
  },
);
