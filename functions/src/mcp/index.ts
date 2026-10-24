// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import {onRequest} from "firebase-functions/v2/https";
import {initializeApp, getApps} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  StreamableHTTPServerTransport,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {registerStorymapTools} from "./tools/storymap";
import {registerSchedulerTools} from "./tools/scheduler";
import {registerForecasterTools} from "./tools/forecaster";
import {registerSharedSessionTools} from "./tools/shared";
import {checkIpRateLimit} from "./rateLimit";

if (getApps().length === 0) initializeApp();

export const mcpSpertSuite = onRequest(
  {region: "us-central1", cors: true},
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({error: "Method not allowed"});
      return;
    }
    // x-forwarded-for may be a string or string[]; take the leftmost IP.
    const fwd = req.headers["x-forwarded-for"];
    const ip =
      (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim() ??
      req.socket.remoteAddress ??
      "unknown";
    if (!checkIpRateLimit(ip)) {
      res.set("Retry-After", "60");
      res.status(429).json({error: "Too many requests"});
      return;
    }
    // AI-1 (2026-10-24 audit): reject JSON-RPC batch arrays. The MCP SDK
    // transport executes every call in a batch, but checkIpRateLimit above
    // counts one HTTP request — so a single POST carrying hundreds of
    // resolve_session_code calls was hundreds of pairing-code guesses for one
    // rate-limit tick. No SPERT client batches; one request per call is the
    // normal MCP shape.
    if (Array.isArray(req.body)) {
      res.status(400).json({error: "Batch requests are not supported"});
      return;
    }
    const db = getFirestore();
    const server = new McpServer({name: "spert-suite", version: "1.14.1"});
    // Shared session tools (resolve_session_code, get_session_info) register
    // exactly once; each app's register*Tools adds only its own tools.
    registerSharedSessionTools(server, db);
    registerStorymapTools(server, db);
    registerSchedulerTools(server, db);
    registerForecasterTools(server, db);
    // Stateless: one fresh McpServer + transport per POST. Validated via
    // emulator POC (tools/call works with no prior initialize; cross-POST
    // session continuity is not required).
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  },
);
