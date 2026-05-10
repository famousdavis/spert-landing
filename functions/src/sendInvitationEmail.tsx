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
  stripCrlf,
} from "./mailHeaders";
import {AddedNotificationEmail} from "./emailTemplates";
import {
  EXPIRATION_MS,
  SUPPORTED_APP_IDS,
  getAppName,
  resolveUrlBase,
  sendInvitationToNewUser,
} from "./invitationMailer";

const resendApiKey = defineSecret("RESEND_API_KEY");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PER_CALL_CAP = 25;
const THROTTLE_MS = 24 * 60 * 60 * 1000;

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
 * Build an empty AHP response slot. Without this, the AHP client
 * throws "Response for {userId} not found" the first time the new
 * collaborator submits a judgment. AHP-specific — only written when
 * the model document already carries a `collaborators` array (i.e.
 * the AHP-shaped schema). Apps without that field (CFD) skip both
 * the array push and the response slot — the universal members map
 * mutation alone is sufficient.
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
 * Two name pairs separate the From-header concern from visible body
 * text — see sendInvitationToNewUser in invitationMailer.tsx for the
 * full rationale.
 *
 * @param {Resend} resend Resend client.
 * @param {string} recipientEmail Recipient address.
 * @param {string} recipientUid Recipient uid.
 * @param {string} modelId Model id.
 * @param {string} headerOwnerName RFC 5322-quoted owner name (From header).
 * @param {string} displayOwnerName Display-safe owner name (subject + body).
 * @param {string} ownerEmail Owner email (used in reply-to).
 * @param {string} displayModelName Display-safe model name (subject + body).
 * @param {"editor"|"viewer"} role Granted role.
 * @param {string} urlBase Base URL for the "Open SPERT app" CTA.
 * @param {string} appName Human-readable app brand.
 * @return {Promise<void>}
 */
async function maybeSendAddedNotification(
  resend: Resend,
  recipientEmail: string,
  recipientUid: string,
  modelId: string,
  headerOwnerName: string,
  displayOwnerName: string,
  ownerEmail: string,
  displayModelName: string,
  role: "editor" | "viewer",
  urlBase: string,
  appName: string,
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
    logger.debug("notification throttled");
    return;
  }

  const subject = sanitizeSubject(
    `${displayOwnerName} added you to "${displayModelName}" in ${appName}`,
  );
  const fromName =
    headerOwnerName.length > 0 ? headerOwnerName : `${appName} user`;
  const html = await render(
    <AddedNotificationEmail
      ownerName={displayOwnerName}
      ownerEmail={ownerEmail}
      modelName={displayModelName}
      role={role}
      urlBase={urlBase}
      appName={appName}
    />,
  );
  const text = await render(
    <AddedNotificationEmail
      ownerName={displayOwnerName}
      ownerEmail={ownerEmail}
      modelName={displayModelName}
      role={role}
      urlBase={urlBase}
      appName={appName}
    />,
    {plainText: true},
  );

  const {error} = await resend.emails.send({
    from: `${fromName} via ${appName} <invitations@spertsuite.com>`,
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
    if (typeof appId !== "string" || !SUPPORTED_APP_IDS.has(appId)) {
      throw new HttpsError(
        "invalid-argument",
        "appId is not a supported SPERT app.",
      );
    }
    if (typeof modelId !== "string" || modelId.length === 0) {
      throw new HttpsError(
        "invalid-argument",
        "modelId must be a non-empty string.",
      );
    }

    // Origin allowlist — only trusted callers' origins are embedded
    // into the email body. Spoofed/unknown origins fall back to the
    // app's prod domain so invitees never get redirected off-domain.
    // Resolved AFTER appId validation so we always pass a valid id.
    const requestOrigin =
      (request.rawRequest.headers.origin as string | undefined) ?? "";
    const urlBase = resolveUrlBase(requestOrigin, appId);
    const appName = getAppName(appId);

    const callerUid = request.auth.uid;
    const rawCallerName = (request.auth.token.name as string | undefined) ??
      (request.auth.token.email as string | undefined) ?? "";
    const callerName = denormalizeLastFirst(rawCallerName);
    const callerEmail =
      (request.auth.token.email as string | undefined) ?? "";

    const db = getFirestore();
    const projectsCollection = `${appId}_projects`;
    const modelRef = db.collection(projectsCollection).doc(modelId);
    const modelSnap = await modelRef.get();

    if (!modelSnap.exists) {
      throw new HttpsError("not-found", "Model not found.");
    }
    const modelData = modelSnap.data() ?? {};
    // Canonical ownership lives in the `owner` field. Some apps (AHP, CFD,
    // GanttApp) also duplicate the owner UID into the `members` map with
    // role "owner" as a security-rule index; others (Forecaster) keep the
    // members map for editors/viewers only and treat owner/members as
    // orthogonal. Trust the canonical owner field — matches the inner
    // transaction check below at the data-write boundary.
    if (modelData.owner !== callerUid) {
      throw new HttpsError(
        "permission-denied",
        "Only the model owner can send invitations.",
      );
    }

    const modelName =
      (modelData.title as string | undefined) ??
      (modelData.name as string | undefined) ??
      "Untitled";

    const today = new Date().toISOString().slice(0, 10);
    await checkAndIncrement(callerUid, emails.length, today);

    const resend = new Resend(resendApiKey.value());

    // displayOwnerName / displayModelName: visible-text safe (CRLF stripped
    // only). safeOwnerName: RFC 5322-quoted form for the From header. We keep
    // both pairs because mixing them caused the v0.29 double-quoted project
    // name regression — see invitationMailer.tsx sendInvitationToNewUser.
    const displayOwnerName = (() => {
      const stripped = stripCrlf(callerName);
      return stripped.length > 0 ? stripped : `${appName} user`;
    })();
    const safeOwnerName = sanitizeDisplayName(displayOwnerName);
    const displayModelName = stripCrlf(modelName);

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

            // Universal: every supported app uses members.{uid} for
            // access control. This single mutation is what cloud
            // security rules + UI lookups read.
            const update: Record<string, unknown> = {
              [`members.${inviteeUid}`]: role,
              updatedAt: Date.now(),
            };

            // AHP-shaped schema only: maintain the embedded
            // collaborators array AND seed an empty response slot so
            // the new collaborator's first comparison submit doesn't
            // throw. Detected by the presence of the `collaborators`
            // field on the document — AHP always carries it; CFD and
            // future apps without per-collaborator data do not.
            if (fd.collaborators !== undefined) {
              const existingCollab =
                (fd.collaborators ?? []) as CollaboratorDoc[];
              const filtered = existingCollab.filter(
                (c) => c.userId !== inviteeUid,
              );
              filtered.push({userId: inviteeUid, role, isVoting});
              update.collaborators = filtered;

              const responses =
                (fd.responses ?? {}) as Record<string, unknown>;
              if (!responses[inviteeUid]) {
                update[`responses.${inviteeUid}`] =
                  freshResponseSlot(inviteeUid);
              }
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
            displayOwnerName,
            callerEmail,
            displayModelName,
            role,
            urlBase,
            appName,
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
              appId: appId,
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
            displayOwnerName,
            callerEmail,
            displayModelName,
            tokenId,
            urlBase,
            appName,
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
