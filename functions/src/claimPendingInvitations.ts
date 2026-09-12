// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import {
  FieldValue,
  getFirestore,
  Timestamp,
} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

import {redactToken} from "./logging";
import {SUPPORTED_APP_IDS} from "./invitationMailer";

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

/**
 * Sign-in providers whose tokens pass the claim gate even when the token's
 * `email_verified` claim is false.
 *
 * Firebase records EVERY `microsoft.com` sign-in as `emailVerified: false`,
 * because Microsoft's ID token carries no verified-email claim for Firebase
 * to copy. Measured 2026-09-12 in the live Auth export: 10 of 10 Microsoft
 * accounts unverified, 11 of 11 Google accounts verified, zero exceptions.
 * Until v2.5.34 this gate therefore refused every Microsoft student — and
 * its error text told them to "use a Microsoft work or school account", the
 * exact case that was failing.
 *
 * `sign_in_provider` names THIS sign-in's provider, not the account's linked
 * providers (`providerData`), so an account holding both Google and Microsoft
 * is judged by whichever it signed in with. Everything else unverified —
 * `password`, `anonymous`, a `google.com` token that reports unverified — is
 * still refused, which is what the `spertsuite_invitations` rules comment
 * says the verified-email gate exists for.
 *
 * ⚠️ Adding a provider here is a trust decision about that provider's email
 * claim, not a convenience. Microsoft's rests on the Azure app registration
 * being multi-tenant and created after June 2023, when Entra began stripping
 * unverified-domain email claims by default. Whether that stripping is in
 * force for THIS registration is an owner-held risk decision recorded with
 * the v2.5.34 release — it is not a fact this file asserts.
 */
const UNVERIFIED_EMAIL_PROVIDERS: ReadonlySet<string> = new Set([
  "microsoft.com",
]);

export const claimPendingInvitations = onCall(
  {cors: true, region: "us-central1"},
  async (request): Promise<ClaimResponse> => {
    logger.info("claimPendingInvitations invoked");

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    // The verified-email gate, with one allowlisted exception (see
    // UNVERIFIED_EMAIL_PROVIDERS above). `email_verified` is OPTIONAL on
    // DecodedIdToken, so `=== true` is the only safe reading of it.
    const emailVerified = request.auth.token.email_verified === true;
    // `firebase.sign_in_provider` is non-optional on a verified token. The
    // optional chain is deliberate anyway: a token that somehow lacks the
    // claim must fail CLOSED — refused as not-allowlisted — rather than
    // throw a TypeError that reaches the client as an opaque `internal`.
    const signInProvider =
      request.auth.token.firebase?.sign_in_provider ?? "";
    if (!emailVerified && !UNVERIFIED_EMAIL_PROVIDERS.has(signInProvider)) {
      logger.info("claimPendingInvitations refused: email unverified", {
        signInProvider,
      });
      throw new HttpsError(
        "failed-precondition",
        "Your account's email address could not be verified, so " +
          "invitations can't be accepted. Please sign in with Google or " +
          "Microsoft.",
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
      if (!inviteAppId || !SUPPORTED_APP_IDS.has(inviteAppId)) {
        // Defense in depth — never read an arbitrary collection
        // derived from a doc field. Unsupported appIds get skipped
        // until the suite onboards them (and adds them to
        // SUPPORTED_APP_IDS).
        logger.debug("skipping unsupported-app invitation", {
          tokenId: redactToken(inviteDoc.id),
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
        const projectsCollection = `${inviteAppId}_projects`;
        const outcome = await db.runTransaction(async (tx) => {
          const inviteRef = inviteDoc.ref;
          const freshInvite = await tx.get(inviteRef);
          if (!freshInvite.exists ||
              freshInvite.get("status") !== "pending") {
            return "skip" as const;
          }
          const modelRef =
            db.collection(projectsCollection).doc(modelId);
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

          // Universal: every supported app uses members.{uid} for
          // access control.
          const update: Record<string, unknown> = {
            [`members.${callerUid}`]: role,
            updatedAt: new Date().toISOString(),
          };

          // AHP-shaped schema only: maintain the embedded collaborators
          // array and seed an empty response slot. Detected by the
          // presence of the `collaborators` field on the model
          // document. CFD and any future apps without per-collaborator
          // data skip both writes — the universal members map mutation
          // alone is sufficient.
          if (md.collaborators !== undefined) {
            const existingCollab =
              (md.collaborators ?? []) as CollaboratorDoc[];
            const filtered = existingCollab.filter(
              (c) => c.userId !== callerUid,
            );
            filtered.push({userId: callerUid, role, isVoting});
            update.collaborators = filtered;

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
          claimed.push({appId: inviteAppId, modelId, modelName});
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("claim transaction failed", {
          tokenId: redactToken(inviteDoc.id),
          reason: msg,
        });
        // Continue to next invite; partial claim is better than total
        // failure.
      }
    }

    logger.info("claimPendingInvitations done", {count: claimed.length});
    return {claimed};
  },
);
