/**
 * Logging helpers for Cloud Functions.
 *
 * Invitation tokenIds (the randomUUID document IDs of
 * spertsuite_invitations) are not bearer credentials on their own —
 * the Firestore rule requires email_verified == inviteeEmail to read,
 * and claimPendingInvitations queries by verified email rather than
 * accepting a token from the URL — but full tokenIds in Cloud Logs
 * still let a logs reader enumerate the (inviter, invitee, model)
 * social graph. Truncate to 8 hex chars so traces remain
 * correlatable while disclosing only ~32 bits of the token.
 */

/**
 * Truncate a tokenId for safe inclusion in error/warn logs. Returns
 * the empty string unchanged so callers can pass through optional
 * fields without a guard.
 *
 * @param {string} t Full tokenId (or empty string).
 * @return {string} First 8 chars followed by an ellipsis, or "".
 */
export function redactToken(t: string): string {
  if (t.length === 0) return "";
  return t.slice(0, 8) + "…";
}
