// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

// MCP 1.19.2 (landing 2.15.5): a browser that opens https://mcp.spertsuite.com
// gets a help page, not the raw 405 meant for MCP clients. William clicked the
// address in a Connect AI guide on 2026-11-28 and got
// {"error":"Method not allowed"}.
//
// Drives the PRODUCTION handler with the Accept headers real callers send.
// The control is the point: every non-browser request must get exactly what it
// got before (405 for GET, server setup for POST). getFirestore is the
// handler's first step after its early checks, so a sentinel thrown from it
// proves a request went on to the MCP server rather than getting the page.

const SENTINEL = "reached MCP server setup";

jest.mock("firebase-functions/v2/https", () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
}));
jest.mock("firebase-admin/app", () => ({
  getApps: () => [{}],
  initializeApp: jest.fn(),
}));
jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => {
    throw new Error(SENTINEL);
  }),
}));
jest.mock("../mcp/rateLimit", () => ({
  checkIpRateLimit: jest.fn(() => true),
}));

import {getFirestore} from "firebase-admin/firestore";
import {mcpSpertSuite} from "../mcp/index";
import {BROWSER_PAGE_HTML} from "../mcp/browserPage";

type Res = {
  status: jest.Mock;
  json: jest.Mock;
  set: jest.Mock;
  send: jest.Mock;
};

/**
 * A minimal Express-shaped response that records what the handler sent.
 * @return {Res} The fake response.
 */
function makeRes(): Res {
  const res = {} as Res;
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.set = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

/**
 * Invoke the handler.
 * @param {string} method The HTTP method.
 * @param {string | undefined} accept The Accept header, or none.
 * @return {Promise<Res>} The fake response after the handler ran.
 */
async function call(method: string, accept?: string): Promise<Res> {
  const res = makeRes();
  const headers: Record<string, string> = {"x-forwarded-for": "203.0.113.7"};
  if (accept !== undefined) headers.accept = accept;
  const req = {
    method,
    headers,
    socket: {remoteAddress: "203.0.113.7"},
    body: {jsonrpc: "2.0", id: 1, method: "ping"},
  };
  await (mcpSpertSuite as unknown as
    (q: unknown, s: unknown) => Promise<void>)(req, res);
  return res;
}

// Accept headers as browsers send them for a top-level navigation.
const CHROME =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif," +
  "image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
const SAFARI = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const FIREFOX =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

beforeEach(() => {
  (getFirestore as jest.Mock).mockClear();
});

/**
 * The page's visible text: tags dropped, entities decoded, spaces collapsed.
 * @param {string} html The page.
 * @return {string} What a reader sees, in order.
 */
function visibleText(html: string): string {
  const body = html.slice(html.indexOf("<body>"));
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&#174;/g, "®")
    .replace(/&#8217;/g, "’")
    .replace(/\s+/g, " ")
    .replace(/ ([.,®])/g, "$1")
    .trim();
}

describe("mcpSpertSuite: a browser visit gets the help page", () => {
  it.each([["Chrome", CHROME], ["Safari", SAFARI], ["Firefox", FIREFOX]])(
    "%s navigation: 200, the page, and no MCP server setup",
    async (_name, accept) => {
      const res = await call("GET", accept);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(BROWSER_PAGE_HTML);
      const headers = res.set.mock.calls[0][0] as Record<string, string>;
      expect(headers["Content-Type"]).toBe("text/html; charset=utf-8");
      expect(headers["Content-Security-Policy"]).toContain("default-src 'none'");
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(res.json).not.toHaveBeenCalled();
      expect(getFirestore).not.toHaveBeenCalled();
    },
  );
});

describe("control: every other caller gets what it got before", () => {
  it.each([
    ["an MCP client opening the SSE stream", "text/event-stream"],
    ["an MCP client's usual Accept", "application/json, text/event-stream"],
    ["HTML and SSE together", "text/html, text/event-stream"],
    ["curl's default", "*/*"],
    ["JSON only", "application/json"],
    ["no Accept header", undefined],
  ])("GET from %s: 405, as before", async (_name, accept) => {
    const res = await call("GET", accept);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({error: "Method not allowed"});
    expect(res.send).not.toHaveBeenCalled();
  });

  it("HEAD that asks for HTML: 405, as before", async () => {
    const res = await call("HEAD", CHROME);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("POST that asks for HTML still goes to the MCP server", async () => {
    await expect(call("POST", CHROME)).rejects.toThrow(SENTINEL);
    expect(getFirestore).toHaveBeenCalledTimes(1);
  });
});

describe("the page itself", () => {
  // The words William approves, as a reader sees them. A change to the page's
  // text must change this literal on purpose.
  const WORDS =
    "SPERT® Suite MCP server " +
    "This address is for your AI assistant, not your browser. Add " +
    "https://mcp.spertsuite.com to your assistant, and it can work with " +
    "SPERT® Story Map, SPERT® Scheduler and SPERT® Forecaster through " +
    "Connect AI. " +
    "The steps for each assistant are on the Help Center’s Connect AI " +
    "setup page.";

  it("says exactly the approved words", () => {
    expect(visibleText(BROWSER_PAGE_HTML)).toBe(WORDS);
  });

  it("links only to the Connect AI setup page", () => {
    const hrefs = [...BROWSER_PAGE_HTML.matchAll(/href="([^"]*)"/g)]
      .map((m) => m[1]);
    expect(hrefs).toEqual(["https://spertsuite.com/help/connect-ai"]);
  });

  it("shows the address as code, not as a link", () => {
    expect(BROWSER_PAGE_HTML)
      .toContain("<code>https://mcp.spertsuite.com</code>");
    expect(BROWSER_PAGE_HTML).not.toMatch(/href="https:\/\/mcp\./);
  });

  it("loads nothing: no script, no outside stylesheet, image or font", () => {
    expect(BROWSER_PAGE_HTML).not.toMatch(/<script|<link|<img|src=|@import|url\(/i);
  });

  it("keeps every ® in the body small and raised", () => {
    const body = BROWSER_PAGE_HTML.slice(BROWSER_PAGE_HTML.indexOf("<body>"));
    const marks = body.match(/&#174;/g) ?? [];
    const raised = body.match(/<span class="m">&#174;<\/span>/g) ?? [];
    expect(marks.length).toBe(4);
    expect(raised.length).toBe(marks.length);
  });
});
