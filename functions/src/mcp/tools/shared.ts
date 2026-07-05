// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {DocumentData, Firestore} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {getSession, touchSession, isBrowserConnected} from "../session";

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

// ── Shared session tools ─────────────────────────────────────────────────────
// resolve_session_code and get_session_info are app-agnostic and MUST be
// registered exactly once per server (the MCP SDK throws on a duplicate tool
// name, and the server is constructed fresh per request). Every app's
// register*Tools registers only its own app-specific tools.

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
    `Resolve a human-readable pairing code (e.g. CRANE-7842) into a session
id. CALL THIS FIRST when the user gives you a pairing code. Codes are
case-insensitive, single-use, and expire in 15 minutes. After resolving,
call get_session_info.`,
    {code: z.string().regex(/^[A-Za-z]+-\d{4}$/)},
    async ({code}) => {
      const normalized = code.toUpperCase();
      const ref = db.collection("pairing_codes").doc(normalized);
      const generateNewCodeMsg =
        "Ask the user to generate a new code from the Connect AI panel.";
      const successMsg =
        "Session resolved. Call get_session_info to learn which " +
        "project is open.";
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
          // 4d: win the claim.
          tx.update(ref, {used: true});
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
    `Check session status and learn which project is currently open. Call this
after resolve_session_code. The response includes an appId identifying which
SPERT Suite app the session belongs to — use that app's tools. To add to or
edit an existing project, first call that app's get_project tool to discover
its structure and entity ids (requires Read Mode — if not enabled, ask the
user to turn it on in the Connect AI panel). Then use the app's fine-grained
tools.`,
    {sessionId: z.string().uuid()},
    async ({sessionId}) => {
      let session: DocumentData | null = null;
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
      return ok({
        status: "ok",
        appId,
        openProductId: session.openProductId ?? null,
        consentWrite: session.consentWrite,
        consentRead: session.consentRead,
        browserConnected: isBrowserConnected(session),
        appVersion: session.appVersion,
        message: session.openProductId ?
          `A project is open${inApp}. Use that app's tools to build or edit. ` +
            "To add to or edit the existing project, first call the app's " +
            "get_project tool to discover its entity ids (Read Mode required " +
            "— if off, ask the user to enable it in the Connect AI panel), " +
            "then use the app's fine-grained create/update tools." :
          "No project is open. Ask the user to open one in their SPERT " +
            "Suite app.",
      });
    },
  );
}
