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

type Envelope = ReturnType<typeof ok>;
type Op = {op: string; payload: object};

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

/**
 * Read the snapshot and confirm the target scenario exists with dependency
 * mode ON (§4.6 server-side gate). Returns an error envelope to refuse, or
 * null to proceed.
 * @param {Firestore} db Admin Firestore instance.
 * @param {string} sessionId Session id.
 * @param {string} scenarioId Target scenario id.
 * @return {Promise<object>} Refusal envelope, or null when allowed.
 */
async function checkDependencyScenario(
  db: Firestore,
  sessionId: string,
  scenarioId: string,
): Promise<Envelope | null> {
  let data: DocumentData | undefined;
  try {
    const snap = await db.collection(SESSIONS).doc(sessionId)
      .collection("snapshot").doc("current").get();
    if (!snap.exists) {
      return ok({
        status: "error",
        error: "no_snapshot",
        message: "No snapshot yet. Ask the user to open SPERT Scheduler " +
          "with Read Mode enabled, then retry.",
      });
    }
    data = snap.data();
  } catch {
    return ok({
      status: "error",
      error: "internal",
      message: "Snapshot read failed; retry.",
    });
  }
  const project = data?.project as {
    scenarios?: Array<{id: string; dependencyMode?: boolean}>;
  } | undefined;
  const scenario = project?.scenarios?.find((s) => s.id === scenarioId);
  if (!scenario) {
    return ok({
      status: "error",
      error: "scenario_not_found",
      message: `No scenario '${scenarioId}' in the snapshot. Call ` +
        "scheduler_get_project to see the current scenario ids.",
    });
  }
  if (!scenario.dependencyMode) {
    return ok({
      status: "error",
      error: "dependency_mode_off",
      message: `Scenario '${scenarioId}' does not have dependency mode on. ` +
        "Ask the user to enable it for that scenario, then retry.",
    });
  }
  return null;
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
  if (!session.consentRead) return readNotPermitted();
  const gate = await checkDependencyScenario(db, sessionId, scenarioId);
  if (gate) return gate;
  return writeAndRespond(db, sessionId, session, ops, describe);
}

// ── Reusable field schemas ───────────────────────────────────────────────────
const sid = z.string().uuid();
const scenarioIdOpt = z.string().min(1).max(64).optional();
const entityId = z.string().min(1).max(64);
const items = z.array(
  z.object({id: entityId, text: z.string().min(1).max(200)}),
).min(1).max(50);

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
      confidenceLevel: z.string().min(1).max(50).optional(),
      distributionType: z.enum(DISTRIBUTIONS).optional(),
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
      confidenceLevel: z.string().min(1).max(50).optional(),
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
}
