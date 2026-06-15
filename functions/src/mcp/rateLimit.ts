// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

interface RateEntry {
  count: number;
  windowStart: number;
}

const ipMap = new Map<string, RateEntry>();
const sessMap = new Map<string, RateEntry>();
const WINDOW = 60_000;

/**
 * Fixed-window counter shared by the IP and per-session limits.
 *
 * Known limitation (D2): in-memory and per-instance, so it does not
 * aggregate across scaled function instances. Acceptable at Phase 1
 * volumes; App Check / Cloud Armor is the eventual authoritative limit.
 *
 * @param {Map<string, RateEntry>} map Counter store to mutate.
 * @param {string} key Identity to rate-limit (IP or sessionId).
 * @param {number} limit Max requests allowed within the window.
 * @return {boolean} True if the request is allowed; false if over limit.
 */
function checkLimit(
  map: Map<string, RateEntry>,
  key: string,
  limit: number,
): boolean {
  const now = Date.now();
  const e = map.get(key);
  if (!e || now - e.windowStart > WINDOW) {
    map.set(key, {count: 1, windowStart: now});
    return true;
  }
  if (e.count >= limit) return false;
  e.count++;
  return true;
}

/**
 * Per-IP request limit for the MCP endpoint: 150 requests/minute.
 * Kept above the per-session write cap so it does not become the binding
 * limit during a large single-session fine-grained build.
 *
 * @param {string} ip Caller IP (leftmost x-forwarded-for; spoofable, D2).
 * @return {boolean} True if allowed; false if over limit.
 */
export function checkIpRateLimit(ip: string): boolean {
  return checkLimit(ipMap, ip, 150);
}

/**
 * Per-session write limit: 100 write ops/minute. Sized so a full
 * fine-grained AI build (one write op per theme/backbone/rib) completes
 * in a single window; bulk_import is a single op and never nears it.
 * Raised from 30 (the PR #50 placeholder) to stop large fine-grained
 * maps from truncating mid-build when a client does not pause-and-retry
 * on a rate_limited response.
 *
 * @param {string} sessionId Target session.
 * @return {boolean} True if allowed; false if over limit.
 */
export function checkSessionWriteLimit(sessionId: string): boolean {
  return checkLimit(sessMap, sessionId, 100);
}
