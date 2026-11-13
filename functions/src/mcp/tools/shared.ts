// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {DocumentData, Firestore} from "firebase-admin/firestore";
import {Timestamp} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {getSession, touchSession, isBrowserConnected} from "../session";
import {RESOLVABLE_CODE} from "../pairingCode";

// ── Shared response-envelope helpers ─────────────────────────────────────────
// Every SPERT Suite MCP tool wraps its JSON body in this envelope. Extracted so
// both registerStorymapTools and registerSchedulerTools reuse one definition.

export const ok = (data: object) => ({
  content: [{type: "text" as const, text: JSON.stringify(data)}],
});

export const sessionNotFound = () =>
  ok({
    status: "error",
    error: "session_not_found",
    message:
      "Session not found or expired. Ask the user to reconnect via " +
      "Connect AI in their SPERT Suite app.",
  });

export const readNotPermitted = () =>
  ok({
    status: "read_not_permitted",
    message:
      "The user has not granted Read Mode. Ask them to enable Read " +
      "Mode in the Connect AI panel.",
  });

export const rateLimited = () =>
  ok({
    status: "error",
    error: "rate_limited",
    message: "Too many operations this minute. Wait 60 seconds.",
  });

export type Envelope = ReturnType<typeof ok>;

/**
 * Envelope for a write attempted against a read-only session.
 *
 * Distinct from the generic internal error because the condition is
 * permanent: retrying cannot make a read-only session writable, and an AI
 * told to "retry" will loop until the user gives up.
 *
 * @return {Envelope} The refusal envelope.
 */
export const writeNotPermitted = () =>
  ok({
    status: "write_not_permitted",
    message:
      "This session was created by a read-only SPERT app and cannot be " +
      "written to. Do not retry. Ask the user which app they have open.",
  });

/**
 * Envelope for a tool called against another app's session.
 *
 * @param {string} expected The calling app's id.
 * @param {string | null} actual The session's app id, or null if absent.
 * @return {Envelope} The refusal envelope.
 */
export const wrongApp = (expected: string, actual: string | null) =>
  ok({
    status: "wrong_app",
    message:
      `This session belongs to ${actual ?? "an unknown app"}, not ` +
      `${expected}. Use that app's tools, or ask the user to pair from ` +
      `${expected}.`,
  });

/**
 * Refuse a session belonging to a different app.
 *
 * strict: false tolerates a missing appId, which sessions created by
 * browser builds predating the appId rollout do not carry. strict: true is
 * for apps whose sessions have always written one.
 *
 * @param {DocumentData} session The loaded session document.
 * @param {string} expectedAppId The calling app's id.
 * @param {boolean} strict True to refuse a missing appId.
 * @return {Envelope | null} A refusal envelope, or null to proceed.
 */
export function checkSessionAppId(
  session: DocumentData,
  expectedAppId: string,
  strict: boolean,
): Envelope | null {
  const actual = (session.appId as string | undefined) ?? null;
  if (actual === null) return strict ? wrongApp(expectedAppId, null) : null;
  return actual === expectedAppId ? null : wrongApp(expectedAppId, actual);
}

// ── Op size ──────────────────────────────────────────────────────────────────
// writeOpBatch writes each op as ONE Firestore document, and a document cannot
// exceed 1 MiB (1,048,576 bytes): a larger op fails as "Op write failed" after
// the call has passed every schema check. BULK_BYTE_LIMIT is measured on a JSON
// proxy of {op, payload}. Measured on the Firestore emulator through the real
// writeOpBatch (2026-11-12): the emulator refuses at 1,048,577 bytes, a payload
// of exactly 800,000 JSON bytes is an 800,174-byte document (writeOpBatch adds
// the document name, seq, two timestamps and source), and for text-heavy
// payloads JSON over-counts (quotes, key syntax). That leaves about 248 KB.
// The proxy counts numbers as their digits where Firestore counts 8 bytes, so
// re-measure before guarding an op made mostly of numbers.
export const BULK_BYTE_LIMIT = 800_000;

/**
 * Byte guard for an op. Pure: no Firestore read and no rate token, so tools
 * run it before loading the session, and an oversized call reports
 * payload_too_large ahead of any session or gate refusal (Scheduler F3-11).
 * @param {string} op Op name.
 * @param {object} payload Op payload, exactly as it would be written.
 * @param {Function} message Builds the refusal text from the measured size.
 * @return {Envelope | null} Refusal envelope when too large, else null.
 */
export function checkPayloadSize(
  op: string,
  payload: object,
  message: (bytes: number) => string = () =>
    "Split this call into smaller batches.",
): Envelope | null {
  const bytes = Buffer.byteLength(JSON.stringify({op, payload}), "utf8");
  if (bytes > BULK_BYTE_LIMIT) {
    return ok({
      status: "error",
      error: "payload_too_large",
      message: message(bytes),
    });
  }
  return null;
}

// ── Shared session tools ─────────────────────────────────────────────────────
// resolve_session_code and get_session_info are app-agnostic and MUST be
// registered exactly once per server (the MCP SDK throws on a duplicate tool
// name, and the server is constructed fresh per request). Every app's
// register*Tools registers only its own app-specific tools.

// What get_session_info says for each app with MCP tools (index.ts registers
// three): the word for the work that is open, and the tool that reads it.
// Looked up as an own property, so an appId such as "__proto__" gets the
// neutral reply that names all three read tools.
const OPEN_WORK_BY_APP_ID: Record<string, {noun: string; readTool: string}> = {
  storymap: {noun: "product", readTool: "storymap_get_product"},
  scheduler: {noun: "project", readTool: "scheduler_get_project"},
  forecaster: {noun: "project", readTool: "forecaster_get_project"},
};
const READ_TOOLS =
  "storymap_get_product, scheduler_get_project or forecaster_get_project";

/**
 * Register the shared, app-agnostic session tools on an MCP server.
 *
 * @param {McpServer} server MCP server to register tools on.
 * @param {Firestore} db Admin Firestore instance (bypasses rules).
 * @return {void}
 */
export function registerSharedSessionTools(
  server: McpServer,
  db: Firestore,
): void {
  server.tool(
    "resolve_session_code",
    `Resolve a human-readable pairing code (e.g. CRANE-0384216791) into a
session id. CALL THIS FIRST when the user gives you a pairing code. Codes are
case-insensitive and single-use: an unused code expires in 15 minutes, and a
used one stops working about a minute after it is first resolved. After
resolving, call get_session_info.`,
    // Shape lives with mintCode: see RESOLVABLE_CODE in ../pairingCode.
    {code: z.string().regex(RESOLVABLE_CODE)},
    async ({code}) => {
      const normalized = code.toUpperCase();
      const ref = db.collection("pairing_codes").doc(normalized);
      const generateNewCodeMsg =
        "Ask the user to generate a new code from the Connect AI panel.";
      const successMsg =
        "Session resolved. Call get_session_info to learn what is open.";
      try {
        const snap = await ref.get();

        // Branch 1: the code does not exist.
        if (!snap.exists) {
          return ok({
            status: "error",
            error: "code_not_found",
            message: generateNewCodeMsg,
          });
        }
        const d = snap.data();
        if (!d) {
          return ok({
            status: "error",
            error: "code_not_found",
            message: generateNewCodeMsg,
          });
        }

        // Branch 2: expired or invalid expiresAt. Fail closed: missing or
        // non-Timestamp expiresAt counts as expired. Runs before used.
        const t = d.expiresAt;
        const exp = t && typeof t.toDate === "function" ? t.toDate() : null;
        if (!exp || exp < new Date()) {
          return ok({
            status: "error",
            error: "code_expired",
            message: generateNewCodeMsg,
          });
        }

        // Branch 3: already claimed. Re-confirm against the linked
        // session instead of erroring, so re-resolve calls are idempotent.
        if (d.used) {
          const session = await getSession(db, d.sessionId as string);
          if (!session) {
            // Branch 3b: the session has ended (gone or past 7-day expiry).
            logger.warn(
              "resolve_session_code re-confirm on ended session",
              {sessionId: d.sessionId},
            );
            return sessionNotFound();
          }
          // Branch 3a: live session. Byte-identical to a first claim.
          return ok({
            status: "ok",
            sessionId: d.sessionId,
            message: successMsg,
          });
        }

        // Branch 4: first claim. The transaction returns a discriminated
        // result and never throws for expected outcomes.
        const claim = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(ref);
          const fd = fresh.exists ? fresh.data() : undefined;
          // 4b: deleted between the plain read and the transaction.
          if (!fd) return {kind: "deleted"} as const;
          // 4c: another caller won the claim first (race loser).
          if (fd.used) {
            return {kind: "raceLoser", sessionId: fd.sessionId} as const;
          }
          // 4d: win the claim. AI-1 (2026-10-24 audit): also collapse the
          // code's remaining life to a 60s grace window. A used code
          // previously stayed resolvable for its full 15 minutes (branch 3
          // re-returns the session id to ANY caller), so a leaked or
          // shoulder-surfed code was a 15-minute bearer token. 60s still lets
          // a legitimate client retry resolve once; after that branch 2
          // (expired) closes it. (True zero-window single-use is stronger but
          // would fail a network-retry — see the audit's AI-1 note.)
          tx.update(ref, {
            used: true,
            expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
          });
          return {kind: "claimed", sessionId: fd.sessionId} as const;
        });

        if (claim.kind === "deleted") {
          // Same guidance as branch 1: the code is gone.
          return ok({
            status: "error",
            error: "code_not_found",
            message: generateNewCodeMsg,
          });
        }
        // 4c race loser or 4d first claim: both resolve to success.
        return ok({
          status: "ok",
          sessionId: claim.sessionId,
          message: successMsg,
        });
      } catch {
        // Transient/unexpected error from a live Firestore read. Expected
        // error responses return inline above and never reach here.
        return ok({
          status: "error",
          error: "internal",
          message: "Temporary error; retry.",
        });
      }
    },
  );

  server.tool(
    "get_session_info",
    `Check session status and learn what is currently open: a product in SPERT
Story Map, a project in SPERT Scheduler or SPERT Forecaster. Call this after
resolve_session_code. The response includes an appId identifying which SPERT
Suite app the session belongs to — use that app's tools. To add to or edit
what is open, first call that app's read tool (${READ_TOOLS}) to discover its
structure and entity ids (requires Read Mode — if not enabled, ask the user
to turn it on in the Connect AI panel). Then use the app's fine-grained
tools.`,
    {sessionId: z.string().uuid()},
    async ({sessionId}) => {
      let session: DocumentData | null;
      try {
        session = await getSession(db, sessionId);
      } catch {
        return ok({
          status: "error",
          error: "internal",
          message: "Temporary error; retry.",
        });
      }
      if (!session) return sessionNotFound();
      try {
        await touchSession(db, sessionId);
      } catch {
        // non-fatal: presence refresh is best-effort
      }
      const appId = (session.appId as string | undefined) ?? null;
      const inApp = appId ? ` in ${appId}` : "";
      const work = appId !== null &&
        Object.prototype.hasOwnProperty.call(OPEN_WORK_BY_APP_ID, appId) ?
        OPEN_WORK_BY_APP_ID[appId] : undefined;
      const readMode = " to discover its entity ids (Read Mode required " +
        "— if off, ask the user to enable it in the Connect AI panel), " +
        "then use the app's fine-grained create/update tools.";
      let message: string;
      if (session.openProductId) {
        message = work ?
          `A ${work.noun} is open${inApp}. Use that app's tools to build or ` +
            `edit. To add to or edit the existing ${work.noun}, first call ` +
            `${work.readTool}${readMode}` :
          `Something is open${inApp}. Use that app's tools to build or ` +
            "edit. To add to or edit what is open, first call the app's " +
            `read tool (${READ_TOOLS})${readMode}`;
      } else {
        message = work ?
          `No ${work.noun} is open. Ask the user to open one in their SPERT ` +
            "Suite app." :
          "Nothing is open. Ask the user to open their work in their SPERT " +
            "Suite app.";
      }
      return ok({
        status: "ok",
        appId,
        openProductId: session.openProductId ?? null,
        consentWrite: session.consentWrite,
        consentRead: session.consentRead,
        browserConnected: isBrowserConnected(session),
        appVersion: session.appVersion,
        message,
      });
    },
  );
}
