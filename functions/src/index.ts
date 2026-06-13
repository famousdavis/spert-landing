/**
 * SPERT Suite Cloud Functions — entry point.
 *
 * Phase 2B: invitation flow shared across the SPERT suite, consumed
 * first by SPERT AHP. Implements three v2 functions plus helpers.
 */

import {getApps, initializeApp} from "firebase-admin/app";
import {setGlobalOptions} from "firebase-functions";

if (!getApps().length) {
  initializeApp();
}

// Per-function options (region, timeoutSeconds, memory, secrets) are
// set at each onCall / onSchedule call site.
setGlobalOptions({maxInstances: 10});

export {sendInvitationEmail} from "./sendInvitationEmail";
export {claimPendingInvitations} from "./claimPendingInvitations";
export {expireInvitations} from "./expireInvitations";
export {revokeInvite} from "./revokeInvite";
export {resendInvite} from "./resendInvite";
export {updateInvite} from "./updateInvite";
export {mcpSpertSuite} from "./mcp/index";
export {generatePairingCode} from "./mcp/pairing";
export {teardownAiSession} from "./mcp/teardown";
