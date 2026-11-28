// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

// MCP 1.19.2 (landing 2.15.5): what a BROWSER gets at https://mcp.spertsuite.com.
//
// The address is printed in the Connect AI guides and on the Help Center so a
// user can paste it into an AI assistant. PDF viewers, mail and chat apps turn
// any https:// text into a link on their own, so people also click it. Until
// 1.19.2 a click returned the raw `405 {"error":"Method not allowed"}` meant for
// MCP clients (William found it on 2026-11-28).
//
// The page goes only to a GET that accepts text/html and does NOT accept
// text/event-stream. An MCP client that opens the SSE stream sends GET with
// `Accept: text/event-stream`, and the MCP Streamable HTTP transport requires
// such a GET to get either a stream or 405. This server keeps answering 405, so
// MCP clients see exactly what they saw before. A GET with no Accept header, or
// `*/*` (curl), also keeps the 405, unchanged. POST is never affected.

/**
 * Whether a request is a browser visit that should get the help page.
 * @param {string} method The HTTP method.
 * @param {string | undefined} accept The request's Accept header.
 * @return {boolean} True only for a GET that asks for HTML and not for SSE.
 */
export function wantsBrowserPage(
  method: string,
  accept: string | undefined,
): boolean {
  if (method !== "GET") return false;
  const a = (accept ?? "").toLowerCase();
  if (a.includes("text/event-stream")) return false;
  return a.includes("text/html");
}

/** Headers sent with the page: no scripts, no outside resources, no framing. */
export const BROWSER_PAGE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; " +
    "form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "public, max-age=300",
};

const MARK = "<span class=\"m\">&#174;</span>";

/**
 * The page. Its words are William's to approve (pinned as literals by
 * mcpBrowserPage.test.ts). ® is small and raised, as everywhere in the suite.
 */
export const BROWSER_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>SPERT&#174; Suite MCP server</title>
<style>
:root{color-scheme:light dark;--fg:#171717;--bg:#ffffff;--code:#f4f4f5;--link:#0062d6}
@media (prefers-color-scheme:dark){:root{--fg:#ededed;--bg:#0a0a0a;--code:#27272a;--link:#6cb2ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
main{max-width:40rem;margin:0 auto;padding:3rem 1rem}
h1{font-size:1.5rem;line-height:1.3;margin:0 0 1rem}
p{margin:0 0 1rem}
code{font:.95em ui-monospace,Menlo,Consolas,monospace;background:var(--code);padding:.1em .35em;border-radius:4px;overflow-wrap:anywhere}
a{color:var(--link)}
.m{font-size:.6em;vertical-align:super;line-height:0}
</style>
</head>
<body>
<main>
<h1>SPERT${MARK} Suite MCP server</h1>
<p>This address is for your AI assistant, not your browser. Add <code>https://mcp.spertsuite.com</code> to your assistant, and it can work with SPERT${MARK} Story Map, SPERT${MARK} Scheduler and SPERT${MARK} Forecaster through Connect AI.</p>
<p>The steps for each assistant are on the Help Center&#8217;s <a href="https://spertsuite.com/help/connect-ai">Connect AI setup page</a>.</p>
</main>
</body>
</html>
`;
