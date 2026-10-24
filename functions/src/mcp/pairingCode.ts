// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import {randomInt} from "node:crypto";
import {WORD_LIST} from "./wordList";

/**
 * Every pairing-code shape resolve_session_code accepts. Kept beside mintCode
 * so the minter and the resolver cannot drift apart: a test asserts every
 * minted code matches this pattern.
 *
 * AI-1 (2026-10-24 audit): TRANSITIONAL. It accepts the new WORD-10-digit
 * shape AND the old WORD-4-digit shape. generatePairingCode (which mints) and
 * mcpSpertSuite (which resolves) deploy separately, so a new-only pattern
 * would reject every code minted before the minter's deploy, or after it if
 * the resolver deployed second. Deploy mcpSpertSuite first. Drop the \d{4}
 * branch in a later release, once no old-format code can be alive (15 minutes
 * after generatePairingCode's deploy).
 */
export const RESOLVABLE_CODE = /^[A-Za-z]+-(?:\d{4}|\d{10})$/;

/**
 * Mint one candidate WORD-NNNNNNNNNN pairing code (uppercase word, 10 digits).
 * Uses node:crypto randomInt (not Math.random) for unbiased selection.
 *
 * @return {string} A candidate code, e.g. "CRANE-0384216791".
 */
export function mintCode(): string {
  if (WORD_LIST.length === 0) throw new Error("WORD_LIST is empty");
  // AI-1 (2026-10-24 audit): one word + 10 digits ≈ 44 bits, up from ~24 (one
  // word + 4 digits), which was brute-forceable within a code's 15-minute
  // life. One word keeps a single hyphen on purpose: Scheduler and Story Map
  // display the code with `code.replace("-", " · ")`, which replaces only the
  // FIRST hyphen, so this shape displays as "CRANE · 0384216791" with no
  // client change. A second hyphen would display as "WORD · WORD-DIGITS".
  // The code is copied (the panel's Copy button), not hand-typed; only
  // resolve_session_code's regex parses it.
  const idx = randomInt(0, WORD_LIST.length);
  const word = WORD_LIST[idx];
  if (word === undefined) throw new Error("word list internal error");
  const digits = String(randomInt(0, 10_000_000_000)).padStart(10, "0");
  return `${word}-${digits}`;
}
