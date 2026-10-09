// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

// The five refusals that stand between a connected AI and a dependency write
// or a project read. Three gates refuse a dependency write while the target
// scenario's dependency mode is off (dependency_mode_off); two refuse while
// the browser has not sent the project (no_snapshot). No tool can clear either
// condition, so each message has to say what the user must do, and where.
//
// Every site is driven through the tool handler that reaches it, captured
// with the shim schedulerBulkImport.test.ts uses (a fake McpServer recording
// each handler by name), and every test asserts the WHOLE parsed envelope with
// toEqual: the status and error fields stay pinned byte for byte, no field can
// be added unnoticed, and the message is pinned in full. The expected words
// are written out below, never imported from scheduler.ts, so a test cannot
// agree with the code by construction.

jest.mock("../mcp/session", () => ({
  getSession: jest.fn(),
  touchSession: jest.fn(),
  writeOpBatch: jest.fn(),
  isBrowserConnected: jest.fn(),
}));

jest.mock("../mcp/rateLimit", () => ({
  checkSessionWriteLimit: jest.fn(() => true),
}));

jest.mock("firebase-functions/logger", () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  log: jest.fn(),
  debug: jest.fn(),
}));

import type {DocumentData} from "firebase-admin/firestore";
import {getSession, writeOpBatch} from "../mcp/session";
import {registerSchedulerTools} from "../mcp/tools/scheduler";

const mockGetSession =
  getSession as jest.MockedFunction<typeof getSession>;
const mockWriteOpBatch =
  writeOpBatch as jest.MockedFunction<typeof writeOpBatch>;

type ToolResult = {content: Array<{type: string; text: string}>};
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

const SID = "00000000-0000-4000-8000-000000000000";

// The words, in full. A change here is a change to what every connected AI
// tells a user.
const NO_SNAPSHOT =
  "No snapshot yet. Read Mode is on, but no project from SPERT Scheduler is " +
  "available. Ask the user to keep the project open in the browser tab where " +
  "they connected the AI. If that tab is gone, or its header shows a " +
  "\"Connect AI\" button, they open the project in that browser and press " +
  "\"Connect AI\" (if a \"Connect an AI assistant\" window opens instead, " +
  "that browser no longer holds this connection: they make sure " +
  "\"Read Mode\" is ticked, press \"Connect\", and read out the session code " +
  "the panel then shows — the AI must connect again with that code before it " +
  "retries). Then retry in a few seconds. If this keeps happening, ask them " +
  "to look in that browser's console for a message beginning " +
  "\"[AI] Snapshot\".";

/**
 * The dependency_mode_off message for one scenario id.
 * @param {string} id The scenario id the call targeted.
 * @return {string} The expected message.
 */
function dependencyModeOff(id: string): string {
  return "In the project SPERT Scheduler last sent, scenario " +
    `'${id}' does not have dependency mode on. Ask the user to make this ` +
    "change in the browser tab where they connected the AI. If this project " +
    "is also open in another tab of that browser, they close that tab and " +
    "then reload this one, so that it holds the latest copy (every tab " +
    "connected to the AI sends its own copy of the project, and whichever " +
    "sends last wins, even an older copy). If that tab is gone, or its " +
    "header shows a \"Connect AI\" button — as it does after a reload — they " +
    "open the project in that browser and press \"Connect AI\" (if a " +
    "\"Connect an AI assistant\" window opens instead, that browser no " +
    "longer holds this connection: they make sure \"Read Mode\" is ticked, " +
    "press \"Connect\", and read out the session code the panel then shows — " +
    "the AI must connect again with that code before it retries); once the " +
    "Connect AI panel opens, they close it by pressing Esc or clicking " +
    "outside it — not \"Disconnect\", which ends the AI's connection. There, " +
    "they select that scenario by its name, not its id, and turn on its " +
    "\"Dependencies\" switch, in the summary panel above the activity list, " +
    "on the same row as \"Parkinson's Law\". It is not the Dependencies " +
    "panel further down the page, which shows only while the selected " +
    "scenario's switch is on and has no switch of its own. If that " +
    "scenario's tab shows an amber lock icon, whose tooltip reads " +
    "\"Unlock scenario\", the scenario is locked: they press that icon to " +
    "unlock it first. Once they confirm, wait a few seconds, then retry. If " +
    "the switch was already on and the retry is refused again, ask them to " +
    "look in that browser's console for a message beginning \"[AI] Snapshot\".";
}

/**
 * Build a session doc stub with the given Read-Mode consent flag.
 * @param {boolean} consentRead Whether Read Mode is granted.
 * @return {DocumentData} A session-shaped stub.
 */
function session(consentRead: boolean): DocumentData {
  return {consentRead, connected: {browser: true}} as unknown as DocumentData;
}

/**
 * Build a mock db whose snapshot chain returns NO snapshot (null), or a
 * project carrying one scenario with the given id and dependency-mode flag.
 * `snapshotGet` is exposed so a test can assert the snapshot was (or was
 * not) read.
 * @param {object | null} scenario The snapshot's one scenario, or null.
 * @return {{db: object, snapshotGet: jest.Mock}} Mock db + the snapshot spy.
 */
function makeDb(
  scenario: {id: string; dependencyMode: boolean} | null,
): {db: object; snapshotGet: jest.Mock} {
  const snapshotGet = jest.fn(async () => scenario === null ?
    {exists: false, data: () => undefined} :
    {
      exists: true,
      data: () => ({
        project: {
          scenarios: [{
            id: scenario.id,
            dependencyMode: scenario.dependencyMode,
            activities: [{id: "a"}, {id: "b"}],
          }],
        },
      }),
    });
  const db = {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        collection: jest.fn(() => ({doc: jest.fn(() => ({get: snapshotGet}))})),
      })),
    })),
  };
  return {db, snapshotGet};
}

/**
 * Register the scheduler tools against a capturing fake McpServer, invoke one
 * tool's handler and parse its JSON envelope.
 * @param {object} db Mock db injected into registerSchedulerTools.
 * @param {string} tool The registered tool name.
 * @param {Record<string, unknown>} args Tool arguments (sessionId added).
 * @return {Promise<Record<string, unknown>>} The parsed response body.
 */
async function call(
  db: object,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const handlers: Record<string, Handler> = {};
  const fakeServer = {
    tool: (...toolArgs: unknown[]) => {
      handlers[toolArgs[0] as string] =
        toolArgs[toolArgs.length - 1] as Handler;
    },
  };
  registerSchedulerTools(
    fakeServer as unknown as Parameters<typeof registerSchedulerTools>[0],
    db as Parameters<typeof registerSchedulerTools>[1],
  );
  const handler = handlers[tool];
  if (!handler) throw new Error(`no tool registered as ${tool}`);
  const result = await handler({sessionId: SID, ...args});
  return JSON.parse(result.content[0].text);
}

const edge = {fromActivityId: "a", toActivityId: "b"};
const activity = {id: "a", name: "A", min: 1, mostLikely: 2, max: 3};

beforeEach(() => {
  mockGetSession.mockReset();
  mockWriteOpBatch.mockReset();
  mockWriteOpBatch.mockResolvedValue({firstSeq: 1, lastSeq: 1});
});

// Every tool whose path runs fetchSnapshotScenario: the three singular
// dependency tools, the bulk dependency tool, an import that carries
// dependencies, and reorder.
const SNAPSHOT_GATED: Array<[string, Record<string, unknown>]> = [
  ["scheduler_create_dependency", {scenarioId: "s1", ...edge}],
  ["scheduler_remove_dependency", {scenarioId: "s1", ...edge}],
  ["scheduler_update_dependency", {scenarioId: "s1", ...edge, lagDays: 2}],
  ["scheduler_bulk_create_dependencies",
    {scenarioId: "s1", dependencies: [edge]}],
  ["scheduler_bulk_import", {scenarioId: "s1", dependencies: [edge]}],
  ["scheduler_reorder_activities",
    {scenarioId: "s1", orderedActivityIds: ["a", "b"]}],
];

describe("no_snapshot: Read Mode on, no project sent yet", () => {
  test.each(SNAPSHOT_GATED)(
    "%s refuses with the full no_snapshot words, nothing queued",
    async (tool, args) => {
      mockGetSession.mockResolvedValue(session(true));
      const {db, snapshotGet} = makeDb(null);
      const body = await call(db, tool, args);
      expect(body).toEqual({
        status: "error",
        error: "no_snapshot",
        message: NO_SNAPSHOT,
      });
      expect(snapshotGet).toHaveBeenCalledTimes(1);
      expect(mockWriteOpBatch).not.toHaveBeenCalled();
    },
  );

  test("scheduler_get_project answers no_snapshot with the same words",
    async () => {
      mockGetSession.mockResolvedValue(session(true));
      const {db, snapshotGet} = makeDb(null);
      const body = await call(db, "scheduler_get_project", {});
      expect(body).toEqual({status: "no_snapshot", message: NO_SNAPSHOT});
      expect(snapshotGet).toHaveBeenCalledTimes(1);
    });
});

// The three singular dependency tools share the runDependencyWrite gate.
const SINGLE_DEPENDENCY_TOOLS: Array<[string, Record<string, unknown>]> = [
  ["scheduler_create_dependency", {}],
  ["scheduler_remove_dependency", {}],
  ["scheduler_update_dependency", {lagDays: 2}],
];

describe("dependency_mode_off: the scenario's Dependencies switch is off", () => {
  // Each gate gets its own scenario id, so each test also proves the message
  // names the scenario THAT call targeted.
  test.each(SINGLE_DEPENDENCY_TOOLS)(
    "%s refuses with the full words, nothing queued",
    async (tool, extra) => {
      mockGetSession.mockResolvedValue(session(true));
      const {db} = makeDb({id: "scen-single", dependencyMode: false});
      const body = await call(db, tool,
        {scenarioId: "scen-single", ...edge, ...extra});
      expect(body).toEqual({
        status: "error",
        error: "dependency_mode_off",
        message: dependencyModeOff("scen-single"),
      });
      expect(mockWriteOpBatch).not.toHaveBeenCalled();
    },
  );

  test("scheduler_bulk_create_dependencies refuses with the full words",
    async () => {
      mockGetSession.mockResolvedValue(session(true));
      const {db} = makeDb({id: "scen-bulk", dependencyMode: false});
      const body = await call(db, "scheduler_bulk_create_dependencies",
        {scenarioId: "scen-bulk", dependencies: [edge]});
      expect(body).toEqual({
        status: "error",
        error: "dependency_mode_off",
        message: dependencyModeOff("scen-bulk"),
      });
      expect(mockWriteOpBatch).not.toHaveBeenCalled();
    });

  test("scheduler_bulk_import with dependencies refuses with the full words",
    async () => {
      mockGetSession.mockResolvedValue(session(true));
      const {db} = makeDb({id: "scen-import", dependencyMode: false});
      const body = await call(db, "scheduler_bulk_import", {
        scenarioId: "scen-import",
        activities: [activity],
        dependencies: [edge],
      });
      expect(body).toEqual({
        status: "error",
        error: "dependency_mode_off",
        message: dependencyModeOff("scen-import"),
      });
      expect(mockWriteOpBatch).not.toHaveBeenCalled();
    });
});

// The no_snapshot words say "Read Mode is on". That is true only because both
// sites check consent BEFORE reading the snapshot; these two pin that order.
describe("no_snapshot is unreachable with Read Mode off", () => {
  test("scheduler_get_project: read_not_permitted, snapshot never read",
    async () => {
      mockGetSession.mockResolvedValue(session(false));
      const {db, snapshotGet} = makeDb(null);
      const body = await call(db, "scheduler_get_project", {});
      expect(body.status).toBe("read_not_permitted");
      expect(snapshotGet).not.toHaveBeenCalled();
    });

  test("a dependency write: read_not_permitted, snapshot never read",
    async () => {
      mockGetSession.mockResolvedValue(session(false));
      const {db, snapshotGet} = makeDb(null);
      const body = await call(db, "scheduler_create_dependency",
        {scenarioId: "s1", ...edge});
      expect(body.status).toBe("read_not_permitted");
      expect(snapshotGet).not.toHaveBeenCalled();
      expect(mockWriteOpBatch).not.toHaveBeenCalled();
    });
});
