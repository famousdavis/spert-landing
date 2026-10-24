// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Sign-in providers whose email is trusted even when Firebase reports it
 * unverified. Read by two gates that must agree:
 *   - claimPendingInvitations: a token whose `email_verified` claim is false;
 *   - sendInvitationEmail (SH-1): an Auth record whose `emailVerified` is false
 *     before an invitee is added directly rather than sent a pending invite.
 *
 * Firebase records EVERY `microsoft.com` sign-in as `emailVerified: false`,
 * because Microsoft's ID token carries no verified-email claim for Firebase
 * to copy. Measured 2026-09-12 in the live Auth export: 10 of 10 Microsoft
 * accounts unverified, 11 of 11 Google accounts verified, zero exceptions.
 * Until v2.5.34 this gate therefore refused every Microsoft student — and
 * its error text told them to "use a Microsoft work or school account", the
 * exact case that was failing.
 *
 * `sign_in_provider` names THIS sign-in's provider, not the account's linked
 * providers (`providerData`), so an account holding both Google and Microsoft
 * is judged by whichever it signed in with. Everything else unverified —
 * `password`, `anonymous`, a `google.com` token that reports unverified — is
 * still refused, which is what the `spertsuite_invitations` rules comment
 * says the verified-email gate exists for.
 *
 * ⚠️ Adding a provider here is a trust decision about that provider's email
 * claim, not a convenience. Microsoft's rests on the Azure app registration
 * being multi-tenant and created after June 2023, when Entra began stripping
 * unverified-domain email claims by default. Whether that stripping is in
 * force for THIS registration is an owner-held risk decision recorded with
 * the v2.5.34 release — it is not a fact this file asserts.
 */
export const UNVERIFIED_EMAIL_PROVIDERS: ReadonlySet<string> = new Set([
  "microsoft.com",
]);
