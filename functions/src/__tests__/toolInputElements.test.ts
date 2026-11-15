// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

// MCP 1.18.1: mcpSpertSuite caps a tool call's arguments at
// MAX_TOOL_INPUT_ELEMENTS. SDK 1.32.0's McpServer option maxToolInputElements
// counts, before zod runs, every own key of every object and every element of
// every array in the arguments, at every depth, starting with the arguments
// object itself; it refuses a count above the cap, and is off unless set.
//
// (a) Every tool's largest legal call, built from its published input schema,
//     is within the cap. The tool set is read from the production handler.
// Cross-check: for every tool, a server built with the cap at exactly that
//     count accepts the call (past the cap and zod) and one built a step lower
//     refuses it, so the counter here equals the SDK's and (a) is not checking
//     a number against itself.
// (b) Through the production handler over HTTP, a call one element over the
//     cap is refused by the cap even though zod would also reject it (so the
//     cap runs first), and a call of exactly the cap is not.

jest.mock("firebase-functions/v2/https", () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
}));
jest.mock("firebase-admin/app", () => ({
  getApps: () => [{}],
  initializeApp: jest.fn(),
}));
jest.mock("firebase-admin/firestore", () => ({
  ...jest.requireActual("firebase-admin/firestore"),
  getFirestore: jest.fn(() => ({})),
}));
jest.mock("../mcp/session", () => ({
  getSession: jest.fn(),
  touchSession: jest.fn(),
  writeOpBatch: jest.fn(),
  isBrowserConnected: jest.fn(),
}));
jest.mock("../mcp/rateLimit", () => ({
  checkIpRateLimit: jest.fn(() => true),
  checkSessionWriteLimit: jest.fn(() => true),
}));
jest.mock("firebase-functions/logger", () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  log: jest.fn(),
  debug: jest.fn(),
}));

import * as http from "node:http";
import type {AddressInfo} from "node:net";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {mcpSpertSuite} from "../mcp/index";
import {
  registerSharedSessionTools,
  MAX_TOOL_INPUT_ELEMENTS,
} from "../mcp/tools/shared";
import {registerStorymapTools} from "../mcp/tools/storymap";
import {registerSchedulerTools} from "../mcp/tools/scheduler";
import {registerForecasterTools} from "../mcp/tools/forecaster";

const N = MAX_TOOL_INPUT_ELEMENTS;
const CAP_MESSAGE = "arguments contain more than the maximum";
const ZOD_MESSAGE = "Input validation error";

type JsonSchema = {
  type?: string | string[];
  format?: string;
  pattern?: string;
  enum?: string[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  maxItems?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
};

type Tool = {name: string; inputSchema: JsonSchema};
type Args = Record<string, unknown>;

/**
 * SDK 1.32.0's count (toolInputElementCount in server/mcp.js), without its
 * early exit: one per own key of an object, one per array element, at every
 * depth.
 * @param {unknown} value The arguments.
 * @return {number} The element count.
 */
function elementCount(value: unknown): number {
  let n = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    const children = Array.isArray(node) ? node :
      Object.keys(node).map((k) => (node as Record<string, unknown>)[k]);
    for (const child of children) {
      n++;
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }
  return n;
}

let uuids = 0;
const uuid = (): string =>
  `00000000-0000-4000-8000-${String(++uuids).padStart(12, "0")}`;

// The two string patterns the tools publish, and a legal value for each.
const PATTERN_VALUES: Record<string, string> = {
  "^[A-Za-z]+-\\d{10}$": "CRANE-0123456789",
  "^\\d{4}-\\d{2}-\\d{2}$": "2026-01-01",
};

/**
 * The legal call with the most elements: every property present, every array
 * at maxItems, the branch of a union with the most elements. Throws on any
 * array without maxItems, any object that admits keys it does not list, and
 * any value with no type, because each of those makes the count unbounded.
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
  const union = s.anyOf ?? s.oneOf;
  if (union) {
    return union.map((b) => largest(b, root, path))
      .reduce((a, b) => (elementCount([b]) > elementCount([a]) ? b : a));
  }
  if (s.allOf) throw new Error(`allOf: ${path}`);
  if (s.enum) return s.enum[0];
  const type = Array.isArray(s.type) ?
    s.type.find((t) => t !== "null") : s.type;
  if (type === "object") {
    if (s.additionalProperties !== false) {
      throw new Error(`open object: ${path}`);
    }
    return Object.fromEntries(Object.entries(s.properties ?? {})
      .map(([k, v]) => [k, largest(v, root, `${path}.${k}`)]));
  }
  if (type === "array") {
    if (s.maxItems === undefined) throw new Error(`unbounded array: ${path}`);
    return Array.from({length: s.maxItems},
      () => largest(s.items as JsonSchema, root, `${path}[]`));
  }
  if (type === "string") {
    if (s.format === "uuid") return uuid();
    if (s.pattern !== undefined) {
      const v = PATTERN_VALUES[s.pattern];
      if (v === undefined) throw new Error(`unknown pattern: ${path}`);
      return v;
    }
    return "a".repeat(Math.max(s.minLength ?? 1, 1));
  }
  if (type === "number" || type === "integer") {
    return Math.min(Math.max(0, s.minimum ?? 0), s.maximum ?? 0);
  }
  if (type === "boolean") return true;
  if (type === "null") return null;
  throw new Error(`no type: ${path}`);
}

// ── The production handler, served over real HTTP ───────────────────────────
// The SDK's transport writes to a real ServerResponse, so the handler runs
// behind a node:http server with the few Express helpers index.ts uses.

let httpServer: http.Server;
let port: number;

beforeAll(async () => {
  httpServer = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const ex = Object.assign(req, {body: raw ? JSON.parse(raw) : undefined});
      const out = Object.assign(res, {
        status: (c: number) => {
          res.statusCode = c;
          return out;
        },
        json: (o: unknown) => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(o));
          return out;
        },
        set: (k: string, v: string) => {
          res.setHeader(k, v);
          return out;
        },
      });
      (mcpSpertSuite as unknown as
        (q: unknown, s: unknown) => Promise<void>)(ex, out);
    });
  });
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
  port = (httpServer.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => httpServer.close(r));
});

/**
 * POST one JSON-RPC request to the production handler and return its result.
 * @param {string} method JSON-RPC method.
 * @param {object} params JSON-RPC params.
 * @return {Promise<Record<string, unknown>>} The JSON-RPC result.
 */
function rpc(method: string, params: object):
  Promise<Record<string, unknown>> {
  const data = JSON.stringify({jsonrpc: "2.0", id: 1, method, params});
  return new Promise((resolve, reject) => {
    const r = http.request({port, host: "127.0.0.1", method: "POST",
      path: "/", headers: {"content-type": "application/json",
        "accept": "application/json, text/event-stream",
        "content-length": Buffer.byteLength(data)}}, (res) => {
      let out = "";
      res.on("data", (c) => (out += c));
      res.on("end", () => {
        const line = out.split("\n").find((l) => l.startsWith("data: "));
        const msg = JSON.parse(line ? line.slice(6) : out);
        if (msg.result === undefined) {
          reject(new Error(`no result: ${out.slice(0, 200)}`));
        } else {
          resolve(msg.result);
        }
      });
    });
    r.on("error", reject);
    r.end(data);
  });
}

/**
 * The text of a tools/call result through the production handler.
 * @param {string} name Tool name.
 * @param {Args} args Arguments.
 * @return {Promise<{isError: boolean, text: string}>} The result.
 */
async function callProduction(name: string, args: Args):
  Promise<{isError: boolean; text: string}> {
  const result = await rpc("tools/call", {name, arguments: args}) as
    {isError?: boolean; content: Array<{text: string}>};
  return {isError: result.isError === true, text: result.content[0].text};
}

/**
 * Every tool the production handler lists.
 * @return {Promise<Tool[]>} The tools.
 */
async function productionTools(): Promise<Tool[]> {
  return (await rpc("tools/list", {})).tools as Tool[];
}

/**
 * A fresh server with every tool and the cap set through the constructor
 * option, as index.ts sets it, connected to a client.
 * @param {number} cap The cap.
 * @return {Promise<Client>} The connected client.
 */
async function clientWithCap(cap: number): Promise<Client> {
  const server = new McpServer({name: "t", version: "0"},
    {maxToolInputElements: cap});
  const db = {} as never;
  registerSharedSessionTools(server, db);
  registerStorymapTools(server, db);
  registerSchedulerTools(server, db);
  registerForecasterTools(server, db);
  const client = new Client({name: "c", version: "0"});
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

/**
 * Call a tool on a client built by clientWithCap, then close it.
 * @param {number} cap The server's cap.
 * @param {string} name Tool name.
 * @param {Args} args Arguments.
 * @return {Promise<{isError: boolean, text: string}>} The result.
 */
async function callWithCap(cap: number, name: string, args: Args):
  Promise<{isError: boolean; text: string}> {
  const client = await clientWithCap(cap);
  try {
    const res = await client.callTool({name, arguments: args}) as
      {isError?: boolean; content: Array<{text: string}>};
    return {isError: res.isError === true, text: res.content[0]?.text ?? ""};
  } finally {
    await client.close();
  }
}

describe("largest() refuses what it cannot bound (must-find controls)", () => {
  test.each([
    ["unbounded array", {type: "array", items: {type: "string"}}],
    ["open object", {type: "object", properties: {}}],
    ["open object", {type: "object", additionalProperties: {type: "string"}}],
    ["no type", {}],
  ])("%s", (message, schema) => {
    expect(() => largest(schema as JsonSchema, schema as JsonSchema, "x"))
      .toThrow(message);
  });
});

describe("every tool's largest legal call", () => {
  let rows: Array<{name: string; args: Args; n: number}>;

  beforeAll(async () => {
    const tools = await productionTools();
    rows = tools.map((t) => {
      const args = largest(t.inputSchema, t.inputSchema, t.name) as Args;
      return {name: t.name, args, n: elementCount(args)};
    });
  });

  test("(a) is within MAX_TOOL_INPUT_ELEMENTS", () => {
    // Must-find: the production handler lists every tool, and the sweep sees
    // the largest one.
    expect(rows).toHaveLength(56);
    expect(Math.max(...rows.map((r) => r.n))).toBeGreaterThan(5_000);
    const over = rows.filter((r) => r.n > N).map((r) => `${r.name}: ${r.n}`);
    expect(over).toEqual([]);
  });

  test("cross-check: the SDK's count equals this one, and the call is legal",
    async () => {
      for (const {name, args, n} of rows) {
        // Capped at exactly n, the call passes the cap AND zod.
        const at = await callWithCap(n, name, args);
        expect([name, at.text.includes(CAP_MESSAGE)]).toEqual([name, false]);
        expect([name, at.text.includes(ZOD_MESSAGE)]).toEqual([name, false]);
        // Capped one lower, the SDK refuses it.
        if (n > 1) {
          const below = await callWithCap(n - 1, name, args);
          expect([name, below.isError, below.text.includes(CAP_MESSAGE)])
            .toEqual([name, true, true]);
        }
      }
    });
});

describe("(b) the production handler applies the cap before zod", () => {
  // resolve_session_code wants {code: string}. Each case gives code an array,
  // so zod rejects both; only the cap can tell them apart. The arguments
  // object's own key counts as one element.
  const codeArray = (elements: number): Args =>
    ({code: Array.from({length: elements - 1}, () => 0)});

  test("one element over the cap is refused by the cap, not by zod",
    async () => {
      const args = codeArray(N + 1);
      expect(elementCount(args)).toBe(N + 1);
      const res = await callProduction("resolve_session_code", args);
      expect(res.isError).toBe(true);
      expect(res.text).toContain(CAP_MESSAGE);
      expect(res.text).toContain(`maximum of ${N} elements`);
      expect(res.text).not.toContain(ZOD_MESSAGE);
    });

  test("exactly the cap is not refused by the cap (zod refuses it instead)",
    async () => {
      const args = codeArray(N);
      expect(elementCount(args)).toBe(N);
      const res = await callProduction("resolve_session_code", args);
      expect(res.isError).toBe(true);
      expect(res.text).toContain(ZOD_MESSAGE);
      expect(res.text).not.toContain(CAP_MESSAGE);
    });
});
