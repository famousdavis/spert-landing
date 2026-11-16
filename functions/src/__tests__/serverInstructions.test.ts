// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

// MCP 1.19.0 (landing 2.13.1): mcpSpertSuite answers `initialize` with
// `instructions` that point an AI assistant to each connected app's guides in
// the SPERT® Suite Help Center. This drives the PRODUCTION handler over HTTP
// with a real initialize request, the way a client connects, so it proves what
// a client receives, not what a constant says.
//
// The addresses are compared as LITERALS, never imported: they are the slugs
// in the landing page's src/data/help.ts, and a wrong slug written into the
// server must turn this red.

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
import {LATEST_PROTOCOL_VERSION} from "@modelcontextprotocol/sdk/types.js";
import {mcpSpertSuite} from "../mcp/index";

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
 * POST one initialize request to the production handler; return its result.
 * @return {Promise<Record<string, unknown>>} The JSON-RPC result.
 */
function initialize(): Promise<Record<string, unknown>> {
  const data = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {name: "instructions-test", version: "0"},
    },
  });
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

describe("mcpSpertSuite initialize: Help Center instructions", () => {
  it("reports server version 1.19.0", async () => {
    const result = await initialize();
    expect(result.serverInfo).toEqual({name: "spert-suite", version: "1.19.0"});
  });

  it("points each connected app to its own Help Center page", async () => {
    const {instructions} = await initialize();
    expect(typeof instructions).toBe("string");
    for (const url of [
      "https://spertsuite.com/help/storymap",
      "https://spertsuite.com/help/scheduler",
      "https://spertsuite.com/help/forecaster",
    ]) {
      expect(instructions).toContain(url);
    }
  });

  it("names the hub, and no Help Center address it doesn't mean", async () => {
    const {instructions} = await initialize();
    const urls = String(instructions).match(/https:\/\/\S+/g) ?? [];
    // Trailing punctuation belongs to the sentence, not the address.
    const addresses = urls.map((u) => u.replace(/[.,]+$/, "")).sort();
    expect(addresses).toEqual([
      "https://spertsuite.com/help",
      "https://spertsuite.com/help/forecaster",
      "https://spertsuite.com/help/scheduler",
      "https://spertsuite.com/help/storymap",
    ]);
  });
});
