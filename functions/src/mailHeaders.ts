/**
 * Email header sanitization helpers.
 *
 * Display names and subjects can flow into Resend headers from
 * attacker-controlled OAuth tokens (request.auth.token.name) and
 * user-entered model names. CRLF in either field is the
 * header-injection risk; strip it unconditionally. Display names
 * additionally need RFC 5322 quoting when they contain specials
 * (commas in Microsoft "Last, First" being the most common case).
 */

/**
 * Sanitize a display name for use inside an RFC 5322 From header.
 * Strips CRLF (header injection defense), then quotes and escapes
 * the value if any specials are present.
 *
 * @param {string} s Raw display name (potentially user-controlled).
 * @return {string} Header-safe display name.
 */
export function sanitizeDisplayName(s: string): string {
  const stripped = s.replace(/[\r\n]/g, "");
  if (/[<>,;:"@\\]/.test(stripped)) {
    return `"${stripped.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  }
  return stripped;
}

/**
 * Sanitize an email Subject. Subjects do not have RFC 5322 quoting
 * rules, so only CRLF stripping is required.
 *
 * @param {string} s Raw subject (potentially user-controlled).
 * @return {string} Header-safe subject.
 */
export function sanitizeSubject(s: string): string {
  return s.replace(/[\r\n]/g, "");
}
