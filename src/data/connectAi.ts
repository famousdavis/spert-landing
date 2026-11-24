// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * The Connect AI setup page (/help/connect-ai, 2.15.0): the one place that says
 * how to add the SPERT Suite MCP server to each AI assistant. The three apps'
 * Connect AI guides each carried their own copy of these steps until then.
 *
 * Guards: G13–G16 in src/guards/help-center.test.ts.
 */

/**
 * The server's address. Every assistant's setup uses it, so it lives here once
 * and the page never spells it out itself (G15). It is the address the apps'
 * Connect AI prompts and guides name, and it carries no /mcp path.
 */
export const MCP_SERVER_URL = 'https://mcp.spertsuite.com';

/** The name we ask people to give the connection, in every assistant. */
export const CONNECTION_NAME = 'SPERT Suite';

/** The page's address. Not an app slug, and never may be (G13). */
export const CONNECT_AI_PATH = '/help/connect-ai';

export interface AssistantSection {
  /**
   * The section's anchor: /help/connect-ai#<id>. A published address, since the
   * apps will link straight to their reader's assistant. Pinned in G14.
   */
  id: string;
  /** The assistant's name, as its maker writes it. */
  name: string;
  /** The company that makes it, for "checked against <maker>'s documentation". */
  maker: string;
  /** What this assistant calls the thing being added. */
  calledThere: string;
  /** Where in the assistant it is added. */
  where: string;
  /**
   * How and when these steps were last checked. 'tested' means added and used
   * with SPERT Suite; 'docs' means checked against the maker's documentation;
   * 'both' means both, the date being the documentation check's.
   */
  checked: { how: 'tested' | 'docs' | 'both'; date: string };
}

/** In page order. The page renders a section for every entry, and no other. */
export const ASSISTANTS: readonly AssistantSection[] = [
  {
    id: 'claude',
    maker: 'Anthropic',
    name: 'Claude',
    calledThere: 'a custom connector',
    where: 'Customize → Connectors',
    checked: { how: 'docs', date: 'November 23, 2026' },
  },
  {
    id: 'chatgpt',
    maker: 'OpenAI',
    name: 'ChatGPT',
    calledThere: 'a custom MCP server, added as a plugin',
    where: 'Plugins',
    checked: { how: 'both', date: 'November 23, 2026' },
  },
  {
    id: 'gemini',
    maker: 'Google',
    name: 'Gemini',
    calledThere: 'a custom app (a connector)',
    where: 'Customize → Connectors',
    checked: { how: 'tested', date: 'November 23, 2026' },
  },
  {
    id: 'grok',
    maker: 'xAI',
    name: 'Grok',
    calledThere: 'a custom connector',
    where: 'grok.com/connectors',
    checked: { how: 'docs', date: 'November 23, 2026' },
  },
  {
    id: 'claude-code',
    maker: 'Anthropic',
    name: 'Claude Code',
    calledThere: 'an MCP server',
    where: 'one terminal command',
    checked: { how: 'docs', date: 'November 23, 2026' },
  },
  {
    id: 'copilot-studio',
    maker: 'Microsoft',
    name: 'Microsoft Copilot Studio',
    calledThere: 'a tool (Model Context Protocol)',
    where: 'an agent’s Tools',
    checked: { how: 'docs', date: 'November 23, 2026' },
  },
];

/** The anchor for the section about assistants not listed above. Pinned in G14. */
export const OTHER_ASSISTANTS_ID = 'other';
