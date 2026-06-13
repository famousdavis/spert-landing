// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {DocumentData, Firestore} from "firebase-admin/firestore";
import {
  getSession,
  touchSession,
  writeOpBatch,
  isBrowserConnected,
} from "../session";
import {checkSessionWriteLimit} from "../rateLimit";

const ok = (data: object) => ({
  content: [{type: "text" as const, text: JSON.stringify(data)}],
});

const sessionNotFound = () =>
  ok({
    status: "error",
    error: "session_not_found",
    message:
      "Session not found or expired. Ask the user to reconnect via " +
      "Connect AI in SPERT Story Map.",
  });

const readNotPermitted = () =>
  ok({
    status: "read_not_permitted",
    message:
      "The user has not granted Read Mode. Ask them to enable Read " +
      "Mode in the Connect AI panel.",
  });

const rateLimited = () =>
  ok({
    status: "error",
    error: "rate_limited",
    message: "Too many operations this minute. Wait 60 seconds.",
  });

// S1: ids relaxed from .uuid() to bounded strings (idempotency only needs
// stable strings, not UUID format). String caps mirror the app's
// validateProduct limits (name 1000, description/notes 2000) so any value
// the app accepts also passes here; quality guidance ("keep names short")
// lives in the tool description, not as a hard reject. category coerces
// unknown values to "core" rather than failing the whole import.
const ribSchema = z.object({
  ribId: z.string().min(1).max(100),
  name: z.string().min(1).max(1000),
  description: z.string().max(2000).optional(),
  category: z.enum(["core", "non-core"]).catch("core"),
  notes: z.string().max(2000).optional(),
});

const backboneSchema = z.object({
  backboneId: z.string().min(1).max(100),
  name: z.string().min(1).max(1000),
  description: z.string().max(2000).optional(),
  ribs: z.array(ribSchema).max(10),
});

const themeSchema = z.object({
  themeId: z.string().min(1).max(100),
  name: z.string().min(1).max(1000),
  backbones: z.array(backboneSchema).max(5),
});

/**
 * Register all SPERT Story Map MCP tools on the given server instance.
 * Phase 1 exposes resolve_session_code, get_session_info,
 * storymap_bulk_import, and storymap_get_project; the fine-grained
 * create_/update_ tools are stubs that redirect callers to bulk_import.
 *
 * @param {McpServer} server MCP server to register tools on.
 * @param {Firestore} db Admin Firestore instance (bypasses rules).
 * @return {void}
 */
export function registerStorymapTools(
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
      let sessionId = "";
      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) {
            throw Object.assign(new Error(), {reason: "not_found"});
          }
          const d = snap.data();
          if (!d) throw Object.assign(new Error(), {reason: "not_found"});
          if (d.used) {
            throw Object.assign(new Error(), {reason: "already_used"});
          }
          if (d.expiresAt?.toDate() < new Date()) {
            throw Object.assign(new Error(), {reason: "expired"});
          }
          tx.update(ref, {used: true});
          sessionId = d.sessionId as string;
        });
      } catch (e: unknown) {
        const reason = (e as {reason?: string}).reason ?? "not_found";
        const errorMap: Record<string, string> = {
          not_found: "code_not_found",
          already_used: "code_already_used",
          expired: "code_expired",
        };
        return ok({
          status: "error",
          error: errorMap[reason] ?? "code_not_found",
          message:
            "Ask the user to generate a new code from the Connect AI " +
            "panel.",
        });
      }
      return ok({
        status: "ok",
        sessionId,
        message:
          "Session resolved. Call get_session_info to learn which " +
          "project is open.",
      });
    },
  );

  server.tool(
    "get_session_info",
    `Check session status and learn which project is currently open in
SPERT Story Map. Call this after resolve_session_code and before
storymap_bulk_import. Once a project is open, ask the user what product
they are planning and which story-map modeling approach they want BEFORE
calling storymap_bulk_import. Do not build a structure until the user has
confirmed the approach.`,
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
      return ok({
        status: "ok",
        openProductId: session.openProductId ?? null,
        consentWrite: session.consentWrite,
        consentRead: session.consentRead,
        browserConnected: isBrowserConnected(session),
        appVersion: session.appVersion,
        message: session.openProductId ?
          "A project is open. Call storymap_bulk_import to build it." :
          "No project is open. Ask the user to open one in SPERT " +
            "Story Map.",
      });
    },
  );

  server.tool(
    "storymap_bulk_import",
    `Build a complete story map in one operation. This is the PRIMARY
write tool.

STORY MAP CONCEPTS
Themes group backbones. DEFAULT TO ONE THEME unless the product spans
genuinely distinct domains. Do not add themes just because the cap
allows it.
Backbones are the middle tier; their meaning depends on the modeling
approach:
  Workflow    - steps in a user workflow (Search > Select > Checkout)
  Capability  - named features/services (Authentication, Reporting)
  Epic/Story  - epics matching an existing backlog
  Journey     - lifecycle phases (Onboarding > Growth > Retention)
Ribs are user stories or build tasks within each backbone.

WORKFLOW
1. Call get_session_info; confirm openProductId and browserConnected.
2. Ask the user what product they are planning and which approach fits.
3. Generate all ids yourself (UUIDs are typical) before calling.
4. Call this tool only after the approach is confirmed.

Caps: 5 themes x 5 backbones x 10 ribs. Per rib you may set description,
category ("core" | "non-core"), and notes. Keep names short (a few
words); descriptions and notes may be a sentence or two.`,
    {
      sessionId: z.string().uuid(),
      structure: z.object({
        themes: z.array(themeSchema).min(1).max(5),
      }),
    },
    async ({sessionId, structure}) => {
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
      if (!checkSessionWriteLimit(sessionId)) return rateLimited();
      try {
        await writeOpBatch(db, sessionId, [
          {op: "bulk_import", payload: structure},
        ]);
      } catch (e: unknown) {
        const msg = (e as Error).message;
        if (msg === "session_not_found") return sessionNotFound();
        return ok({
          status: "error",
          error: "internal",
          message: `Op write failed: ${msg}`,
        });
      }
      const ribCount = structure.themes.reduce(
        (sum, t) =>
          sum + t.backbones.reduce((b, bb) => b + bb.ribs.length, 0),
        0,
      );
      const connected = isBrowserConnected(session);
      return ok({
        status: "success",
        themeCount: structure.themes.length,
        ribCount,
        browserConnected: connected,
        message: connected ?
          `Story map queued (${structure.themes.length} themes, ` +
            `${ribCount} ribs). It will appear immediately.` :
          "Story map queued. The browser is not open - it will appear " +
            "when the user returns.",
      });
    },
  );

  server.tool(
    "storymap_get_project",
    `Read the current story map structure. Only available when the user
has enabled Read Mode in the Connect AI panel.`,
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
      if (!session.consentRead) return readNotPermitted();
      try {
        await touchSession(db, sessionId);
      } catch {
        // non-fatal: presence refresh is best-effort
      }
      try {
        const snap = await db
          .collection("anonymous_sessions")
          .doc(sessionId)
          .collection("snapshot")
          .doc("current")
          .get();
        if (!snap.exists) {
          return ok({
            status: "no_snapshot",
            message:
              "No snapshot yet. Ask the user to open SPERT Story Map " +
              "with Read Mode enabled, then retry.",
          });
        }
        const data = snap.data();
        return ok({status: "ok", project: data?.product ?? null});
      } catch {
        return ok({
          status: "error",
          error: "internal",
          message: "Snapshot read failed; retry.",
        });
      }
    },
  );

  // Phase 1 fine-grained stubs: direct callers to bulk_import.
  const stubs = [
    "storymap_create_theme",
    "storymap_create_backbone",
    "storymap_create_rib",
    "storymap_update_theme",
    "storymap_update_backbone",
    "storymap_update_rib",
  ];
  for (const name of stubs) {
    server.tool(
      name,
      "Phase 1 stub. Use storymap_bulk_import instead.",
      {sessionId: z.string().uuid()},
      async () =>
        ok({
          status: "not_implemented",
          message: `${name} is not yet available. Use ` +
            "storymap_bulk_import.",
        }),
    );
  }
}
