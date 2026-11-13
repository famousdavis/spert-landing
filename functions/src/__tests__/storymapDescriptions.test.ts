// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

// Theme and backbone descriptions (Story Map v0.54.0, MCP 1.17.0). Calls go
// through the real McpServer and Client, so every payload below is the Zod
// OUTPUT the handler writes: zod 3 strips a key its schema does not list,
// which is how a theme description could vanish from storymap_bulk_import.
// Payloads are captured by mocking writeOpBatch and compared with
// toStrictEqual or `in`, never toEqual: toEqual ignores a key whose value is
// undefined, and an undefined value is exactly what makes the Admin SDK refuse
// the write (the functions set no ignoreUndefinedProperties).

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

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import {z} from "zod";
import type {DocumentData} from "firebase-admin/firestore";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {getSession, writeOpBatch, isBrowserConnected} from "../mcp/session";
import {checkSessionWriteLimit} from "../mcp/rateLimit";
import {
  registerStorymapTools,
  bulkUpdateBackbonesShape,
  BULK_UPDATE_BACKBONES_MAX,
} from "../mcp/tools/storymap";
import {registerSharedSessionTools} from "../mcp/tools/shared";
import {registerSchedulerTools} from "../mcp/tools/scheduler";
import {registerForecasterTools} from "../mcp/tools/forecaster";

const mockGetSession =
  getSession as jest.MockedFunction<typeof getSession>;
const mockWriteOpBatch =
  writeOpBatch as jest.MockedFunction<typeof writeOpBatch>;
const mockIsBrowserConnected =
  isBrowserConnected as jest.MockedFunction<typeof isBrowserConnected>;
const mockCheckSessionWriteLimit =
  checkSessionWriteLimit as jest.MockedFunction<typeof checkSessionWriteLimit>;

const SID = "00000000-0000-4000-8000-0000000000d1";

type Payload = Record<string, unknown>;
type Theme = Record<string, unknown>;

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
 * Call a tool through the real SDK, so its Zod shape parses the arguments.
 * @param {string} name Tool name.
 * @param {Payload} args Arguments other than sessionId.
 * @return {Promise<object>} The raw tool result.
 */
async function callRaw(
  name: string,
  args: Payload,
): Promise<{isError?: boolean; content: Array<{text: string}>}> {
  return await client.callTool({
    name,
    arguments: {sessionId: SID, ...args},
  }) as {isError?: boolean; content: Array<{text: string}>};
}

/**
 * Call a tool and parse its success envelope.
 * @param {string} name Tool name.
 * @param {Payload} args Arguments other than sessionId.
 * @return {Promise<Payload>} The parsed body.
 */
async function call(name: string, args: Payload): Promise<Payload> {
  const res = await callRaw(name, args);
  expect(res.isError).not.toBe(true);
  return JSON.parse(res.content[0].text);
}

/**
 * The one op the call wrote, checked for its name.
 * @param {string} op Expected op name.
 * @return {Payload} Its payload, exactly as handed to writeOpBatch.
 */
function onlyPayload(op: string): Payload {
  expect(mockWriteOpBatch).toHaveBeenCalledTimes(1);
  const ops = mockWriteOpBatch.mock.calls[0][2];
  expect(ops).toHaveLength(1);
  expect(ops[0].op).toBe(op);
  return ops[0].payload as Payload;
}

describe("storymap_create_theme and storymap_update_theme payloads", () => {
  test("create_theme without a description writes no description key",
    async () => {
      const body = await call("storymap_create_theme",
        {themeId: "t1", name: "Checkout"});
      expect(body.status).toBe("success");
      const payload = onlyPayload("create_theme");
      expect("description" in payload).toBe(false);
      expect(payload).toStrictEqual({themeId: "t1", name: "Checkout"});
    });

  test("create_theme with a description writes it", async () => {
    await call("storymap_create_theme",
      {themeId: "t1", name: "Checkout", description: "Paying for an order"});
    expect(onlyPayload("create_theme")).toStrictEqual(
      {themeId: "t1", name: "Checkout", description: "Paying for an order"});
  });

  test("update_theme with only a name writes no description key",
    async () => {
      const body = await call("storymap_update_theme",
        {themeId: "t1", name: "Payments"});
      expect(body.status).toBe("success");
      const payload = onlyPayload("update_theme");
      expect("description" in payload).toBe(false);
      expect(payload).toStrictEqual({themeId: "t1", name: "Payments"});
    });

  test("update_theme with only a description writes no name key",
    async () => {
      await call("storymap_update_theme",
        {themeId: "t1", description: "Card and wallet"});
      const payload = onlyPayload("update_theme");
      expect("name" in payload).toBe(false);
      expect(payload).toStrictEqual(
        {themeId: "t1", description: "Card and wallet"});
    });

  test("update_theme with both writes both", async () => {
    await call("storymap_update_theme",
      {themeId: "t1", name: "Payments", description: "Card and wallet"});
    expect(onlyPayload("update_theme")).toStrictEqual(
      {themeId: "t1", name: "Payments", description: "Card and wallet"});
  });

  test("update_theme with an empty description writes it, to clear it",
    async () => {
      await call("storymap_update_theme", {themeId: "t1", description: ""});
      expect(onlyPayload("update_theme")).toStrictEqual(
        {themeId: "t1", description: ""});
    });

  test("update_theme with neither field writes no op and returns success",
    async () => {
      const body = await call("storymap_update_theme", {themeId: "t1"});
      expect(body.status).toBe("success");
      expect(body.message).toBe("No fields to update; nothing written.");
      expect(mockWriteOpBatch).not.toHaveBeenCalled();
      // Nothing written, so no rate-limit token spent either.
      expect(mockCheckSessionWriteLimit).not.toHaveBeenCalled();
    });
});

describe("storymap_bulk_import payload", () => {
  const rib = {ribId: "r1", name: "Card", category: "core"};

  test("a theme's and a backbone's description survive into the payload",
    async () => {
      const structure = {themes: [{
        themeId: "t1",
        name: "Checkout",
        description: "Paying for an order",
        backbones: [{
          backboneId: "b1",
          name: "Pay",
          description: "Card and wallet",
          ribs: [rib],
        }],
      }]};
      await call("storymap_bulk_import", {structure});
      const payload = onlyPayload("bulk_import");
      const theme = (payload.themes as Theme[])[0];
      expect(theme.description).toBe("Paying for an order");
      expect(payload).toStrictEqual(structure);
    });

  test("a theme with no description stays without the key", async () => {
    await call("storymap_bulk_import", {structure: {themes: [{
      themeId: "t1",
      name: "Checkout",
      backbones: [],
    }]}});
    const theme = (onlyPayload("bulk_import").themes as Theme[])[0];
    expect("description" in theme).toBe(false);
  });
});

describe("storymap_bulk_update_backbones payload", () => {
  test("writes its updates verbatim, as one op", async () => {
    const updates = [
      {backboneId: "b1", description: "Card and wallet"},
      {backboneId: "b2", description: ""},
    ];
    const body = await call("storymap_bulk_update_backbones", {updates});
    expect(body.status).toBe("success");
    expect(body.count).toBe(2);
    expect(mockWriteOpBatch).toHaveBeenCalledTimes(1);
    expect(mockWriteOpBatch.mock.calls[0][2]).toStrictEqual(
      [{op: "bulk_update_backbones", payload: {updates}}]);
  });

  test("a name in an entry is not written: the tool sets descriptions only",
    async () => {
      await call("storymap_bulk_update_backbones", {updates: [
        {backboneId: "b1", name: "Pay", description: "Card and wallet"},
      ]});
      expect(onlyPayload("bulk_update_backbones")).toStrictEqual(
        {updates: [{backboneId: "b1", description: "Card and wallet"}]});
    });
});

describe("a description is at most 2000 characters, on every tool", () => {
  const cases: Array<[string, string, (d: string) => Payload]> = [
    ["storymap_create_theme", "create_theme",
      (d) => ({themeId: "t1", name: "T", description: d})],
    ["storymap_update_theme", "update_theme",
      (d) => ({themeId: "t1", description: d})],
    ["storymap_bulk_import", "bulk_import",
      (d) => ({structure: {themes: [
        {themeId: "t1", name: "T", description: d, backbones: []},
      ]}})],
    ["storymap_bulk_update_backbones", "bulk_update_backbones",
      (d) => ({updates: [{backboneId: "b1", description: d}]})],
  ];

  test.each(cases)("%s takes 2000 and refuses 2001, writing nothing",
    async (tool, op, args) => {
      await call(tool, args("x".repeat(2000)));
      onlyPayload(op);
      mockWriteOpBatch.mockClear();
      const res = await callRaw(tool, args("x".repeat(2001)));
      expect(res.isError).toBe(true);
      expect(mockWriteOpBatch).not.toHaveBeenCalled();
    });
});

describe("storymap_bulk_update_backbones cap", () => {
  const shape = z.object(bulkUpdateBackbonesShape);
  // U+3042: one UTF-16 unit (what .max() counts), three UTF-8 bytes.
  const ID = "あ".repeat(100);
  const DESCRIPTION = "あ".repeat(2000);
  const entries = (n: number) =>
    Array.from({length: n}, () => ({backboneId: ID, description: DESCRIPTION}));

  test("accepts MAX entries at maximum field sizes, refuses MAX + 1 or none",
    () => {
      const max = BULK_UPDATE_BACKBONES_MAX;
      expect(shape.safeParse({sessionId: SID, updates: entries(max)}).success)
        .toBe(true);
      expect(shape.safeParse({sessionId: SID, updates: entries(max + 1)})
        .success).toBe(false);
      expect(shape.safeParse({sessionId: SID, updates: []}).success)
        .toBe(false);
    });

  test("the MAX-entry op fits one Firestore document (1 MiB)", async () => {
    // Control: the fixture really is maximum-length, three-byte text.
    expect(ID).toHaveLength(100);
    expect(Buffer.byteLength(ID, "utf8")).toBe(300);
    expect(Buffer.byteLength(DESCRIPTION, "utf8")).toBe(6000);
    await call("storymap_bulk_update_backbones",
      {updates: entries(BULK_UPDATE_BACKBONES_MAX)});
    const ops = mockWriteOpBatch.mock.calls[0][2];
    const bytes = Buffer.byteLength(JSON.stringify(ops[0]), "utf8");
    expect(bytes).toBeGreaterThan(BULK_UPDATE_BACKBONES_MAX * 6300);
    expect(bytes).toBeLessThan(1024 * 1024);
  });

  test("an entry needs a backboneId and a description; \"\" is a description",
    () => {
      const one = (e: unknown) =>
        shape.safeParse({sessionId: SID, updates: [e]});
      expect(one({backboneId: "b1", description: ""}).success).toBe(true);
      expect(one({backboneId: "b1"}).success).toBe(false);
      expect(one({description: "Card and wallet"}).success).toBe(false);
      expect(one({backboneId: "", description: "x"}).success).toBe(false);
      expect(one({backboneId: "b".repeat(101), description: "x"}).success)
        .toBe(false);
    });
});

/**
 * Every Story Map tool's description, whitespace collapsed.
 * @return {Record<string, string>} Descriptions by tool name.
 */
function descriptionsByTool(): Record<string, string> {
  const descriptions: Record<string, string> = {};
  const fakeServer = {
    tool: (...toolArgs: unknown[]) => {
      descriptions[toolArgs[0] as string] =
        (toolArgs[1] as string).replace(/\s+/g, " ");
    },
  };
  registerStorymapTools(
    fakeServer as unknown as Parameters<typeof registerStorymapTools>[0],
    {} as never,
  );
  return descriptions;
}

describe("what the tool descriptions tell an AI", () => {
  const descriptions = descriptionsByTool();

  // D13: the three meanings of the snapshot marker.
  const MARKER = [
    "storymap_get_product (Read Mode required) returns " +
      "themeBackboneDescriptionsIncluded with the product.",
    "- true: every theme and backbone carries its description.",
    "- false: descriptions exist but were left out of the snapshot for " +
      "size. This is not a stale tab. Do not write a theme or backbone " +
      "description unless the user explicitly asked",
    "there is no append tool to fall back on.",
    "- absent: the user's Story Map tab is older than 0.54.0. It does not " +
      "apply theme descriptions or storymap_bulk_update_backbones, although " +
      "each call reports success. Ask the user to reload the Story Map tab " +
      "and reconnect Connect AI, then send the descriptions again with " +
      "storymap_update_theme, storymap_update_backbone or " +
      "storymap_bulk_update_backbones: create and import do not re-apply to " +
      "an id that already exists.",
  ];
  const REPLACES = "This replaces the description; read it with " +
    "storymap_get_product first and do not overwrite a non-empty one unless " +
    "the user asked.";

  test.each([
    "storymap_get_product",
    "storymap_create_theme",
    "storymap_create_backbone",
    "storymap_update_theme",
    "storymap_update_backbone",
    "storymap_bulk_import",
    "storymap_bulk_update_backbones",
  ])("%s states the three meanings of themeBackboneDescriptionsIncluded",
    (tool) => {
      for (const sentence of MARKER) {
        expect([tool, descriptions[tool]]).toEqual(
          [tool, expect.stringContaining(sentence)]);
      }
    });

  test.each([
    "storymap_update_theme",
    "storymap_update_backbone",
    "storymap_bulk_update_backbones",
  ])("%s says a description is replaced, and to read it first", (tool) => {
    expect(descriptions[tool]).toContain(REPLACES);
  });

  test.each([
    ["storymap_create_theme",
      "A themeId that already exists is left as it is, description " +
        "included; to change an existing theme's description, use " +
        "storymap_update_theme."],
    ["storymap_create_backbone",
      "A backboneId that already exists in the theme is left as it is, " +
        "description included; to change an existing backbone's " +
        "description, use storymap_update_backbone or " +
        "storymap_bulk_update_backbones."],
    ["storymap_bulk_import",
      "A theme or backbone whose id already exists is left as it is, " +
        "description included; to change an existing description, use " +
        "storymap_update_theme, storymap_update_backbone or " +
        "storymap_bulk_update_backbones."],
  ])("%s says a create leaves an existing description alone",
    (tool, sentence) => {
      expect(descriptions[tool]).toContain(sentence);
    });

  test("storymap_update_backbone states the id fallback", () => {
    expect(descriptions["storymap_update_backbone"]).toContain(
      "ID FALLBACK: if themeId does not hold backboneId (the backbone was " +
      "moved to another theme, or your themeId is stale), every backbone " +
      "with that backboneId, in any theme, is updated. When themeId does " +
      "hold it, only that backbone is updated.");
  });

  test("storymap_bulk_import names theme and backbone descriptions", () => {
    expect(descriptions["storymap_bulk_import"]).toContain(
      "Per theme and per backbone you may set a description; per rib you " +
      "may set description, category (\"core\" | \"non-core\"), and notes.");
  });

  test("storymap_update_theme updates a description, not only the name",
    () => {
      const words = descriptions["storymap_update_theme"];
      expect(words).toContain(
        "Update an existing theme's name and/or description. Both fields " +
        "are optional");
      expect(words).toContain("Calling with no updateable fields returns " +
        "success without writing an op.");
      expect(words).not.toContain("Only name is updatable");
    });

  test("storymap_bulk_update_backbones states its matching rule, its cap " +
    "and the Copilot route", () => {
    const words = descriptions["storymap_bulk_update_backbones"];
    expect(words).toContain("Each entry is matched by backboneId alone, " +
      "across every theme: every backbone holding that id is updated.");
    expect(words).toContain("Max 100 entries per call");
    expect(words).toContain("if you are Copilot, use " +
      "storymap_update_backbone for each backbone instead.");
  });
});

/**
 * Every string literal and template part in a source file, whitespace
 * collapsed, read with the TypeScript parser. Comments and identifiers are
 * left out: they are not text an AI reads.
 * @param {string} file Path.
 * @return {string[]} Texts.
 */
function sourceTexts(file: string): string[] {
  const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) || ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)) {
      out.push(n.text.replace(/\s+/g, " "));
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

// Story Map calls the user's work a product (landing v2.12.0). "\b" does not
// match inside storymap_get_product or scheduler_get_project ("_" is a word
// character), so a tool name never counts as the word.
const WORDS = /\bprojects?\b|product owner/gi;

describe("Story Map's AI text calls the work a product", () => {
  test("no Story Map tool description says \"project\" or " +
    "\"product owner\"", () => {
    const descriptions = descriptionsByTool();
    expect(Object.keys(descriptions)).toHaveLength(22);
    const left: string[] = [];
    for (const [tool, text] of Object.entries(descriptions)) {
      for (const m of text.match(WORDS) ?? []) left.push(`${tool}: ${m}`);
    }
    expect(left).toEqual([]);
  });

  test("no string in storymap.ts says \"project\" or \"product owner\"",
    () => {
      const texts = sourceTexts(
        path.join(__dirname, "../mcp/tools/storymap.ts"));
      // Must-find control: a returned message the scan has to see, present
      // before and after this change, so an empty or wrong read cannot pass.
      expect(texts).toContain("Temporary error; retry.");
      const left: string[] = [];
      for (const text of texts) {
        for (const m of text.match(WORDS) ?? []) {
          left.push(`${m}: ${text.slice(0, 70)}`);
        }
      }
      expect(left).toEqual([]);
    });
});

// A tool name an AI is told to call. "\b" does not match after "spert" in
// "spertstorymap", and "_" is a word character, so a name stays in one piece.
const TOOL_NAME = /\b(?:storymap|scheduler|forecaster)_[a-z_]+/g;

/**
 * Each tool the four registrars register, with its rendered description,
 * whitespace collapsed.
 * @return {Map<string, string>} Descriptions by tool name.
 */
function registeredTools(): Map<string, string> {
  const tools = new Map<string, string>();
  const fakeServer = {
    tool: (...toolArgs: unknown[]) => {
      tools.set(toolArgs[0] as string,
        (toolArgs[1] as string).replace(/\s+/g, " "));
    },
  } as never;
  registerSharedSessionTools(fakeServer, {} as never);
  registerStorymapTools(fakeServer, {} as never);
  registerSchedulerTools(fakeServer, {} as never);
  registerForecasterTools(fakeServer, {} as never);
  return tools;
}

describe("a tool name in AI text is a registered tool", () => {
  const tools = registeredTools();
  const found = (texts: Iterable<string>): string[] =>
    [...texts].flatMap((text) => text.match(TOOL_NAME) ?? []);
  const unregistered = (texts: Iterable<string>): string[] =>
    found(texts).filter((name) => !tools.has(name));
  const strings = (file: string): string[] =>
    sourceTexts(path.join(__dirname, "../mcp/tools", file));

  test("control: the scan finds names, and reports one that is misspelt",
    () => {
      expect(found(tools.values())).toEqual(expect.arrayContaining([
        "storymap_get_product",
        "scheduler_get_project",
        "forecaster_get_project",
      ]));
      expect(unregistered(["Read it with storymap_get_prodcut first."]))
        .toEqual(["storymap_get_prodcut"]);
    });

  test("in the tool descriptions", () => {
    expect(unregistered(tools.values())).toEqual([]);
  });

  test.each(["storymap.ts", "shared.ts"])("in the strings of %s", (file) => {
    const texts = strings(file);
    // Must-find control: the read tool's name is among this file's strings,
    // so an empty or wrong read cannot pass.
    expect(found(texts)).toContain("storymap_get_product");
    expect(unregistered(texts)).toEqual([]);
  });
});
