// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {DocumentData, Firestore} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
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
  backbones: z.array(backboneSchema).max(10),
});

// Fine-grained tool shapes. Raw ZodRawShape objects (not z.object wrappers)
// because server.tool() takes Args extends ZodRawShape. entityIdSchema mirrors
// the bulk_import id caps (stable strings, not enforced UUID format — quality
// guidance to mint UUIDs lives in the tool descriptions).
const entityIdSchema = z.string().min(1).max(100);

const updateBackboneShape = {
  sessionId: z.string().uuid(),
  themeId: entityIdSchema,
  backboneId: entityIdSchema,
  name: z.string().min(1).max(1000).optional(),
  description: z.string().max(2000).optional(),
};

const updateRibShape = {
  sessionId: z.string().uuid(),
  themeId: entityIdSchema,
  backboneId: entityIdSchema,
  ribId: entityIdSchema,
  name: z.string().min(1).max(1000).optional(),
  description: z.string().max(2000).optional(),
  category: z.enum(["core", "non-core"]).optional(),
  notes: z.string().max(2000).optional(),
  size: z.enum(["XS", "S", "M", "L", "XL", "XXL", "XXXL"])
    .nullable().optional(),
};

/**
 * Register all SPERT Story Map MCP tools on the given server instance.
 * Exposes: resolve_session_code, get_session_info, storymap_bulk_import,
 * storymap_get_project, and six fine-grained create/update tools.
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
    `Check session status and learn which project is currently open in
SPERT Story Map. Call this after resolve_session_code.
To build a map from scratch: ask the user what product they are
planning and which modeling approach fits, then call
storymap_bulk_import. Do not build until confirmed.
To add to or edit an existing map: call storymap_get_project first
to discover the structure and entity IDs (requires Read Mode — if
not enabled, ask the user to turn it on in the Connect AI panel).
Then use the fine-grained tools.`,
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
          "A project is open. To build from scratch: storymap_bulk_import " +
            "(ask the user for the product description and approach first). " +
            "To add/edit an existing map: call storymap_get_project to get " +
            "entity IDs (Read Mode required — if off, ask the user to enable " +
            "it in the Connect AI panel), then use storymap_create_theme, " +
            "storymap_create_backbone, storymap_create_rib, " +
            "storymap_update_theme, storymap_update_backbone, or " +
            "storymap_update_rib." :
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

Caps: 5 themes x 10 backbones x 10 ribs. Per rib you may set description,
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

  server.tool(
    "storymap_create_theme",
    `Add a new theme to the open story map.
FOR TARGETED ADDITIONS to an existing map only. To build a new map
from scratch, use storymap_bulk_import — faster and avoids mid-build
failures from partial sequences.
ID GENERATION: generate a UUID for the themeId. The IDs returned by
storymap_get_project identify existing entities for UPDATE calls —
do not reuse them for CREATE calls or the create will be a no-op.
SEQUENTIAL CALLS REQUIRED: await each result before the next.
IDEMPOTENCY: calling twice with the same themeId is a no-op (no
duplicate created), but each call consumes a rate-limit token.`,
    {
      sessionId: z.string().uuid(),
      themeId: entityIdSchema,
      name: z.string().min(1).max(1000),
    },
    async ({sessionId, themeId, name}) => {
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
          {op: "create_theme", payload: {themeId, name}},
        ]);
      } catch (e: unknown) {
        const msg = (e as Error).message;
        if (msg === "session_not_found") return sessionNotFound();
        return ok({
          status: "error",
          error: "internal",
          message: "Op write failed; retry.",
        });
      }
      const connected = isBrowserConnected(session);
      return ok({
        status: "success",
        themeId,
        browserConnected: connected,
        message: connected ?
          "Queued. If Read Mode is enabled, verify the result with " +
            "storymap_get_project." :
          "Queued — will apply when the browser reconnects.",
      });
    },
  );

  server.tool(
    "storymap_create_backbone",
    `Add a new backbone under an existing theme.
FOR TARGETED ADDITIONS to an existing map only. Prefer
storymap_bulk_import when building from scratch.
PREREQUISITES: the theme (themeId) must already exist. Call
storymap_get_project (Read Mode required) to discover existing IDs.
ID GENERATION: generate a UUID for the backboneId.
SEQUENTIAL CALLS REQUIRED: await each result before the next.
IDEMPOTENCY: calling twice with the same backboneId is a no-op.`,
    {
      sessionId: z.string().uuid(),
      themeId: entityIdSchema,
      backboneId: entityIdSchema,
      name: z.string().min(1).max(1000),
      description: z.string().max(2000).optional(),
    },
    async ({sessionId, themeId, backboneId, name, description}) => {
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
        await writeOpBatch(db, sessionId, [{
          op: "create_backbone",
          payload: {
            themeId,
            backboneId,
            name,
            ...(description !== undefined && {description}),
          },
        }]);
      } catch (e: unknown) {
        const msg = (e as Error).message;
        if (msg === "session_not_found") return sessionNotFound();
        return ok({
          status: "error",
          error: "internal",
          message: "Op write failed; retry.",
        });
      }
      const connected = isBrowserConnected(session);
      return ok({
        status: "success",
        backboneId,
        browserConnected: connected,
        message: connected ?
          "Queued. If Read Mode is enabled, verify the result with " +
            "storymap_get_project." :
          "Queued — will apply when the browser reconnects.",
      });
    },
  );

  server.tool(
    "storymap_create_rib",
    `Add a new rib item to an existing backbone.
FOR TARGETED ADDITIONS to an existing map only. Prefer
storymap_bulk_import when building from scratch.
PREREQUISITES: both the theme (themeId) and backbone (backboneId)
must already exist. Call storymap_get_project (Read Mode required)
to discover existing IDs.
ID GENERATION: generate a UUID for the ribId.
category defaults to "core" when omitted. An invalid category value
is rejected (unlike storymap_bulk_import which coerces to "core").
SIZE: ribs are created without a size. Use storymap_update_rib to
set size on individual ribs, or have the user size them in the Sizing
tab. Note each update_rib call consumes a rate-limit token.
SEQUENTIAL CALLS REQUIRED: await each result before the next.
IDEMPOTENCY: calling twice with the same ribId is a no-op.`,
    {
      sessionId: z.string().uuid(),
      themeId: entityIdSchema,
      backboneId: entityIdSchema,
      ribId: entityIdSchema,
      name: z.string().min(1).max(1000),
      description: z.string().max(2000).optional(),
      category: z.enum(["core", "non-core"]).optional(),
      notes: z.string().max(2000).optional(),
    },
    async ({
      sessionId,
      themeId,
      backboneId,
      ribId,
      name,
      description,
      category,
      notes,
    }) => {
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
        await writeOpBatch(db, sessionId, [{
          op: "create_rib",
          payload: {
            themeId,
            backboneId,
            ribId,
            name,
            ...(description !== undefined && {description}),
            ...(category !== undefined && {category}),
            ...(notes !== undefined && {notes}),
          },
        }]);
      } catch (e: unknown) {
        const msg = (e as Error).message;
        if (msg === "session_not_found") return sessionNotFound();
        return ok({
          status: "error",
          error: "internal",
          message: "Op write failed; retry.",
        });
      }
      const connected = isBrowserConnected(session);
      return ok({
        status: "success",
        ribId,
        browserConnected: connected,
        message: connected ?
          "Queued. If Read Mode is enabled, verify the result with " +
            "storymap_get_project." :
          "Queued — will apply when the browser reconnects.",
      });
    },
  );

  server.tool(
    "storymap_update_theme",
    `Rename an existing theme.
Only name is updatable — theme color is user-controlled. Call
storymap_get_project (Read Mode required) to discover the themeId.
No-op on the browser if the themeId does not exist.`,
    {
      sessionId: z.string().uuid(),
      themeId: entityIdSchema,
      name: z.string().min(1).max(1000),
    },
    async ({sessionId, themeId, name}) => {
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
          {op: "update_theme", payload: {themeId, name}},
        ]);
      } catch (e: unknown) {
        const msg = (e as Error).message;
        if (msg === "session_not_found") return sessionNotFound();
        return ok({
          status: "error",
          error: "internal",
          message: "Op write failed; retry.",
        });
      }
      const connected = isBrowserConnected(session);
      return ok({
        status: "success",
        themeId,
        browserConnected: connected,
        message: connected ?
          "Queued. If Read Mode is enabled, verify the result with " +
            "storymap_get_project." :
          "Queued — will apply when the browser reconnects.",
      });
    },
  );

  server.tool(
    "storymap_update_backbone",
    `Update an existing backbone's name and/or description.
All fields are optional — provide only those to change. Call
storymap_get_project (Read Mode required) to discover IDs.
To clear a description, set it to an empty string ("").
No-op on the browser if the backboneId does not exist. Calling
with no updateable fields returns success without writing an op.`,
    updateBackboneShape,
    async ({sessionId, themeId, backboneId, name, description}) => {
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
      if (name === undefined && description === undefined) {
        return ok({
          status: "success",
          backboneId,
          browserConnected: isBrowserConnected(session),
          message: "No fields to update; nothing written.",
        });
      }
      if (!checkSessionWriteLimit(sessionId)) return rateLimited();
      try {
        await writeOpBatch(db, sessionId, [{
          op: "update_backbone",
          payload: {
            themeId,
            backboneId,
            ...(name !== undefined && {name}),
            ...(description !== undefined && {description}),
          },
        }]);
      } catch (e: unknown) {
        const msg = (e as Error).message;
        if (msg === "session_not_found") return sessionNotFound();
        return ok({
          status: "error",
          error: "internal",
          message: "Op write failed; retry.",
        });
      }
      const connected = isBrowserConnected(session);
      return ok({
        status: "success",
        backboneId,
        browserConnected: connected,
        message: connected ?
          "Queued. If Read Mode is enabled, verify the result with " +
            "storymap_get_project." :
          "Queued — will apply when the browser reconnects.",
      });
    },
  );

  server.tool(
    "storymap_update_rib",
    `Update one or more fields on an existing rib item.
All fields are optional — provide only those to change. Call
storymap_get_project (Read Mode required) to discover IDs.
size: "XS"|"S"|"M"|"L"|"XL"|"XXL"|"XXXL"|null to clear.
size is silently ignored for ribs with sprint progress recorded
(in-progress size is locked to preserve historical analytics).
cardColor is user-controlled and not exposed here.
No-op on the browser if the ribId does not exist. Calling with no
updateable fields returns success without writing an op.`,
    updateRibShape,
    async ({
      sessionId,
      themeId,
      backboneId,
      ribId,
      name,
      description,
      category,
      notes,
      size,
    }) => {
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
      if (
        name === undefined &&
        description === undefined &&
        category === undefined &&
        notes === undefined &&
        size === undefined
      ) {
        return ok({
          status: "success",
          ribId,
          browserConnected: isBrowserConnected(session),
          message: "No fields to update; nothing written.",
        });
      }
      if (!checkSessionWriteLimit(sessionId)) return rateLimited();
      try {
        await writeOpBatch(db, sessionId, [{
          op: "update_rib",
          payload: {
            themeId,
            backboneId,
            ribId,
            ...(name !== undefined && {name}),
            ...(description !== undefined && {description}),
            ...(category !== undefined && {category}),
            ...(notes !== undefined && {notes}),
            // size !== undefined is true when size is null (null-clear).
            ...(size !== undefined && {size}),
          },
        }]);
      } catch (e: unknown) {
        const msg = (e as Error).message;
        if (msg === "session_not_found") return sessionNotFound();
        return ok({
          status: "error",
          error: "internal",
          message: "Op write failed; retry.",
        });
      }
      const connected = isBrowserConnected(session);
      return ok({
        status: "success",
        ribId,
        browserConnected: connected,
        message: connected ?
          "Queued. If Read Mode is enabled, verify the result with " +
            "storymap_get_project." :
          "Queued — will apply when the browser reconnects.",
      });
    },
  );
}
