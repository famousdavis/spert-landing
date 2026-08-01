// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

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
