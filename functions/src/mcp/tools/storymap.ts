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
import {ok, sessionNotFound, readNotPermitted, rateLimited} from "./shared";

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

// Phase 7 move shapes. "At least one target present" cannot be expressed on
// a raw ZodRawShape (no .refine() attachment point) — the fine-grained
// handler checks it inline; a targetless bulk entry is a browser-side
// per-entry skip (matching bulk_update_ribs' pattern, so one bad entry
// cannot reject a whole 500-entry call).
const moveRibShape = {
  sessionId: z.string().uuid(),
  ribId: entityIdSchema,
  targetBackboneId: entityIdSchema.optional(),
  targetReleaseId: entityIdSchema.optional(),
};

const bulkMoveRibsShape = {
  sessionId: z.string().uuid(),
  moves: z.array(z.object({
    ribId: entityIdSchema,
    targetBackboneId: entityIdSchema.optional(),
    targetReleaseId: entityIdSchema.optional(),
  })).min(1).max(500),
};

/**
 * Register all SPERT Story Map MCP tools on the given server instance.
 *
 * Discovery (1): storymap_get_project. (The shared resolve_session_code and
 * get_session_info now live in registerSharedSessionTools.)
 *
 * Fine-grained operations (11): storymap_create_theme,
 * storymap_create_backbone, storymap_create_rib, storymap_update_theme,
 * storymap_update_backbone, storymap_update_rib, storymap_create_release,
 * storymap_allocate_rib, storymap_unassign_rib, storymap_size_rib,
 * storymap_move_rib.
 *
 * Bulk operations (7): storymap_bulk_import, storymap_bulk_create_releases,
 * storymap_bulk_allocate, storymap_bulk_size, storymap_bulk_unassign,
 * storymap_bulk_update_ribs, storymap_bulk_move_ribs.
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
Chain calls back-to-back within one response; do not yield between calls.
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
Chain calls back-to-back within one response; do not yield between calls.
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
Chain calls back-to-back within one response; do not yield between calls.
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
For sizing, prefer storymap_size_rib — it validates against the
project's actual sizeMapping and skips already-sized ribs. For many
ribs at once, use storymap_bulk_size. Use the size parameter here
only to explicitly override or clear an existing size.
cardColor is user-controlled and not exposed here.
No-op on the browser if the ribId does not exist — or if the rib was
moved (storymap_move_rib) and your cached themeId/backboneId is
stale; re-read IDs with storymap_get_project after any move. Calling
with no updateable fields returns success without writing an op.`,
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

  // --- Phase 2: release planning -------------------------------------

  server.tool(
    "storymap_create_release",
    `Create a named release in the open story map.
Generate a fresh UUID for releaseId. Does NOT require reading the
current project state first — no storymap_get_project needed.
Create ALL releases before allocating any ribs: storymap_allocate_rib
silently skips if the release does not exist yet.
Chain calls back-to-back within one response; do not yield between calls.
IDEMPOTENCY: calling twice with the same releaseId is a no-op (the
browser skips an existing release), but each call consumes a
rate-limit token.`,
    {
      sessionId: z.string().uuid(),
      releaseId: entityIdSchema,
      name: z.string().min(1).max(1000),
    },
    async ({sessionId, releaseId, name}) => {
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
          {op: "create_release", payload: {releaseId, name}},
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
        releaseId,
        browserConnected: connected,
        message: connected ?
          "Queued. If Read Mode is enabled, verify the result with " +
            "storymap_get_project." :
          "Queued — will apply when the browser reconnects.",
      });
    },
  );

  server.tool(
    "storymap_allocate_rib",
    `Allocate a rib 100% to a release.
PREREQUISITES: call storymap_get_project first (Read Mode required)
to read the ribId, the rib's releaseIds, and its locked state. The
release must already exist (storymap_create_release) — the browser
silently skips a non-existent release.
ADDITIVE: the browser skips ribs that are already allocated and skips
locked ribs. Re-running is safe.
To MOVE a rib to a different release (or backbone), use
storymap_move_rib instead.
Chain calls back-to-back within one response; do not yield between calls.`,
    {
      sessionId: z.string().uuid(),
      ribId: entityIdSchema,
      releaseId: entityIdSchema,
    },
    async ({sessionId, ribId, releaseId}) => {
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
          {op: "allocate_rib", payload: {ribId, releaseId}},
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
    "storymap_unassign_rib",
    `Remove ALL release allocations from a rib.
PREREQUISITES: call storymap_get_project first (Read Mode required)
to read the ribId and the rib's locked state.
WARNING: this removes the rib from every release it belongs to, not
just one. If the rib has more than one entry in releaseIds, warn the
user before calling.
The browser skips locked ribs; an already-unassigned rib is a no-op.
Chain calls back-to-back within one response; do not yield between calls.`,
    {
      sessionId: z.string().uuid(),
      ribId: entityIdSchema,
    },
    async ({sessionId, ribId}) => {
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
          {op: "unassign_rib", payload: {ribId}},
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
        ribId,
        browserConnected: connected,
        message: connected ?
          "Queued. If Read Mode is enabled, verify the result with " +
            "storymap_get_project." :
          "Queued — will apply when the browser reconnects.",
      });
    },
  );

  // --- Phase 3: sizing -----------------------------------------------

  server.tool(
    "storymap_size_rib",
    `Assign a t-shirt size to an unsized rib.
PREREQUISITES: call storymap_get_project first (Read Mode required)
to read the product's sizeMapping (the valid labels and their point
values), each rib's current size, and each rib's locked state.
SIZE VALUE: pass a label taken from sizeMapping verbatim — not a
fixed XS/S/M/L scale. An unknown label is silently skipped by the
browser with no error. If sizeMapping is empty, tell the user to
define sizes in Settings first.
ADDITIVE: the browser skips ribs that already have a valid size and
skips locked ribs. Re-running is safe.
This CANNOT resize or clear an existing size — use the Sizing board
in the app for that.
Chain calls back-to-back within one response; do not yield between calls.`,
    {
      sessionId: z.string().uuid(),
      ribId: entityIdSchema,
      // size is a label from the product's live sizeMapping, not a
      // fixed enum — passed through verbatim for the browser to
      // validate against the live mapping. Bounded like an id token.
      size: z.string().min(1).max(100),
    },
    async ({sessionId, ribId, size}) => {
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
          {op: "size_rib", payload: {ribId, size}},
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
        ribId,
        browserConnected: connected,
        message: connected ?
          "Queued. If Read Mode is enabled, verify the result with " +
            "storymap_get_project." :
          "Queued — will apply when the browser reconnects.",
      });
    },
  );

  // --- Phase 4: bulk operations --------------------------------------

  server.tool(
    "storymap_bulk_create_releases",
    `Create multiple named releases in one call.
Generate a fresh UUID for each releaseId. Does NOT require Read Mode.
Create ALL releases before allocating ribs — storymap_bulk_allocate
silently skips an allocation whose target release does not exist yet.
IDEMPOTENT: duplicate releaseIds are skipped by the browser.
Max 50 releases per call; split larger sets across multiple calls.`,
    {
      sessionId: z.string().uuid(),
      releases: z.array(z.object({
        releaseId: entityIdSchema,
        name: z.string().min(1).max(1000),
      })).min(1).max(50),
    },
    async ({sessionId, releases}) => {
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
          {op: "bulk_create_releases", payload: {releases}},
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
        count: releases.length,
        browserConnected: connected,
        message: connected ?
          `Queued ${releases.length} release(s). Call ` +
            "storymap_bulk_allocate next." :
          `Queued ${releases.length} release(s) — no browser tab open; ` +
            "applies on reconnect.",
      });
    },
  );

  server.tool(
    "storymap_bulk_allocate",
    `Allocate many ribs to releases in one call. Each entry assigns one
rib 100% to one release.
PREREQUISITES: call storymap_get_project first (Read Mode required)
to read ribIds, each rib's releaseIds, and locked state. Releases must
already exist (storymap_bulk_create_releases or storymap_create_release).
ADDITIVE: the browser skips ribs that are locked, already allocated, or
whose target release does not exist. Re-running is safe.
Max 500 allocations per call; split larger sets across multiple calls.`,
    {
      sessionId: z.string().uuid(),
      allocations: z.array(z.object({
        ribId: entityIdSchema,
        releaseId: entityIdSchema,
      })).min(1).max(500),
    },
    async ({sessionId, allocations}) => {
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
          {op: "bulk_allocate", payload: {allocations}},
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
        count: allocations.length,
        browserConnected: connected,
        message: connected ?
          `Queued ${allocations.length} allocation(s). Locked and ` +
            "already-allocated ribs are skipped." :
          `Queued ${allocations.length} allocation(s) — no browser tab ` +
            "open; applies on reconnect.",
      });
    },
  );

  server.tool(
    "storymap_bulk_size",
    `Assign t-shirt sizes to many ribs in one call.
PREREQUISITES: call storymap_get_project first (Read Mode required)
to read ribIds, each rib's current size and locked state, and the
project's sizeMapping (the valid labels and their point values).
SIZE VALUES: pass labels taken from sizeMapping verbatim — not a fixed
XS/S/M/L scale. An unknown label is silently skipped by the browser.
ADDITIVE: the browser skips ribs that are locked or already validly
sized. Re-running is safe. Prefer this over storymap_update_rib for
sizing — it validates against the project's actual sizeMapping.
Max 500 sizings per call; split larger sets across multiple calls.`,
    {
      sessionId: z.string().uuid(),
      sizes: z.array(z.object({
        ribId: entityIdSchema,
        size: z.string().min(1).max(100),
      })).min(1).max(500),
    },
    async ({sessionId, sizes}) => {
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
          {op: "bulk_size", payload: {sizes}},
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
        count: sizes.length,
        browserConnected: connected,
        message: connected ?
          `Queued ${sizes.length} sizing assignment(s). Locked, ` +
            "already-sized, and unknown-label ribs are skipped." :
          `Queued ${sizes.length} sizing assignment(s) — no browser ` +
            "tab open; applies on reconnect.",
      });
    },
  );

  // --- Phase 5: bulk unassign ----------------------------------------
  server.tool(
    "storymap_bulk_unassign",
    `Removes all release allocations from multiple ribs in one call.
Requires Read Mode — call storymap_get_project first to obtain ribIds
and each rib's locked state. Locked ribs and already-unassigned ribs
are silently skipped; only unlocked, allocated ribs are cleared.
WARNING: unassign removes ALL of a rib's release allocations, not just
one — if a rib is split across multiple releases (releaseIds.length >
1), warn the user before including it in this call.
ADDITIVE / RE-RUN: re-running is safe — already-unassigned ribs skip.
Max 500 ribIds per call; split larger batches.`,
    {
      sessionId: z.string().uuid(),
      ribIds: z.array(entityIdSchema).min(1).max(500),
    },
    async ({sessionId, ribIds}) => {
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
          {op: "bulk_unassign", payload: {ribIds}},
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
        count: ribIds.length,
        browserConnected: connected,
        message: connected ?
          `Queued ${ribIds.length} unassignment(s). Locked and ` +
            "already-unassigned ribs are skipped." :
          `Queued ${ribIds.length} unassignment(s) — no browser tab ` +
            "open; applies on reconnect.",
      });
    },
  );

  // --- Phase 6: bulk update ribs -------------------------------------
  server.tool(
    "storymap_bulk_update_ribs",
    `
Update description, category, and/or notes on multiple rib items in one call.
Read Mode required — call storymap_get_project first to obtain ribId values.
Provide an updates array; each entry must have a ribId plus at least one of:
description (string), category ("core" or "non-core"), notes (string).
Fields omitted from an entry are left unchanged.
An empty string "" clears a field.
Locked (in-progress) ribs can still have their text fields updated.
For sizing ribs, use storymap_bulk_size instead.
For renaming ribs, use storymap_update_rib instead.
Chain calls back-to-back within one response; do not yield between calls.
Max 500 entries per call; split larger batches.
NOTE: storymap_get_project does not return existing notes values — you cannot
read notes before writing. Verify description and category writes with a
follow-up storymap_get_project call.`,
    {
      sessionId: z.string().uuid(),
      updates: z.array(z.object({
        ribId: entityIdSchema,
        description: z.string().max(2000).optional(),
        category: z.enum(["core", "non-core"]).optional(),
        notes: z.string().max(2000).optional(),
      })).min(1).max(500),
    },
    async ({sessionId, updates}) => {
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
          {op: "bulk_update_ribs", payload: {updates}},
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
        count: updates.length,
        browserConnected: connected,
        message: connected ?
          `Queued ${updates.length} rib update(s). Omitted fields ` +
            "are left unchanged." :
          `Queued ${updates.length} rib update(s) — no browser tab ` +
            "open; applies on reconnect.",
      });
    },
  );

  // --- Phase 7: move rib ---------------------------------------------
  server.tool(
    "storymap_move_rib",
    `Moves a rib item to a different backbone and/or reassigns its release
allocation, in one call. Provide targetBackboneId, targetReleaseId, or
both — at least one is required. targetBackboneId may belong to any
theme, not just the rib's current one.
PREREQUISITES: call storymap_get_project first (Read Mode required) to
read entity IDs and each rib's releaseIds, locked, and partial fields.
SKIP-THEN-REPLACE semantics — the browser silently skips a leg
(applying the other if valid) when: the target backbone or release
does not exist; the rib is locked (in progress) — this blocks the
RELEASE change only, the backbone change still applies; the rib's
current allocation is a split (releaseIds has more than one entry) or
partial (partial: true — a single allocation under 100%) — the release
leg is skipped rather than overwritten; or the rib is already at the
requested target for that leg. Check locked, releaseIds, and partial
BEFORE calling to know whether the release leg will apply.
On an eligible rib the release leg REPLACES the allocation wholesale —
it is not additive. For an unallocated or single-100%-allocated rib,
this replaces the old unassign-then-allocate two-step; for a split or
partial rib, call storymap_unassign_rib first, then this tool. To
clear a rib's allocation without setting a new one, use
storymap_unassign_rib alone.
If Read Mode is enabled, verify the result with storymap_get_project.
Chain calls back-to-back within one response; do not yield between calls.`,
    moveRibShape,
    async ({sessionId, ribId, targetBackboneId, targetReleaseId}) => {
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
      if (targetBackboneId === undefined && targetReleaseId === undefined) {
        return ok({
          status: "success",
          ribId,
          browserConnected: isBrowserConnected(session),
          message: "No target provided; nothing written.",
        });
      }
      if (!checkSessionWriteLimit(sessionId)) return rateLimited();
      try {
        await writeOpBatch(db, sessionId, [{
          op: "move_rib",
          payload: {
            ribId,
            ...(targetBackboneId !== undefined && {targetBackboneId}),
            ...(targetReleaseId !== undefined && {targetReleaseId}),
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
    "storymap_bulk_move_ribs",
    `Moves multiple rib items in one call — each entry relocates one rib to
a different backbone and/or reassigns its release allocation. Provide
targetBackboneId, targetReleaseId, or both per entry; an entry with
neither is skipped. targetBackboneId may belong to any theme.
PREREQUISITES: call storymap_get_project first (Read Mode required) to
read entity IDs and each rib's releaseIds, locked, and partial fields.
Same SKIP-THEN-REPLACE semantics as storymap_move_rib, applied per
entry: a leg is silently skipped when its target does not exist, the
rib is locked (blocks the RELEASE change only — the backbone change
still applies), the current allocation is a split (releaseIds has more
than one entry) or partial (partial: true), or the rib is already at
the target. On an eligible rib the release leg REPLACES the allocation
wholesale — it is not additive. For a split or partial rib, unassign
first, then move. A skipped or invalid entry never affects the other
entries in the same call.
Prefer this over many sequential storymap_move_rib calls for
reorg-sized work — one call consumes one rate-limit token regardless
of array size. Verify results with storymap_get_project after.
Max 500 moves per call; split larger sets across multiple calls.`,
    bulkMoveRibsShape,
    async ({sessionId, moves}) => {
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
          {op: "bulk_move_ribs", payload: {moves}},
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
        count: moves.length,
        browserConnected: connected,
        message: connected ?
          `Queued ${moves.length} move(s). Ineligible legs (locked, ` +
            "split/partial, missing targets) are skipped per entry." :
          `Queued ${moves.length} move(s) — no browser tab open; ` +
            "applies on reconnect.",
      });
    },
  );
}
