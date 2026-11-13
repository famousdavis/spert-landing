// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

// One op is one Firestore document, which cannot exceed 1 MiB. Before MCP
// 1.17.1, storymap_bulk_update_ribs (500 entries) and storymap_bulk_import
// (5 x 10 x 10) accepted schema-valid calls of 6.2 MB and 8.2 MB, which
// failed at the write as "Op write failed". Both now run the shared byte
// guard. Calls go through the real McpServer and Client, so every payload
// measured below is the Zod OUTPUT the handler would write, and writeOpBatch
// is mocked to capture it.

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
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {getSession, writeOpBatch, isBrowserConnected} from "../mcp/session";
import {registerStorymapTools} from "../mcp/tools/storymap";
import {BULK_BYTE_LIMIT} from "../mcp/tools/shared";

const mockGetSession =
  getSession as jest.MockedFunction<typeof getSession>;
const mockWriteOpBatch =
  writeOpBatch as jest.MockedFunction<typeof writeOpBatch>;
const mockIsBrowserConnected =
  isBrowserConnected as jest.MockedFunction<typeof isBrowserConnected>;

const SID = "00000000-0000-4000-8000-0000000000e1";
const MIB = 1024 * 1024;

type Payload = Record<string, unknown>;
type Op = {op: string; payload: object};

// U+3042: one UTF-16 unit (what Zod's .max() counts), three UTF-8 bytes, the
// most a single unit can cost. ASCII is one byte per unit.
const A3 = (n: number): string => "あ".repeat(n);
const A1 = (n: number): string => "a".repeat(n);

/**
 * The guard's measure: JSON bytes of {op, payload}.
 * @param {string} op Op name.
 * @param {object} payload Op payload.
 * @return {number} Bytes.
 */
const opBytes = (op: string, payload: object): number =>
  Buffer.byteLength(JSON.stringify({op, payload}), "utf8");

/**
 * Firestore's documented storage size of a value: a string is its UTF-8 bytes
 * plus 1; a map is the sum of its keys (bytes plus 1) and values; an array is
 * the sum of its elements; a number 8; a boolean or null 1.
 * @param {unknown} v The value.
 * @return {number} Bytes.
 */
function valueBytes(v: unknown): number {
  if (typeof v === "string") return Buffer.byteLength(v, "utf8") + 1;
  if (typeof v === "number") return 8;
  if (Array.isArray(v)) return v.reduce((s: number, x) => s + valueBytes(x), 0);
  if (v !== null && typeof v === "object") {
    return Object.entries(v).reduce(
      (s, [k, x]) => s + valueBytes(k) + valueBytes(x), 0);
  }
  return 1;
}

/**
 * Storage size of the document writeOpBatch writes for one op: the name
 * anonymous_sessions/{sessionId}/ops/{20-character auto id} (each segment
 * plus 1, plus 16), the fields seq, op, payload, createdAt, expiresAt and
 * source, plus 32. Checked on the Firestore emulator through the real
 * writeOpBatch (2026-11-12): the largest ASCII payload it accepted models at
 * exactly 1,048,576 and one more byte was refused ("maximum entity size is
 * 1048576 bytes"); the three-byte case agreed too.
 * @param {Op} op The op as handed to writeOpBatch.
 * @return {number} Bytes.
 */
function firestoreDocBytes(op: Op): number {
  const name = ["anonymous_sessions", SID, "ops", "x".repeat(20)]
    .reduce((s, seg) => s + seg.length + 1, 0) + 16;
  return name + 32 + valueBytes({
    seq: 1,
    op: op.op,
    payload: op.payload,
    createdAt: 0,
    expiresAt: 0,
    source: "ai",
  });
}

let client: Client;

beforeAll(async () => {
  const server = new McpServer({name: "t", version: "0"});
  registerStorymapTools(server, {} as never);
  client = new Client({name: "c", version: "0"});
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterAll(async () => {
  await client.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({
    appId: "storymap",
    consentRead: true,
    consentWrite: true,
  } as unknown as DocumentData);
  mockWriteOpBatch.mockResolvedValue({firstSeq: 1, lastSeq: 1});
  mockIsBrowserConnected.mockReturnValue(true);
});

/**
 * Call a tool through the real SDK and parse its envelope. The SDK parses the
 * arguments with the tool's Zod shape first, so a call that gets a body back
 * was schema-valid.
 * @param {string} name Tool name.
 * @param {Payload} args Arguments other than sessionId.
 * @return {Promise<Payload>} The parsed body.
 */
async function call(name: string, args: Payload): Promise<Payload> {
  const res = await client.callTool({
    name,
    arguments: {sessionId: SID, ...args},
  }) as {isError?: boolean; content: Array<{text: string}>};
  if (res.isError) {
    throw new Error(`${name} refused its arguments: ${res.content[0].text}`);
  }
  return JSON.parse(res.content[0].text);
}

/**
 * The ops written by every writeOpBatch call so far.
 * @return {Op[]} The ops.
 */
const writtenOps = (): Op[] =>
  mockWriteOpBatch.mock.calls.flatMap((c) => c[2] as Op[]);

/**
 * Assert the call was refused by size before anything was read or written.
 * @param {Payload} body The tool's response body.
 * @return {void}
 */
function expectRefusedBySize(body: Payload): void {
  expect(body.status).toBe("error");
  expect(body.error).toBe("payload_too_large");
  expect(mockWriteOpBatch).not.toHaveBeenCalled();
  expect(mockGetSession).not.toHaveBeenCalled();
}

/**
 * storymap_bulk_update_ribs entries whose op is exactly `target` JSON bytes:
 * maximum-length three-byte entries first, then ASCII to land on the byte.
 * @param {number} target The op size to reach.
 * @return {Payload[]} The entries.
 */
function updatesOfSize(target: number): Payload[] {
  const updates: Payload[] = [];
  const size = () => opBytes("bulk_update_ribs", {updates});
  const full = {ribId: A3(100), description: A3(2000), notes: A3(2000)};
  while (size() + opBytes("", full) < target - 20_000) updates.push(full);
  let i = 0;
  while (target - size() > 4_000) {
    updates.push({ribId: `r${i++}`, description: A1(2000)});
  }
  const last = {ribId: "z", description: "", notes: ""};
  updates.push(last);
  const room = target - size();
  last.description = A1(Math.min(2000, room));
  last.notes = A1(room - last.description.length);
  // Control: the fixture is exactly the size it claims, and legal.
  expect(size()).toBe(target);
  expect(last.notes.length).toBeLessThanOrEqual(2000);
  expect(updates.length).toBeLessThanOrEqual(500);
  return updates;
}

describe("BULK_BYTE_LIMIT", () => {
  test("a call of exactly the limit is written, and fits one document",
    async () => {
      const updates = updatesOfSize(BULK_BYTE_LIMIT);
      const body = await call("storymap_bulk_update_ribs", {updates});
      expect(body.status).toBe("success");
      const ops = writtenOps();
      expect(ops).toHaveLength(1);
      // What was written is what the guard measured.
      expect(opBytes(ops[0].op, ops[0].payload)).toBe(BULK_BYTE_LIMIT);
      expect(firestoreDocBytes(ops[0])).toBeLessThan(MIB);
    });

  test("one byte over is refused, reading and writing nothing",
    async () => {
      const updates = updatesOfSize(BULK_BYTE_LIMIT + 1);
      const body = await call("storymap_bulk_update_ribs", {updates});
      expectRefusedBySize(body);
      expect(body.message).toContain(
        `This call is ${(BULK_BYTE_LIMIT + 1).toLocaleString("en-US")} bytes`);
      expect(body.message).toContain(
        `at most ${BULK_BYTE_LIMIT.toLocaleString("en-US")}`);
    });
});

describe("storymap_bulk_update_ribs", () => {
  const entries = (n: number) => Array.from({length: n},
    () => ({ribId: A3(100), description: A3(2000), category: "non-core",
      notes: A3(2000)}));

  test("its worst legal call (500 maximum-length entries) is refused",
    async () => {
      const updates = entries(500);
      const op = {op: "bulk_update_ribs", payload: {updates}};
      // Control: written, this would not fit a document.
      expect(firestoreDocBytes(op)).toBeGreaterThan(6_000_000);
      const body = await call("storymap_bulk_update_ribs", {updates});
      expectRefusedBySize(body);
      expect(body.message).toContain("Split it into at least 8 calls");
    });

  test("500 short entries still go in one call", async () => {
    const updates = Array.from({length: 500},
      (_, i) => ({ribId: `00000000-0000-4000-8000-${String(i).padStart(12,
        "0")}`, category: "core", description: "Lets a shopper pay by card."}));
    const body = await call("storymap_bulk_update_ribs", {updates});
    expect(body.status).toBe("success");
    expect(writtenOps()[0].payload).toStrictEqual({updates});
  });

  test("the fit counts its description states are true at the limit",
    async () => {
      const said = (await descriptions())["storymap_bulk_update_ribs"]
        .match(/about (\d+) entries fit in English and about (\d+) in Chinese/);
      expect(said).not.toBeNull();
      const [english, cjk] = [Number(said?.[1]), Number(said?.[2])];
      const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";
      const fit = (text: (n: number) => string): number => {
        const one = {ribId: uuid, description: text(2000), notes: text(2000)};
        let n = 0;
        while (opBytes("bulk_update_ribs",
          {updates: Array(n + 1).fill(one)}) <= BULK_BYTE_LIMIT) n++;
        return n;
      };
      // "About" rounds down, never up, and by less than ten.
      expect(fit(A1) - english).toBeGreaterThanOrEqual(0);
      expect(fit(A1) - english).toBeLessThan(10);
      expect(fit(A3) - cjk).toBeGreaterThanOrEqual(0);
      expect(fit(A3) - cjk).toBeLessThan(10);
    });
});

/**
 * Every Story Map tool's description, whitespace collapsed.
 * @return {Promise<Record<string, string>>} Descriptions by tool name.
 */
async function descriptions(): Promise<Record<string, string>> {
  const {tools} = await client.listTools();
  return Object.fromEntries(tools.map((t) =>
    [t.name, (t.description ?? "").replace(/\s+/g, " ")]));
}

test("both guarded tools name the limit and the refusal", async () => {
  const d = await descriptions();
  const limit = `at most ${BULK_BYTE_LIMIT.toLocaleString("en-US")} bytes`;
  for (const name of ["storymap_bulk_import", "storymap_bulk_update_ribs"]) {
    expect([name, d[name].includes(limit)]).toEqual([name, true]);
    expect([name, d[name].includes("payload_too_large")])
      .toEqual([name, true]);
  }
});

describe("storymap_bulk_import", () => {
  const rib = (t: (n: number) => string, k: number) => ({
    ribId: t(100), name: t(k), description: t(k * 2), category: "non-core",
    notes: t(k * 2),
  });
  const structure = (t: (n: number) => string, k: number) => ({
    themes: Array.from({length: 5}, () => ({
      themeId: t(100), name: t(k), description: t(k * 2),
      backbones: Array.from({length: 10}, () => ({
        backboneId: t(100), name: t(k), description: t(k * 2),
        ribs: Array.from({length: 10}, () => rib(t, k)),
      })),
    })),
  });

  test("its worst legal call (5 x 10 x 10, every field full) is refused",
    async () => {
      const s = structure(A3, 1000);
      // Control: written, this would not fit a document (8.2 MB).
      expect(firestoreDocBytes({op: "bulk_import", payload: s}))
        .toBeGreaterThan(8_000_000);
      const body = await call("storymap_bulk_import", {structure: s});
      expectRefusedBySize(body);
      expect(body.message).toContain("repeat a themeId and backboneId");
    });

  test("its ASCII worst case is refused too, though no theme is alone",
    async () => {
      const s = structure(A1, 1000);
      // Control: 2.8 MB in all, but each theme is under the limit, so a
      // guard that measured less than the whole import would let it through.
      expect(firestoreDocBytes({op: "bulk_import", payload: s}))
        .toBeGreaterThan(2_700_000);
      expect(opBytes("bulk_import", {themes: [s.themes[0]]}))
        .toBeLessThan(BULK_BYTE_LIMIT);
      const body = await call("storymap_bulk_import", {structure: s});
      expectRefusedBySize(body);
      expect(body.message).toContain("Split it into at least 4 calls");
    });

  test("a full 500-rib map with a sentence or two per field is written",
    async () => {
      const s = structure(A1, 100);
      const body = await call("storymap_bulk_import", {structure: s});
      expect(body.status).toBe("success");
      expect(body.ribCount).toBe(500);
      const op = writtenOps()[0];
      expect(op.payload).toStrictEqual(s);
      expect(opBytes(op.op, op.payload)).toBeLessThan(BULK_BYTE_LIMIT);
    });
});

type JsonSchema = {
  type?: string;
  format?: string;
  enum?: string[];
  anyOf?: JsonSchema[];
  $ref?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  maxItems?: number;
  maxLength?: number;
  maximum?: number;
};

/**
 * The largest legal value for a JSON Schema: every property present, every
 * array at maxItems, every string at maxLength in three-byte text, the
 * longest enum member. Throws on an unbounded string or array, which no
 * size test could model.
 * @param {JsonSchema} s The schema.
 * @param {JsonSchema} root The tool's whole input schema, for $ref.
 * @param {string} path Where we are, for the error.
 * @return {unknown} The value.
 */
function largest(s: JsonSchema, root: JsonSchema, path: string): unknown {
  if (s.$ref) {
    const target = s.$ref.replace(/^#\//, "").split("/")
      .reduce((n: unknown, k) => (n as Record<string, unknown>)[k], root);
    return largest(target as JsonSchema, root, path);
  }
  if (s.anyOf) {
    const branch = s.anyOf.find((b) => b.type !== "null") as JsonSchema;
    return largest(branch, root, path);
  }
  if (s.enum) return [...s.enum].sort((a, b) => b.length - a.length)[0];
  if (s.type === "object") {
    return Object.fromEntries(Object.entries(s.properties ?? {})
      .map(([k, v]) => [k, largest(v, root, `${path}.${k}`)]));
  }
  if (s.type === "array") {
    if (s.maxItems === undefined) throw new Error(`unbounded array: ${path}`);
    return Array.from({length: s.maxItems},
      () => largest(s.items as JsonSchema, root, `${path}[]`));
  }
  if (s.type === "string") {
    if (s.format === "uuid") return SID;
    if (s.maxLength === undefined) throw new Error(`unbounded string: ${path}`);
    return A3(s.maxLength);
  }
  if (s.type === "number" || s.type === "integer") return s.maximum ?? 1e9;
  if (s.type === "boolean") return true;
  throw new Error(`no rule for ${JSON.stringify(s)} at ${path}`);
}

describe("every Story Map tool", () => {
  test("its largest legal call fits one document or is refused by size",
    async () => {
      const {tools} = await client.listTools();
      const refused: string[] = [];
      let wrote = 0;
      for (const tool of tools) {
        // Reads only: it writes no op.
        if (tool.name === "storymap_get_product") continue;
        mockWriteOpBatch.mockClear();
        mockGetSession.mockClear();
        const schema = tool.inputSchema as JsonSchema;
        const args = largest(schema, schema, tool.name) as Payload;
        const body = await call(tool.name, args);
        if (body.error === "payload_too_large") {
          expectRefusedBySize(body);
          refused.push(tool.name);
          continue;
        }
        expect([tool.name, body.status]).toEqual([tool.name, "success"]);
        const ops = writtenOps();
        expect([tool.name, ops.length > 0]).toEqual([tool.name, true]);
        for (const op of ops) {
          expect([tool.name, firestoreDocBytes(op) < MIB])
            .toEqual([tool.name, true]);
          wrote++;
        }
      }
      // Must-find: the sweep sees the two tools whose caps admit an
      // oversized call, and every other tool really wrote.
      expect(refused.sort())
        .toEqual(["storymap_bulk_import", "storymap_bulk_update_ribs"]);
      expect(wrote).toBe(tools.length - 1 - refused.length);
    });
});
