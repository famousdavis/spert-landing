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

// Apps this suite-wide infrastructure serves. Adding a new app means
// adding a row here AND in the per-app origin / brand maps below.
export const SUPPORTED_APP_IDS = new Set<string>([
  "spertahp",
  "spertcfd",
  "ganttapp",
  "spertforecaster",
  "spertstorymap",
  "spertscheduler",
  "myscrumbudget",
]);

// CFD's `next dev` defaults to port 3000 and walks up to 3001, 3002, …
// when the previous port is in use. Allow a generous window so testers
// don't need to reconfigure the function whenever ports shift.
const CFD_DEV_PORT_START = 3000;
const CFD_DEV_PORT_END = 3010;
const cfdDevOrigins: string[] = [];
for (let p = CFD_DEV_PORT_START; p <= CFD_DEV_PORT_END; p++) {
  cfdDevOrigins.push(`http://localhost:${p}`);
}

// GanttApp uses `next dev` with the same default port behavior as CFD.
// Same range, listed under its own appId; no conflict because the
// allowlists below are per-appId.
const GANTTAPP_DEV_PORT_START = 3000;
const GANTTAPP_DEV_PORT_END = 3010;
const ganttappDevOrigins: string[] = [];
for (let p = GANTTAPP_DEV_PORT_START; p <= GANTTAPP_DEV_PORT_END; p++) {
  ganttappDevOrigins.push(`http://localhost:${p}`);
}

// Forecaster uses `next dev` with the same default port behavior as CFD
// and GanttApp. Same range, listed under its own appId; no conflict
// because the allowlists below are per-appId.
const FORECASTER_DEV_PORT_START = 3000;
const FORECASTER_DEV_PORT_END = 3010;
const forecasterDevOrigins: string[] = [];
for (let p = FORECASTER_DEV_PORT_START; p <= FORECASTER_DEV_PORT_END; p++) {
  forecasterDevOrigins.push(`http://localhost:${p}`);
}

// MyScrumBudget uses `next dev` with the same default port behavior as
// CFD, GanttApp, and Forecaster. Same range, listed under its own
// appId; no conflict because the allowlists below are per-appId.
const MSB_DEV_PORT_START = 3000;
const MSB_DEV_PORT_END = 3010;
const msbDevOrigins: string[] = [];
for (let p = MSB_DEV_PORT_START; p <= MSB_DEV_PORT_END; p++) {
  msbDevOrigins.push(`http://localhost:${p}`);
}

// Per-app origin allowlists. Calls whose Origin matches an entry get
// that origin embedded in the invitation email; everything else falls
// through to the per-app prod fallback so a spoofed Origin header
// cannot redirect invitees off-domain.
export const ALLOWED_ORIGINS_BY_APP_ID: Record<string, Set<string>> = {
  spertahp: new Set<string>([
    "https://ahp.spertsuite.com",
    "http://localhost:5173",
    "http://localhost:5176",
    "http://localhost:5177",
  ]),
  spertcfd: new Set<string>([
    "https://cfd.spertsuite.com",
    ...cfdDevOrigins,
  ]),
  ganttapp: new Set<string>([
    "https://ganttapp.spertsuite.com",
    ...ganttappDevOrigins,
  ]),
  spertforecaster: new Set<string>([
    "https://forecaster.spertsuite.com",
    ...forecasterDevOrigins,
  ]),
  // Story Map is a Vite SPA; vite.config.ts has no port override so the dev
  // server uses Vite's default 5173.
  spertstorymap: new Set<string>([
    "https://storymap.spertsuite.com",
    "http://localhost:5173",
  ]),
  // Scheduler is a Vite SPA; vite.config.ts has no port override so the dev
  // server uses Vite's default 5173 (same as Story Map).
  spertscheduler: new Set<string>([
    "https://scheduler.spertsuite.com",
    "http://localhost:5173",
  ]),
  myscrumbudget: new Set<string>([
    "https://myscrumbudget.spertsuite.com",
    ...msbDevOrigins,
  ]),
};

// Per-app prod fallbacks. Used when the Origin header is missing,
// spoofed, or not in this app's allowlist.
export const FALLBACK_BASE_BY_APP_ID: Record<string, string> = {
  spertahp: "https://ahp.spertsuite.com",
  spertcfd: "https://cfd.spertsuite.com",
  ganttapp: "https://ganttapp.spertsuite.com",
  spertforecaster: "https://forecaster.spertsuite.com",
  spertstorymap: "https://storymap.spertsuite.com",
  spertscheduler: "https://scheduler.spertsuite.com",
  myscrumbudget: "https://myscrumbudget.spertsuite.com",
};

// Last-resort fallback for unsupported appIds (should be impossible
// given the validation in sendInvitationEmail, but defensive).
export const DEFAULT_FALLBACK_BASE = "https://spertsuite.com";

// Per-app brand names. Surfaced in email subject + From-line.
export const APP_NAMES_BY_APP_ID: Record<string, string> = {
  spertahp: "SPERT AHP",
  spertcfd: "SPERT CFD",
  ganttapp: "GanttApp",
  spertforecaster: "SPERT Forecaster",
  spertstorymap: "SPERT Story Map",
  spertscheduler: "SPERT Scheduler",
  myscrumbudget: "MyScrumBudget",
};

export const DEFAULT_APP_NAME = "SPERT";

/**
 * Resolve the email URL base from a request Origin header. Allowlist
 * hits for this appId pass through; anything else falls back to the
 * app's prod domain.
 *
 * @param {string} origin Raw Origin header value (or empty string).
 * @param {string} appId Caller's appId; selects the per-app allowlist
 *   and fallback.
 * @return {string} URL base safe to embed in the email body.
 */
export function resolveUrlBase(origin: string, appId: string): string {
  const allowed = ALLOWED_ORIGINS_BY_APP_ID[appId];
  if (allowed && allowed.has(origin)) return origin;
  return FALLBACK_BASE_BY_APP_ID[appId] ?? DEFAULT_FALLBACK_BASE;
}

/**
 * Resolve the human-readable app name for use in subjects and From
 * lines. Falls back to a generic "SPERT" brand for unknown ids.
 *
 * @param {string} appId Caller's appId.
 * @return {string} Brand name to render in email surfaces.
 */
export function getAppName(appId: string): string {
  return APP_NAMES_BY_APP_ID[appId] ?? DEFAULT_APP_NAME;
}

/**
 * Send an InvitationEmail to a recipient. Used both by
 * sendInvitationEmail (Branch B — first send to a new user) and by
 * resendInvite (owner clicked Resend on a pending invitation).
 *
 * Two pairs of name parameters because header quoting and visible-text
 * quoting are different concerns:
 *  - headerOwnerName goes only into the From header and must be RFC 5322
 *    quoted when it contains specials (commas in "Last, First", etc.).
 *  - displayOwnerName / displayModelName flow into the rendered subject
 *    and email body. They are CRLF-stripped (header-injection defense)
 *    but never RFC-quoted, so the React-Email body's literal `"…"`
 *    wrapper is the sole source of visible quotes around the project
 *    name. Mixing the two produced double-quoted project names in v0.29.
 *
 * @param {Resend} resend Resend client.
 * @param {string} recipientEmail Recipient address.
 * @param {string} headerOwnerName RFC 5322-quoted owner name (From header).
 * @param {string} displayOwnerName Display-safe owner name (subject + body).
 * @param {string} ownerEmail Owner email (used in reply-to).
 * @param {string} displayModelName Display-safe model name (subject + body).
 * @param {string} tokenId Invitation token id.
 * @param {string} urlBase Base URL for the claim link.
 * @param {string} appName Human-readable app brand (e.g. "SPERT CFD").
 * @return {Promise<void>}
 */
export async function sendInvitationToNewUser(
  resend: Resend,
  recipientEmail: string,
  headerOwnerName: string,
  displayOwnerName: string,
  ownerEmail: string,
  displayModelName: string,
  tokenId: string,
  urlBase: string,
  appName: string,
): Promise<void> {
  const subject = sanitizeSubject(
    `${displayOwnerName} invited you to "${displayModelName}" in ${appName}`,
  );
  const fromName =
    headerOwnerName.length > 0 ? headerOwnerName : `${appName} user`;

  const html = await render(
    <InvitationEmail
      ownerName={displayOwnerName}
      ownerEmail={ownerEmail}
      modelName={displayModelName}
      tokenId={tokenId}
      expirationDays={EXPIRATION_DAYS}
      urlBase={urlBase}
      appName={appName}
    />,
  );
  const text = await render(
    <InvitationEmail
      ownerName={displayOwnerName}
      ownerEmail={ownerEmail}
      modelName={displayModelName}
      tokenId={tokenId}
      expirationDays={EXPIRATION_DAYS}
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
