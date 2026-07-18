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

const SESSIONS = "anonymous_sessions";
const DISTRIBUTIONS = ["normal", "logNormal", "triangular", "uniform"] as const;
const DEP_TYPES = ["FS", "SS", "FF"] as const;
// RSM confidence levels, duplicated from the scheduler client
// (src/domain/models/types.ts RSM_LEVELS). Declared `as const` so Zod 3's
// z.enum() receives a non-empty tuple type. Domain carried in the contract
// fixture ai-op-contract.json (P0.5).
const RSM_LEVELS = [
  "nearCertainty",
  "veryHighConfidence",
  "highConfidence",
  "mediumHighConfidence",
  "mediumConfidence",
  "mediumLowConfidence",
  "lowConfidence",
  "veryLowConfidence",
  "extremelyLowConfidence",
  "guesstimate",
] as const;

// Bulk op payload byte ceiling (P0.3 step 0). Measured on a JSON proxy of
// {op, payload}; the ~248 KB headroom to Firestore's 1 MiB covers the envelope
// fields writeOpBatch adds and JSON-vs-Firestore accounting (Spike V1 checks).
const BULK_BYTE_LIMIT = 800_000;

type Envelope = ReturnType<typeof ok>;
type Op = {op: string; payload: object};
// The composite import payload as the server inspects it — only section lengths
// and scenarioId are read here; per-item shapes are the client's concern. The
// whole payload is still written to the op verbatim for the client to drain.
interface ImportPayload {
  scenarioId?: string;
  activities?: unknown[];
  milestones?: unknown[];
  assignments?: unknown[];
  dependencies?: unknown[];
}

/**
 * Build a connected-aware "queued" message for a write tool.
 * @param {string} noun Human label for what was queued (e.g. "Activity").
 * @return {Function} Message builder keyed on browser presence.
 */
function queued(noun: string): (connected: boolean) => string {
  return (connected: boolean): string =>
    connected ?
      `${noun} queued; it will apply immediately.` :
      `${noun} queued; it will apply when the user reopens SPERT Scheduler.`;
}

/**
 * Load a session, or return the appropriate error envelope to short-circuit.
 * @param {Firestore} db Admin Firestore instance.
 * @param {string} sessionId Session id.
 * @return {Promise<object>} The session, else a discriminated error
 *   envelope.
 */
async function loadSessionOrError(
  db: Firestore,
  sessionId: string,
): Promise<{session: DocumentData} | {error: Envelope}> {
  let session: DocumentData | null = null;
  try {
    session = await getSession(db, sessionId);
  } catch {
    return {error: ok({
      status: "error",
      error: "internal",
      message: "Temporary error; retry.",
    })};
  }
  if (!session) return {error: sessionNotFound()};
  return {session};
}

/**
 * Rate-limit, write the ops, and build the connected-aware success envelope
 * (carrying the assigned seq range). Assumes the session is already loaded.
 * @param {Firestore} db Admin Firestore instance.
 * @param {string} sessionId Session id.
 * @param {DocumentData} session The already-loaded session doc.
 * @param {Array<Op>} ops Ops to append.
 * @param {Function} describe Success-message builder.
 * @return {Promise<Envelope>} The tool response envelope.
 */
async function writeAndRespond(
  db: Firestore,
  sessionId: string,
  session: DocumentData,
  ops: Op[],
  describe: (connected: boolean) => string,
): Promise<Envelope> {
  if (!checkSessionWriteLimit(sessionId)) return rateLimited();
  let range: {firstSeq: number; lastSeq: number};
  try {
    range = await writeOpBatch(db, sessionId, ops);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg === "session_not_found") return sessionNotFound();
    return ok({
      status: "error",
      error: "internal",
      message: `Op write failed: ${msg}`,
    });
  }
  const connected = isBrowserConnected(session);
  return ok({
    status: "success",
    firstSeq: range.firstSeq,
    lastSeq: range.lastSeq,
    browserConnected: connected,
    message: describe(connected),
  });
}

/**
 * The default write path for a Scheduler tool: load session then write.
 * @param {Firestore} db Admin Firestore instance.
 * @param {string} sessionId Session id.
 * @param {Array<Op>} ops Ops to append.
 * @param {Function} describe Success-message builder.
 * @return {Promise<Envelope>} The tool response envelope.
 */
async function runWrite(
  db: Firestore,
  sessionId: string,
  ops: Op[],
  describe: (connected: boolean) => string,
): Promise<Envelope> {
  const loaded = await loadSessionOrError(db, sessionId);
  if ("error" in loaded) return loaded.error;
  return writeAndRespond(db, sessionId, loaded.session, ops, describe);
}

interface SnapshotScenario {
  id: string;
  dependencyMode?: boolean;
  activityIds: string[];
}

/**
 * Read Mode + snapshot gate, split out (decision 15 / P0.3) so callers can act
 * on the returned scenario. Confirms consent, that a snapshot exists, and that
 * it carries the named scenario; returns the scenario record (id,
 * dependencyMode, activity ids) or a refusal envelope. Does NOT assert
 * dependency mode — the caller layers that on (the dependency gate) or omits it
 * (the read gate, Phase 3). The read_not_permitted refusal reuses the
 * field-less readNotPermitted() envelope, the norm for every read-gated write.
 * @param {Firestore} db Admin Firestore instance.
 * @param {DocumentData} session The already-loaded session doc.
 * @param {string} sessionId Session id.
 * @param {string} scenarioId Target scenario id.
 * @return {Promise<object>} {scenario} to proceed, else {error}.
 */
async function fetchSnapshotScenario(
  db: Firestore,
  session: DocumentData,
  sessionId: string,
  scenarioId: string,
): Promise<{scenario: SnapshotScenario} | {error: Envelope}> {
  if (!session.consentRead) return {error: readNotPermitted()};
  let data: DocumentData | undefined;
  try {
    const snap = await db.collection(SESSIONS).doc(sessionId)
      .collection("snapshot").doc("current").get();
    if (!snap.exists) {
      return {error: ok({
        status: "error",
        error: "no_snapshot",
        message: "No snapshot yet. Ask the user to open SPERT Scheduler " +
          "with Read Mode enabled, then retry.",
      })};
    }
    data = snap.data();
  } catch {
    return {error: ok({
      status: "error",
      error: "internal",
      message: "Snapshot read failed; retry.",
    })};
  }
  const project = data?.project as {
    scenarios?: Array<{
      id: string;
      dependencyMode?: boolean;
      activities?: Array<{id: string}>;
    }>;
  } | undefined;
  const scenario = project?.scenarios?.find((s) => s.id === scenarioId);
  if (!scenario) {
    return {error: ok({
      status: "error",
      error: "scenario_not_found",
      message: `No scenario '${scenarioId}' in the snapshot. Call ` +
        "scheduler_get_project to see the current scenario ids.",
    })};
  }
  return {scenario: {
    id: scenario.id,
    dependencyMode: scenario.dependencyMode,
    activityIds: (scenario.activities ?? []).map((a) => a.id),
  }};
}

/**
 * The dependency-tool write path: additionally requires Read Mode and a
 * snapshot confirming the scenario exists with dependencyMode ON.
 * @param {Firestore} db Admin Firestore instance.
 * @param {string} sessionId Session id.
 * @param {string} scenarioId Target scenario id (required for dep ops).
 * @param {Array<Op>} ops Ops to append.
 * @param {Function} describe Success-message builder.
 * @return {Promise<Envelope>} The tool response envelope.
 */
async function runDependencyWrite(
  db: Firestore,
  sessionId: string,
  scenarioId: string,
  ops: Op[],
  describe: (connected: boolean) => string,
): Promise<Envelope> {
  const loaded = await loadSessionOrError(db, sessionId);
  if ("error" in loaded) return loaded.error;
  const {session} = loaded;
  const gate = await fetchSnapshotScenario(db, session, sessionId, scenarioId);
  if ("error" in gate) return gate.error;
  if (!gate.scenario.dependencyMode) {
    return ok({
      status: "error",
      error: "dependency_mode_off",
      message: `Scenario '${scenarioId}' does not have dependency mode on. ` +
        "Ask the user to enable it for that scenario, then retry.",
    });
  }
  return writeAndRespond(db, sessionId, session, ops, describe);
}

/**
 * Byte guard for bulk ops (P0.3 step 0 — before loadSession, a pure payload
 * computation, so an oversized call costs zero Firestore reads and no rate
 * token). F3-11: an oversized call that also has a bad session or a failing
 * gate reports payload_too_large first. Returns a refusal envelope, else null.
 * @param {string} op Op name.
 * @param {object} payload Op payload.
 * @return {Envelope | null} Refusal envelope when too large, else null.
 */
function checkPayloadSize(op: string, payload: object): Envelope | null {
  if (Buffer.byteLength(JSON.stringify({op, payload})) > BULK_BYTE_LIMIT) {
    return ok({
      status: "error",
      error: "payload_too_large",
      message: "Split this call into smaller batches.",
    });
  }
  return null;
}

/**
 * Build the connected-aware "packed" message for a bulk write tool. `packed` is
 * the item count packed into the single queued op — all-or-nothing at this
 * layer (server Zod is all-or-nothing); per-item results appear client-side.
 * @param {string} noun Human label for what was packed (e.g. "Activities").
 * @return {Function} Message builder keyed on browser presence.
 */
function packed(noun: string): (connected: boolean) => string {
  return (connected: boolean): string =>
    connected ?
      `${noun} packed into one queued op; per-item results appear as it ` +
        "applies. Verify with scheduler_get_project." :
      `${noun} packed into one queued op; applies when the user reopens ` +
        "SPERT Scheduler. Verify with scheduler_get_project.";
}

/**
 * Rate-limit, write the single fat op, and build the "packed" success envelope
 * (carrying the item count and assigned seq range). Assumes the session is
 * loaded and any gate has passed.
 * @param {Firestore} db Admin Firestore instance.
 * @param {string} sessionId Session id.
 * @param {DocumentData} session The already-loaded session doc.
 * @param {Op} op The single bulk op to append.
 * @param {number} count Items packed into the op.
 * @param {Function} describe Success-message builder.
 * @return {Promise<Envelope>} The tool response envelope.
 */
async function writeBulkAndRespond(
  db: Firestore,
  sessionId: string,
  session: DocumentData,
  op: Op,
  count: number,
  describe: (connected: boolean) => string,
): Promise<Envelope> {
  if (!checkSessionWriteLimit(sessionId)) return rateLimited();
  let range: {firstSeq: number; lastSeq: number};
  try {
    range = await writeOpBatch(db, sessionId, [op]);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg === "session_not_found") return sessionNotFound();
    return ok({
      status: "error",
      error: "internal",
      message: `Op write failed: ${msg}`,
    });
  }
  const connected = isBrowserConnected(session);
  return ok({
    status: "success",
    packed: count,
    firstSeq: range.firstSeq,
    lastSeq: range.lastSeq,
    browserConnected: connected,
    message: describe(connected),
  });
}

/**
 * The default bulk write path (1A/1C/1D): byte guard, load session, write.
 * @param {Firestore} db Admin Firestore instance.
 * @param {string} sessionId Session id.
 * @param {Op} op The single bulk op to append.
 * @param {number} count Items packed into the op.
 * @param {Function} describe Success-message builder.
 * @return {Promise<Envelope>} The tool response envelope.
 */
async function runBulkWrite(
  db: Firestore,
  sessionId: string,
  op: Op,
  count: number,
  describe: (connected: boolean) => string,
): Promise<Envelope> {
  const sizeErr = checkPayloadSize(op.op, op.payload);
  if (sizeErr) return sizeErr;
  const loaded = await loadSessionOrError(db, sessionId);
  if ("error" in loaded) return loaded.error;
  return writeBulkAndRespond(
    db, sessionId, loaded.session, op, count, describe,
  );
}

/**
 * The dependency bulk write path (1B): byte guard, load session, dependency
 * gate (Read Mode + snapshot proving dependencyMode ON), write.
 * @param {Firestore} db Admin Firestore instance.
 * @param {string} sessionId Session id.
 * @param {string} scenarioId Target scenario id (required for dep ops).
 * @param {Op} op The single bulk op to append.
 * @param {number} count Items packed into the op.
 * @param {Function} describe Success-message builder.
 * @return {Promise<Envelope>} The tool response envelope.
 */
async function runBulkDependencyWrite(
  db: Firestore,
  sessionId: string,
  scenarioId: string,
  op: Op,
  count: number,
  describe: (connected: boolean) => string,
): Promise<Envelope> {
  const sizeErr = checkPayloadSize(op.op, op.payload);
  if (sizeErr) return sizeErr;
  const loaded = await loadSessionOrError(db, sessionId);
  if ("error" in loaded) return loaded.error;
  const {session} = loaded;
  const gate = await fetchSnapshotScenario(db, session, sessionId, scenarioId);
  if ("error" in gate) return gate.error;
  if (!gate.scenario.dependencyMode) {
    return ok({
      status: "error",
      error: "dependency_mode_off",
      message: `Scenario '${scenarioId}' does not have dependency mode on. ` +
        "Ask the user to enable it for that scenario, then retry.",
    });
  }
  return writeBulkAndRespond(db, sessionId, session, op, count, describe);
}

/**
 * Rate-limit, write the single composite import op, and build the success
 * envelope carrying a per-section `packed` map + `packedTotal`. Assumes the
 * session is loaded and the inline checks / dependency gate have passed.
 * @param {Firestore} db Admin Firestore instance.
 * @param {string} sessionId Session id.
 * @param {DocumentData} session The already-loaded session doc.
 * @param {Op} op The single composite op to append.
 * @param {object} packedCounts Items packed per section.
 * @param {number} packedTotal Total items packed across all sections.
 * @param {Function} describe Success-message builder.
 * @return {Promise<Envelope>} The tool response envelope.
 */
async function writeBulkImportAndRespond(
  db: Firestore,
  sessionId: string,
  session: DocumentData,
  op: Op,
  packedCounts: {
    activities: number;
    milestones: number;
    assignments: number;
    dependencies: number;
  },
  packedTotal: number,
  describe: (connected: boolean) => string,
): Promise<Envelope> {
  if (!checkSessionWriteLimit(sessionId)) return rateLimited();
  let range: {firstSeq: number; lastSeq: number};
  try {
    range = await writeOpBatch(db, sessionId, [op]);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg === "session_not_found") return sessionNotFound();
    return ok({
      status: "error",
      error: "internal",
      message: `Op write failed: ${msg}`,
    });
  }
  const connected = isBrowserConnected(session);
  return ok({
    status: "success",
    packed: packedCounts,
    packedTotal,
    firstSeq: range.firstSeq,
    lastSeq: range.lastSeq,
    browserConnected: connected,
    message: describe(connected),
  });
}

/**
 * The composite import write path (2B): byte guard, load session, inline checks
 * (>=1 section non-empty; dependencies => scenarioId), a CONDITIONAL dependency
 * gate (only when dependencies are present; else the plain path, no Read Mode),
 * then write. All-or-nothing at queue time: any failing check refuses the whole
 * call and queues nothing.
 * @param {Firestore} db Admin Firestore instance.
 * @param {string} sessionId Session id.
 * @param {ImportPayload} payload The composite payload (sections + scenarioId).
 * @param {Function} describe Success-message builder.
 * @return {Promise<Envelope>} The tool response envelope.
 */
async function runBulkImportWrite(
  db: Firestore,
  sessionId: string,
  payload: ImportPayload,
  describe: (connected: boolean) => string,
): Promise<Envelope> {
  const op: Op = {op: "bulk_import_schedule", payload};
  const sizeErr = checkPayloadSize(op.op, op.payload);
  if (sizeErr) return sizeErr;
  const loaded = await loadSessionOrError(db, sessionId);
  if ("error" in loaded) return loaded.error;
  const {session} = loaded;

  const activities = payload.activities ?? [];
  const milestones = payload.milestones ?? [];
  const assignments = payload.assignments ?? [];
  const dependencies = payload.dependencies ?? [];
  const packedTotal =
    activities.length + milestones.length +
    assignments.length + dependencies.length;

  // Inline check 1: at least one section non-empty.
  if (packedTotal === 0) {
    return ok({
      status: "error",
      error: "empty_import",
      message: "Nothing to import — provide at least one of activities, " +
        "milestones, assignments, or dependencies.",
    });
  }
  // Inline check 2: dependencies require a target scenarioId.
  if (dependencies.length > 0 && !payload.scenarioId) {
    return ok({
      status: "error",
      error: "scenario_required_for_dependencies",
      message: "Pass scenarioId (the target dependency-mode scenario) when " +
        "the import includes dependencies.",
    });
  }
  // Conditional dependency gate — only when dependencies are present.
  if (dependencies.length > 0) {
    const gate = await fetchSnapshotScenario(
      db, session, sessionId, payload.scenarioId as string,
    );
    if ("error" in gate) return gate.error;
    if (!gate.scenario.dependencyMode) {
      return ok({
        status: "error",
        error: "dependency_mode_off",
        message: `Scenario '${payload.scenarioId}' does not have dependency ` +
          "mode on. Ask the user to enable it for that scenario, then retry.",
      });
    }
  }

  const packedCounts = {
    activities: activities.length,
    milestones: milestones.length,
    assignments: assignments.length,
    dependencies: dependencies.length,
  };
  return writeBulkImportAndRespond(
    db, sessionId, session, op, packedCounts, packedTotal, describe,
  );
}

// ── Reusable field schemas ───────────────────────────────────────────────────
const sid = z.string().uuid();
const scenarioIdOpt = z.string().min(1).max(64).optional();
const entityId = z.string().min(1).max(64);
const items = z.array(
  z.object({id: entityId, text: z.string().min(1).max(200)}),
).min(1).max(50);

// ── Bulk item schemas ────────────────────────────────────────────────────────
// The per-item object schemas, named so both the single-array bulk shapes AND
// the composite import shape (bulk_import_schedule) reuse the SAME item
// definitions; the fixture duplicates these rows verbatim per section.
const bulkActivityItem = z.object({
  id: entityId,
  name: z.string().min(1).max(200),
  min: z.number().nonnegative(),
  mostLikely: z.number().nonnegative(),
  max: z.number().nonnegative(),
  confidenceLevel: z.enum(RSM_LEVELS).optional(),
  distributionType: z.enum(DISTRIBUTIONS).optional(),
  description: z.string().max(2000).optional(),
  note: z.string().min(1).max(2000).optional(),
});
const bulkDependencyItem = z.object({
  fromActivityId: entityId,
  toActivityId: entityId,
  type: z.enum(DEP_TYPES).optional(),
  lagDays: z.number().int().min(-365).max(365).optional(),
});
const bulkMilestoneItem = z.object({
  id: entityId,
  name: z.string().min(1).max(200),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const bulkAssignmentItem = z.object({
  activityId: entityId,
  milestoneId: entityId,
});
// Phase 2 — every field except id is optional (patch semantics; absent =
// unchanged). Empty-string description clears (validated client-side).
const bulkUpdateItem = z.object({
  id: entityId,
  name: z.string().min(1).max(200).optional(),
  min: z.number().nonnegative().optional(),
  mostLikely: z.number().nonnegative().optional(),
  max: z.number().nonnegative().optional(),
  confidenceLevel: z.enum(RSM_LEVELS).optional(),
  distributionType: z.enum(DISTRIBUTIONS).optional(),
  description: z.string().max(2000).optional(),
});

// ── Bulk tool raw shapes ─────────────────────────────────────────────────────
// server.tool() takes a ZodRawShape (a plain object of Zod fields). These are
// exported so ai-op-contract.test.ts can drive them — asserting field names,
// required/optional, enum domains, bounds, and array caps against the fixture
// without walking Zod _def internals (P0.2 / F3-7).
export const bulkCreateActivitiesShape = {
  sessionId: sid,
  scenarioId: scenarioIdOpt,
  activities: z.array(bulkActivityItem).min(1).max(100),
};

export const bulkCreateDependenciesShape = {
  sessionId: sid,
  scenarioId: entityId,
  dependencies: z.array(bulkDependencyItem).min(1).max(500),
};

export const bulkCreateMilestonesShape = {
  sessionId: sid,
  scenarioId: scenarioIdOpt,
  milestones: z.array(bulkMilestoneItem).min(1).max(100),
};

export const bulkAssignMilestonesShape = {
  sessionId: sid,
  scenarioId: scenarioIdOpt,
  assignments: z.array(bulkAssignmentItem).min(1).max(500),
};

// Phase 2 — 2A: one array of ≤100 patches, plain (ungated) write path.
export const bulkUpdateActivitiesShape = {
  sessionId: sid,
  scenarioId: scenarioIdOpt,
  updates: z.array(bulkUpdateItem).min(1).max(100),
};

// Phase 2 — 2B: four OPTIONAL sections, each capped, no `.min` (the "at least
// one non-empty" rule is an inline handler check, not structural). scenarioId
// is optional here; the handler requires it only when dependencies are present.
export const bulkImportScheduleShape = {
  sessionId: sid,
  scenarioId: scenarioIdOpt,
  activities: z.array(bulkActivityItem).max(100).optional(),
  milestones: z.array(bulkMilestoneItem).max(100).optional(),
  assignments: z.array(bulkAssignmentItem).max(500).optional(),
  dependencies: z.array(bulkDependencyItem).max(500).optional(),
};

/**
 * Register the SPERT Scheduler MCP tools on the given server instance. Reads
 * go through the browser-pushed snapshot (Read Mode); writes queue ops the
 * paired browser drains and applies through the app's own validation.
 *
 * @param {McpServer} server MCP server to register tools on.
 * @param {Firestore} db Admin Firestore instance (bypasses rules).
 * @return {void}
 */
export function registerSchedulerTools(
  server: McpServer,
  db: Firestore,
): void {
  server.tool(
    "scheduler_get_project",
    `Read the open SPERT Scheduler project: scenarios, activities (with
three-point estimates and computed schedule dates), milestones,
dependencies, and any validation errors. ONLY available when the user has
enabled Read Mode in the Connect AI panel. Call this to discover activity,
scenario, and milestone ids before any update/toggle/assign/dependency call.`,
    {sessionId: sid},
    async ({sessionId}) => {
      const loaded = await loadSessionOrError(db, sessionId);
      if ("error" in loaded) return loaded.error;
      if (!loaded.session.consentRead) return readNotPermitted();
      try {
        await touchSession(db, sessionId);
      } catch {
        // non-fatal: presence refresh is best-effort
      }
      try {
        const snap = await db.collection(SESSIONS).doc(sessionId)
          .collection("snapshot").doc("current").get();
        if (!snap.exists) {
          return ok({
            status: "no_snapshot",
            message: "No snapshot yet. Ask the user to open SPERT " +
              "Scheduler with Read Mode enabled, then retry.",
          });
        }
        return ok({status: "ok", project: snap.data()?.project ?? null});
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
    "scheduler_create_activity",
    `Create an activity in the open scenario (or the given scenarioId).
Generate a stable id yourself. Provide a name and a three-point estimate in
working days with min <= mostLikely <= max. distributionType is
auto-recommended at create time if omitted; confidenceLevel defaults to the
scenario's setting.`,
    {
      sessionId: sid,
      scenarioId: scenarioIdOpt,
      id: entityId,
      name: z.string().min(1).max(200),
      min: z.number().nonnegative(),
      mostLikely: z.number().nonnegative(),
      max: z.number().nonnegative(),
      confidenceLevel: z.enum(RSM_LEVELS).optional(),
      distributionType: z.enum(DISTRIBUTIONS).optional(),
      description: z.string().max(2000).optional(),
    },
    async ({sessionId, ...payload}) =>
      runWrite(db, sessionId, [{op: "create_activity", payload}],
        queued("Activity")),
  );

  server.tool(
    "scheduler_update_activity_estimate",
    `Update an existing activity's three-point estimate, confidenceLevel,
and/or distributionType. Provide only the fields you are changing; the merged
estimate must keep min <= mostLikely <= max. Invalidates simulation results.`,
    {
      sessionId: sid,
      scenarioId: scenarioIdOpt,
      id: entityId,
      min: z.number().nonnegative().optional(),
      mostLikely: z.number().nonnegative().optional(),
      max: z.number().nonnegative().optional(),
      confidenceLevel: z.enum(RSM_LEVELS).optional(),
      distributionType: z.enum(DISTRIBUTIONS).optional(),
    },
    async ({sessionId, ...payload}) =>
      runWrite(db, sessionId, [{op: "update_activity_estimate", payload}],
        queued("Estimate update")),
  );

  server.tool(
    "scheduler_rename_activity",
    "Rename an existing activity. Invalidates simulation results.",
    {sessionId: sid, scenarioId: scenarioIdOpt, id: entityId,
      name: z.string().min(1).max(200)},
    async ({sessionId, ...payload}) =>
      runWrite(db, sessionId, [{op: "rename_activity", payload}],
        queued("Rename")),
  );

  server.tool(
    "scheduler_set_activity_description",
    `Set an activity's plain-language scope description (max 2000 chars),
overwriting any existing description. An EMPTY STRING CLEARS the description.
This is destructive (overwrite, not append) and INVALIDATES simulation results,
so prefer setting description at create time, or enable Read Mode first so you
can see the text you would replace.`,
    {sessionId: sid, scenarioId: scenarioIdOpt, id: entityId,
      description: z.string().max(2000)},
    async ({sessionId, ...payload}) =>
      runWrite(db, sessionId, [{op: "set_activity_description", payload}],
        queued("Description")),
  );

  server.tool(
    "scheduler_append_activity_note",
    `Append a note to an activity's free-text notes (existing notes are kept;
the new text is added after a blank line). Non-invalidating. The append is
rejected if it would push notes past 2000 characters — keep notes concise or
split across calls.`,
    {sessionId: sid, scenarioId: scenarioIdOpt, id: entityId,
      text: z.string().min(1).max(2000)},
    async ({sessionId, ...payload}) =>
      runWrite(db, sessionId, [{op: "append_activity_note", payload}],
        queued("Note")),
  );

  server.tool(
    "scheduler_add_checklist_items",
    `Add checklist (task) items to an activity. Supply a stable id and text
per item. Duplicate ids and items past the 50-item cap are skipped; the rest
apply. Non-invalidating.`,
    {sessionId: sid, scenarioId: scenarioIdOpt, id: entityId, items},
    async ({sessionId, ...payload}) =>
      runWrite(db, sessionId, [{op: "add_checklist_items", payload}],
        queued("Checklist items")),
  );

  server.tool(
    "scheduler_add_deliverable_items",
    `Add deliverable items to an activity. Supply a stable id and text per
item. Duplicate ids and items past the 50-item cap are skipped. Non-
invalidating.`,
    {sessionId: sid, scenarioId: scenarioIdOpt, id: entityId, items},
    async ({sessionId, ...payload}) =>
      runWrite(db, sessionId, [{op: "add_deliverable_items", payload}],
        queued("Deliverable items")),
  );

  server.tool(
    "scheduler_toggle_checklist_item",
    "Set the completed state of an existing checklist item. Non-invalidating.",
    {sessionId: sid, scenarioId: scenarioIdOpt, id: entityId,
      itemId: entityId, completed: z.boolean()},
    async ({sessionId, ...payload}) =>
      runWrite(db, sessionId, [{op: "toggle_checklist_item", payload}],
        queued("Checklist toggle")),
  );

  server.tool(
    "scheduler_toggle_deliverable_item",
    "Toggle an existing deliverable item's completed state. Non-invalidating.",
    {sessionId: sid, scenarioId: scenarioIdOpt, id: entityId,
      itemId: entityId, completed: z.boolean()},
    async ({sessionId, ...payload}) =>
      runWrite(db, sessionId, [{op: "toggle_deliverable_item", payload}],
        queued("Deliverable toggle")),
  );

  server.tool(
    "scheduler_create_milestone",
    `Create a milestone with a stable id you generate, a name, and a
targetDate (YYYY-MM-DD). Invalidates simulation results.`,
    {sessionId: sid, scenarioId: scenarioIdOpt, id: entityId,
      name: z.string().min(1).max(200),
      targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)},
    async ({sessionId, ...payload}) =>
      runWrite(db, sessionId, [{op: "create_milestone", payload}],
        queued("Milestone")),
  );

  server.tool(
    "scheduler_update_milestone",
    `Update a milestone's name and/or targetDate (YYYY-MM-DD). Provide only
the fields you are changing. Invalidates simulation results.`,
    {sessionId: sid, scenarioId: scenarioIdOpt, id: entityId,
      name: z.string().min(1).max(200).optional(),
      targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()},
    async ({sessionId, ...payload}) =>
      runWrite(db, sessionId, [{op: "update_milestone", payload}],
        queued("Milestone update")),
  );

  server.tool(
    "scheduler_assign_milestone",
    `Assign an activity to an existing milestone (both must exist).
Invalidates simulation results.`,
    {sessionId: sid, scenarioId: scenarioIdOpt, activityId: entityId,
      milestoneId: entityId},
    async ({sessionId, ...payload}) =>
      runWrite(db, sessionId, [{op: "assign_milestone", payload}],
        queued("Milestone assignment")),
  );

  server.tool(
    "scheduler_unassign_milestone",
    "Unassign an activity from its milestone. Invalidates simulation results.",
    {sessionId: sid, scenarioId: scenarioIdOpt, activityId: entityId},
    async ({sessionId, ...payload}) =>
      runWrite(db, sessionId, [{op: "unassign_milestone", payload}],
        queued("Milestone unassignment")),
  );

  server.tool(
    "scheduler_create_dependency",
    `Create a dependency edge between two activities. REQUIRES Read Mode and a
scenario whose dependencyMode is already enabled by the user (the tool refuses
otherwise). type defaults to "FS" (finish-to-start); lagDays defaults to 0.
Invalidates simulation results.`,
    {sessionId: sid, scenarioId: entityId,
      fromActivityId: entityId, toActivityId: entityId,
      type: z.enum(DEP_TYPES).optional(),
      lagDays: z.number().int().min(-365).max(365).optional()},
    async ({sessionId, ...payload}) =>
      runDependencyWrite(db, sessionId, payload.scenarioId,
        [{op: "create_dependency", payload}], queued("Dependency")),
  );

  server.tool(
    "scheduler_remove_dependency",
    `Remove the dependency edge for a from/to pair. REQUIRES Read Mode and a
dependency-mode scenario. Invalidates simulation results.`,
    {sessionId: sid, scenarioId: entityId,
      fromActivityId: entityId, toActivityId: entityId},
    async ({sessionId, ...payload}) =>
      runDependencyWrite(db, sessionId, payload.scenarioId,
        [{op: "remove_dependency", payload}], queued("Dependency removal")),
  );

  server.tool(
    "scheduler_update_dependency",
    `Update a dependency edge's lagDays and/or type. Provide at least one.
REQUIRES Read Mode and a dependency-mode scenario. Invalidates simulation
results.`,
    {sessionId: sid, scenarioId: entityId,
      fromActivityId: entityId, toActivityId: entityId,
      lagDays: z.number().int().min(-365).max(365).optional(),
      type: z.enum(DEP_TYPES).optional()},
    async ({sessionId, ...payload}) =>
      runDependencyWrite(db, sessionId, payload.scenarioId,
        [{op: "update_dependency", payload}], queued("Dependency update")),
  );

  // ── Bulk tools (Phase 1) ───────────────────────────────────────────────────

  server.tool(
    "scheduler_bulk_create_activities",
    `Create many activities in one call — the PRIMARY way to build a schedule.
Recommended batch size: 25-50 items when descriptions/notes are heavily
populated; up to 100 for light items. If your runtime truncates a large tool
call, the server rejects the malformed arguments with a schema error — the
cause is your own output limit, not the data. Generate a stable id per
activity; give a three-point estimate in WORKING DAYS with
min <= mostLikely <= max. distributionType is auto-recommended per item when
omitted; confidenceLevel defaults to the scenario setting. Optional per item: a
scope description and an initial note. Duplicate ids, cap overflow, and items
that fail validation are skipped individually — the rest apply. Verify with
scheduler_get_project.`,
    bulkCreateActivitiesShape,
    async ({sessionId, ...payload}) =>
      runBulkWrite(db, sessionId,
        {op: "bulk_create_activities", payload},
        payload.activities.length, packed("Activities")),
  );

  server.tool(
    "scheduler_bulk_create_dependencies",
    `Create many dependency edges in one call. REQUIRES Read Mode and a scenario
whose dependencyMode is already enabled by the user (pass its scenarioId); the
tool refuses otherwise. type defaults to "FS"; lagDays defaults to 0. An edge
set that is acyclic TOGETHER WITH the scenario's existing dependencies applies
fully regardless of array order. Array order matters only when the submitted
set — combined with the existing dependencies — contains a cycle: it decides
WHICH edges skip as "cycle". Fix the cycle and resubmit only the skipped edges.
Unknown endpoints, self-edges, duplicates, and cap overflow skip per item.
Invalidates simulation results.`,
    bulkCreateDependenciesShape,
    async ({sessionId, ...payload}) =>
      runBulkDependencyWrite(db, sessionId, payload.scenarioId,
        {op: "bulk_create_dependencies", payload},
        payload.dependencies.length, packed("Dependencies")),
  );

  server.tool(
    "scheduler_bulk_create_milestones",
    `Create many milestones in one call. Generate a stable id per milestone;
give a name and a targetDate (YYYY-MM-DD). Duplicate ids, cap overflow, and
malformed dates skip individually — the rest apply. Invalidates simulation
results. Verify with scheduler_get_project.`,
    bulkCreateMilestonesShape,
    async ({sessionId, ...payload}) =>
      runBulkWrite(db, sessionId,
        {op: "bulk_create_milestones", payload},
        payload.milestones.length, packed("Milestones")),
  );

  server.tool(
    "scheduler_bulk_assign_milestones",
    `Assign many activities to milestones in one call. Each entry assigns one
activity to one existing milestone (both must exist). Unknown activity or
milestone ids and already-present assignments skip individually. Repeated
activityId entries are last-wins. Invalidates simulation results. Verify with
scheduler_get_project.`,
    bulkAssignMilestonesShape,
    async ({sessionId, ...payload}) =>
      runBulkWrite(db, sessionId,
        {op: "bulk_assign_milestones", payload},
        payload.assignments.length, packed("Assignments")),
  );

  // ── Bulk tools (Phase 2) ───────────────────────────────────────────────────

  server.tool(
    "scheduler_bulk_update_activities",
    `Update many existing activities in one call. Each entry targets an activity
by id and patches ONLY the fields you include — name, three-point estimate
(min/mostLikely/max in WORKING DAYS), confidenceLevel, distributionType, and/or
description. Absent fields are left unchanged; an EMPTY-STRING description
CLEARS it. The MERGED estimate (current values plus your changes) must keep
min <= mostLikely <= max, or that one entry is skipped as invalid while the rest
apply. Unknown ids skip as not_found; an entry with no updatable field skips as
invalid; an entry whose values already match skips as no-change. Repeated ids
apply in array order — a later entry sees the earlier one's result. Recommended
batch size: up to 100 (25-50 when descriptions are heavy — your output budget,
not the server, is the ceiling). Invalidates simulation results. Verify with
scheduler_get_project.`,
    bulkUpdateActivitiesShape,
    async ({sessionId, ...payload}) =>
      runBulkWrite(db, sessionId,
        {op: "bulk_update_activities", payload},
        payload.updates.length, packed("Activity updates")),
  );

  server.tool(
    "scheduler_bulk_import",
    `Build a whole schedule in ONE call: activities, milestones, milestone
assignments, and dependencies together (all sections optional; at least one
must be non-empty). Sections apply in a fixed order — activities, then
milestones, then assignments, then dependencies — so an assignment or edge may
reference an activity or milestone created earlier in the SAME call. Generate
stable ids yourself. Per-item skips apply individually EXCEPT: an activity or
milestone skipped for a reason implying it was never created (invalid or
cap_exceeded) takes its dependent assignments and edges with it as not_found; a
duplicate does NOT cascade (the entity exists), which is what makes re-import
idempotent. An edge can skip as "cycle" when the submitted edges TOGETHER WITH
the scenario's existing dependencies form a cycle, even if the submitted set
alone is acyclic. If you include dependencies you MUST pass scenarioId (the
target scenario) and it REQUIRES Read Mode plus that scenario's dependency mode
enabled; a dependencies-carrying import is all-or-nothing at BOTH queue time and
apply time — if dependency mode is off (or is turned off before the browser
applies it) the ENTIRE import, activities and milestones included, is declined
with a single message. Re-verify with scheduler_get_project and resubmit after
the user re-enables it. An import with no dependencies needs no Read Mode.
Recommended batch size: up to 100 activities/milestones and 500
assignments/edges (fewer when descriptions are heavy). Invalidates simulation
results. Verify with scheduler_get_project.`,
    bulkImportScheduleShape,
    async ({sessionId, ...payload}) =>
      runBulkImportWrite(db, sessionId, payload, packed("Schedule")),
  );
}
