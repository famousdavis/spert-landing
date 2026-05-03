import {render} from "@react-email/render";
import * as logger from "firebase-functions/logger";
import {Resend} from "resend";

import {sanitizeSubject} from "./mailHeaders";
import {InvitationEmail} from "./emailTemplates";

// Invitation lifetime — referenced both by sendInvitationEmail (when
// stamping expiresAt) and by the rendered email body via the
// InvitationEmail template's expirationDays prop.
export const EXPIRATION_DAYS = 30;
export const EXPIRATION_MS = EXPIRATION_DAYS * 86_400_000;

// Origins permitted to embed their own URL into the email body.
// Anything else falls through to FALLBACK_BASE so a spoofed Origin
// header cannot redirect invitees off-domain.
export const ALLOWED_ORIGINS = new Set<string>([
  "https://ahp.spertsuite.com",
  "http://localhost:5176",
  "http://localhost:5177",
  "http://localhost:5173",
]);
export const FALLBACK_BASE = "https://ahp.spertsuite.com";

/**
 * Resolve the email URL base from a request Origin header. Allowlist
 * hits are passed through; anything else (missing, spoofed, or simply
 * unknown) falls back to the production app domain.
 *
 * @param {string} origin Raw Origin header value (or empty string).
 * @return {string} URL base safe to embed in the email body.
 */
export function resolveUrlBase(origin: string): string {
  return ALLOWED_ORIGINS.has(origin) ? origin : FALLBACK_BASE;
}

/**
 * Send an InvitationEmail to a recipient. Used both by
 * sendInvitationEmail (Branch B — first send to a new user) and by
 * resendInvite (owner clicked Resend on a pending invitation).
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
export async function sendInvitationToNewUser(
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
    from: `${fromName} via SPERT AHP <invitations@spertsuite.com>`,
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
