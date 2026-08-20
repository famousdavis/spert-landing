// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Firestore Security Rules - the `hasOnly()` field allowlist contracts.
 *
 * WHAT THIS FILE IS
 * -----------------
 * `firestore.rules` contains TWELVE `hasOnly()` allowlist sites. Before 2.5.16
 * exactly one was tested - `ganttAppSnapshotFields()`, added in 2.5.15 after
 * that allowlist silently rejected every GanttApp snapshot save for seven
 * days. The other eleven were unexercised: a rule tightened past what an app
 * writes produces `PERMISSION_DENIED` on a routine save, and nothing in the
 * suite would fail.
 *
 * WHAT IT CATCHES, AND WHAT IT DOES NOT
 * -------------------------------------
 * It does NOT prevent a recurrence of the 2.5.15 defect. That was an *app*
 * adding a field the rules did not allow. `appMax`/`appMin` below are a COPY
 * of what the apps write; when GanttApp added `todayDateOverride`, nothing in
 * this repository changed and a test written this way would have kept passing.
 *
 * It catches the MIRROR IMAGE: rules tightened past what an app already
 * writes. That is a real, previously untested failure mode, and it is the half
 * that can be closed from this repository alone.
 *
 * WHY THE FIELD SETS ARE DATA
 * ---------------------------
 * `appMax`, `appMin`, `source`, `sourceVersion` and `sourceCommit` are the
 * seam a later brief consumes to compare these declarations against the apps'
 * real converters. Inline literals scattered through test cases cannot be
 * consumed, so every test in `allowlist-coverage.test.ts` derives from the
 * structure below rather than restating it.
 *
 * `sourceVersion` AND `sourceCommit` are both recorded because a tag can be
 * re-pointed and a SHA cannot. Together they let a later session report how
 * stale a snapshot is rather than merely that it is one.
 *
 * !! THESE FIELD SETS WERE READ FROM THE APP REPOSITORIES ON 2026-08-20.
 * They are a dated snapshot, not a live query. Each entry names the exact
 * function it was read from, at the version and commit recorded with it.
 *
 * At the time of reading, EVERY site's real field set matched its allowlist
 * exactly (see `coincides`), with one deliberate exception: Story Map's update
 * allowlist is broader than any single save touches - see that entry.
 */

/** Which rule operations a site guards. `write` covers create and update together. */
export type AllowlistOp = 'create' | 'update' | 'write';

/**
 * How a site's rule is reached, which decides what the test must seed and who
 * must act.
 *
 *  - `project`       top-level `*_projects` doc with a members map. Needs an
 *                    owner/editor/viewer caller; `owner` and `members` are
 *                    themselves allowlisted, so a maximal write touches them
 *                    and must run as OWNER (see the escalation guard at
 *                    firestore.rules:295-298).
 *  - `subcollection` doc under a project. Gates on `canWriteGet(projectId)`,
 *                    which `get()`s the PARENT - the parent must be seeded or
 *                    every write is denied for the wrong reason.
 *  - `selfOwned`     keyed by the caller's own uid (`request.auth.uid == uid`).
 *                    No members map, no owner/editor split.
 *  - `anonymous`     unauthenticated capability-token document. No auth, no
 *                    membership; the sessionId itself is the credential.
 */
export type AllowlistShape = 'project' | 'subcollection' | 'selfOwned' | 'anonymous';

export interface AllowlistContract {
  /** Stable identifier; also the describe() block name. */
  key: string;
  /** Human-readable document path, as written in the ruleset. */
  path: string;
  /** Top-level collection segment. */
  collection: string;
  /** Subcollection segment, or null for a top-level document. */
  sub: string | null;
  /** Operations this site's allowlist guards. */
  ops: AllowlistOp[];
  /** Line number in firestore.rules per op, in the same order as `ops`. */
  lines: number[];
  shape: AllowlistShape;
  /** Every field the `hasOnly()` permits. */
  allowlist: string[];
  /** Maximal field set the app actually writes to this site. */
  appMax: string[];
  /** Minimal realistic write - every conditional field absent. */
  appMin: string[];
  /** True when `appMax` and `allowlist` are the same set. */
  coincides: boolean;
  /** Exact function the field sets were read from. */
  source: string;
  sourceVersion: string;
  sourceCommit: string;
  /** Anything structurally unusual about this site. */
  notes?: string;
}

/** Set equality, used to derive and to self-check `coincides`. */
export function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ');
}

export const ALLOWLIST_CONTRACTS: AllowlistContract[] = [
  {
    key: 'ganttapp_projects',
    path: 'ganttapp_projects/{projectId}',
    collection: 'ganttapp_projects',
    sub: null,
    ops: ['create', 'update'],
    lines: [288, 299],
    shape: 'project',
    allowlist: [
      'name', 'owner', 'members', 'finishDate', 'order',
      'workDays', 'legendLabels',
      'schemaVersion', 'createdAt', 'updatedAt',
      '_originRef', '_changeLog',
    ],
    appMax: [
      'name', 'owner', 'members', 'finishDate', 'order',
      'workDays', 'legendLabels',
      'schemaVersion', '_originRef', '_changeLog', 'createdAt', 'updatedAt',
    ],
    // `order` is spread only when defined; `workDays` and `legendLabels` only
    // when non-empty. `finishDate` is NOT conditional - the converter writes
    // an explicit null when unset.
    appMin: [
      'name', 'owner', 'members', 'finishDate',
      'schemaVersion', '_originRef', '_changeLog', 'createdAt', 'updatedAt',
    ],
    coincides: true,
    source: 'GanttApp/src/shared/utils/firestore-converters.ts:projectToFirestoreMeta',
    sourceVersion: 'GanttApp v0.28.10',
    sourceCommit: '73931d1',
  },
  {
    key: 'ganttapp_releases',
    path: 'ganttapp_projects/{projectId}/releases/{releaseId}',
    collection: 'ganttapp_projects',
    sub: 'releases',
    ops: ['create', 'update'],
    lines: [309, 311],
    shape: 'subcollection',
    allowlist: [
      'name', 'startDate', 'earlyFinishDate', 'lateFinishDate',
      'hidden', 'status', 'mostLikelyFinishDate', 'order',
    ],
    appMax: [
      'name', 'startDate', 'earlyFinishDate', 'lateFinishDate',
      'hidden', 'status', 'mostLikelyFinishDate', 'order',
    ],
    // Three conditional spreads: `hidden` (only when defined), `status` (only
    // when set and not 'not-started'), `mostLikelyFinishDate` (only when set).
    // This is the shape that makes an over-REQUIRING rule detectable.
    appMin: ['name', 'startDate', 'earlyFinishDate', 'lateFinishDate', 'order'],
    coincides: true,
    source: 'GanttApp/src/shared/utils/firestore-converters.ts:releaseToFirestore',
    sourceVersion: 'GanttApp v0.28.10',
    sourceCommit: '73931d1',
  },
  {
    key: 'spertstorymap_projects',
    path: 'spertstorymap_projects/{projectId}',
    collection: 'spertstorymap_projects',
    sub: null,
    ops: ['update'],
    lines: [395],
    shape: 'project',
    allowlist: [
      'name', 'description', 'createdAt', 'updatedAt', 'schemaVersion',
      'sizeMapping', 'releases', 'sprints', 'sprintCadenceWeeks',
      'themes', 'releaseCardOrder', 'sizingCardOrder', 'cardColorLabels',
      '_originRef', '_changeLog',
      'owner', 'members',
    ],
    // The ONLY site where allowlist is strictly broader than appMax.
    // `doSaveProduct` builds mergeFields from the product keys and then
    // removes owner, members, createdAt, _originRef and _changeLog, adding
    // updatedAt - so a routine save can never touch those five. They reach the
    // doc by other paths: _changeLog via a separate arrayUnion update,
    // owner/members via createProduct/replaceProduct and owner
    // member-management, createdAt and _originRef at create time only.
    appMax: [
      'name', 'description', 'updatedAt', 'schemaVersion',
      'sizeMapping', 'releases', 'sprints', 'sprintCadenceWeeks',
      'themes', 'releaseCardOrder', 'sizingCardOrder', 'cardColorLabels',
    ],
    // Optional on Product: sprintCadenceWeeks, releaseCardOrder,
    // sizingCardOrder, cardColorLabels. sanitizeForFirestore drops undefined,
    // so a product that never used them emits none of the four.
    appMin: [
      'name', 'description', 'updatedAt', 'schemaVersion',
      'sizeMapping', 'releases', 'sprints', 'themes',
    ],
    coincides: false,
    source: 'spert-story-map/src/lib/firestoreDriver.ts:doSaveProduct',
    sourceVersion: 'spert-story-map v0.52.3',
    sourceCommit: '8f0cfb2',
    notes:
      'UPDATE-only by design (firestore.rules:362-371): createProduct strips only ' +
      '`id`, so a keys().hasOnly() on create could reject a legitimate create still ' +
      'carrying an _owner/_members alias. The create surface is self-owned instead. ' +
      'Tested as documented behaviour, not as a gap.',
  },
  {
    key: 'spertscheduler_projects',
    path: 'spertscheduler_projects/{projectId}',
    collection: 'spertscheduler_projects',
    sub: null,
    ops: ['create', 'update'],
    lines: [454, 465],
    shape: 'project',
    allowlist: [
      'name', 'owner', 'members',
      'schemaVersion', 'createdAt', 'updatedAt',
      'scenarios', 'globalCalendarOverride', 'convertedWorkDays',
      'forcedWorkDays', 'targetFinishDate', 'showTargetOnGantt',
      'showActivityIds', 'ganttAppearance', 'archived', 'tileColor',
    ],
    // create() spreads the whole Project minus `id`, then adds schemaVersion,
    // owner, members and updatedAt - so the Project interface IS the field set.
    appMax: [
      'name', 'owner', 'members',
      'schemaVersion', 'createdAt', 'updatedAt',
      'scenarios', 'globalCalendarOverride', 'convertedWorkDays',
      'forcedWorkDays', 'targetFinishDate', 'showTargetOnGantt',
      'showActivityIds', 'ganttAppearance', 'archived', 'tileColor',
    ],
    // Required on Project: name, createdAt, schemaVersion, owner, scenarios.
    // Everything else is optional and stripped by sanitizeForFirestore when
    // undefined. `members` and `updatedAt` are added by the driver.
    appMin: [
      'name', 'owner', 'members', 'schemaVersion', 'createdAt', 'updatedAt', 'scenarios',
    ],
    coincides: true,
    source:
      'spert-scheduler/src/infrastructure/firebase/firestore-driver.ts:create ' +
      '(field set governed by src/domain/models/types.ts:Project)',
    sourceVersion: 'spert-scheduler v0.64.4',
    sourceCommit: 'ee43bec',
  },
  {
    key: 'myscrumbudget_projects',
    path: 'myscrumbudget_projects/{projectId}',
    collection: 'myscrumbudget_projects',
    sub: null,
    ops: ['create', 'update'],
    lines: [594, 605],
    shape: 'project',
    allowlist: [
      'name', 'startDate', 'endDate',
      'reforecasts', 'activeReforecastId', 'color', 'archived',
      'owner', 'members', 'order',
      '_teamSnapshot', '_originRef', '_changeLog',
      'schemaVersion', 'createdAt', 'updatedAt',
    ],
    appMax: [
      'name', 'startDate', 'endDate',
      'reforecasts', 'activeReforecastId', 'color', 'archived',
      'owner', 'members', 'order',
      '_teamSnapshot', '_originRef', '_changeLog',
      'schemaVersion', 'createdAt', 'updatedAt',
    ],
    // createProject has no conditional spreads (`color` and `archived` use
    // `?? null`, so they are always present). The genuinely smaller real write
    // is saveProject's SAVE_PROJECT_MERGE_FIELDS set; owner and members are
    // added here because the create rule binds them.
    appMin: [
      'name', 'startDate', 'endDate',
      'reforecasts', 'activeReforecastId', 'color', 'archived',
      '_teamSnapshot', 'updatedAt',
      'owner', 'members',
    ],
    coincides: true,
    source: 'MyScrumBudget/src/lib/storage/firestoreRepo.ts:createProject / saveProject',
    sourceVersion: 'MyScrumBudget v0.37.0',
    sourceCommit: 'df11dca',
  },
  {
    key: 'spertcfd_projects',
    path: 'spertcfd_projects/{projectId}',
    collection: 'spertcfd_projects',
    sub: null,
    ops: ['create', 'update'],
    lines: [671, 686],
    shape: 'project',
    allowlist: [
      'name', 'owner', 'members',
      'createdAt', 'updatedAt',
      'workflow', 'snapshots', 'settings',
      '_version', 'schemaVersion',
      '_originRef', '_changeLog',
    ],
    appMax: [
      'name', 'createdAt', 'updatedAt',
      'workflow', 'snapshots', 'settings',
      '_version', 'owner', 'members', 'schemaVersion',
      '_originRef', '_changeLog',
    ],
    // saveProject's mergeFields are exactly six keys; owner and members are
    // added because the create rule binds them.
    appMin: [
      'name', 'updatedAt', 'workflow', 'snapshots', 'settings', '_version',
      'owner', 'members',
    ],
    coincides: true,
    source: 'spert-cfd/src/lib/firestore-driver.ts:createProject / saveProject',
    sourceVersion: 'spert-cfd v0.15.1',
    sourceCommit: 'a29dbd0',
  },
  {
    key: 'spertscheduler_settings',
    path: 'spertscheduler_settings/{userId}',
    collection: 'spertscheduler_settings',
    sub: null,
    ops: ['write'],
    lines: [488],
    shape: 'selfOwned',
    allowlist: [
      'defaultTrialCount', 'defaultDistributionType', 'defaultConfidenceLevel',
      'defaultActivityTarget', 'defaultProjectTarget', 'dateFormat',
      'autoRunSimulation', 'theme', 'storeFullSimulationData',
      'defaultHeuristicEnabled', 'defaultHeuristicMinPercent',
      'defaultHeuristicMaxPercent', 'defaultDependencyMode', 'globalCalendar',
      'ganttViewMode', 'ganttShowToday', 'ganttShowCriticalPath',
      'ganttShowProjectName', 'ganttShowArrows', 'defaultHolidayCountry',
      'workDays', 'defaultParkinsonsLawEnabled', 'targetFinishGreenPct',
      'targetFinishAmberPct', 'suppressLocalStorageWarning',
    ],
    appMax: [
      'defaultTrialCount', 'defaultDistributionType', 'defaultConfidenceLevel',
      'defaultActivityTarget', 'defaultProjectTarget', 'dateFormat',
      'autoRunSimulation', 'theme', 'storeFullSimulationData',
      'defaultHeuristicEnabled', 'defaultHeuristicMinPercent',
      'defaultHeuristicMaxPercent', 'defaultDependencyMode',
      'defaultParkinsonsLawEnabled', 'globalCalendar', 'ganttViewMode',
      'ganttShowToday', 'ganttShowCriticalPath', 'ganttShowProjectName',
      'ganttShowArrows', 'defaultHolidayCountry', 'workDays',
      'targetFinishGreenPct', 'targetFinishAmberPct',
      'suppressLocalStorageWarning',
    ],
    // The seven keys NOT marked `.optional()` on UserPreferencesSchema.
    appMin: [
      'defaultTrialCount', 'defaultDistributionType', 'defaultConfidenceLevel',
      'defaultActivityTarget', 'defaultProjectTarget', 'dateFormat',
      'autoRunSimulation',
    ],
    coincides: true,
    source: 'spert-scheduler/src/domain/schemas/preferences.schema.ts:UserPreferencesSchema',
    sourceVersion: 'spert-scheduler v0.64.4',
    sourceCommit: 'ee43bec',
    notes:
      'ALSO pinned app-side, and the two checks are COMPLEMENTARY - do not delete ' +
      'either as redundant. spert-scheduler/src/infrastructure/persistence/' +
      'preferences-firestore-sync.test.ts reads firestore.rules from disk and asserts ' +
      'every UserPreferencesSchema key appears in this allowlist: that proves ' +
      'SCHEMA-to-ALLOWLIST agreement, statically. The cases here prove the RULE ' +
      'BEHAVES - that a document carrying those keys is actually accepted by the ' +
      'emulator, which a text scan of the rules file cannot show.',
  },
  {
    key: 'spertcfd_settings',
    path: 'spertcfd_settings/{userId}',
    collection: 'spertcfd_settings',
    sub: null,
    ops: ['write'],
    lines: [716],
    shape: 'selfOwned',
    allowlist: ['projectOrder'],
    appMax: ['projectOrder'],
    appMin: ['projectOrder'],
    coincides: true,
    source:
      'spert-cfd/src/lib/firestore-driver.ts:loadProjectOrder / createProject / reorderProjects',
    sourceVersion: 'spert-cfd v0.15.1',
    sourceCommit: 'a29dbd0',
    notes:
      'Single-field allowlist, so appMin and appMax are necessarily the same set. ' +
      'The minimal case is not redundant with the maximal one here in the way it is ' +
      'elsewhere - there is only one document shape this site can ever receive.',
  },
  {
    key: 'users_tos',
    path: 'users/{uid}',
    collection: 'users',
    sub: null,
    ops: ['write'],
    lines: [844],
    shape: 'selfOwned',
    allowlist: ['acceptedAt', 'tosVersion', 'privacyPolicyVersion', 'appId', 'authProvider'],
    appMax: ['acceptedAt', 'tosVersion', 'privacyPolicyVersion', 'authProvider', 'appId'],
    // Re-acceptance of an updated ToS omits `appId` on purpose, to preserve
    // the app that recorded the FIRST acceptance.
    appMin: ['acceptedAt', 'tosVersion', 'privacyPolicyVersion', 'authProvider'],
    coincides: true,
    source: 'spert-story-map/src/lib/tosHelpers.ts:writeTosAcceptance',
    sourceVersion: 'spert-story-map v0.52.3',
    sourceCommit: '8f0cfb2',
    notes:
      'WIDEST BLAST RADIUS IN THE RULESET. This is the ToS acceptance record shared ' +
      'by all seven Firebase-using apps, and ToS acceptance gates first run. Every ' +
      'other site fails one app; a tightening here fails every app at once. Same ' +
      'v0.22.2 provenance as the two settings sites. The writer named above is Story ' +
      "Map's, read as representative - all seven apps write the same shape.",
  },
  {
    key: 'anonymous_sessions_create',
    path: 'anonymous_sessions/{sessionId}',
    collection: 'anonymous_sessions',
    sub: null,
    ops: ['create'],
    lines: [883],
    shape: 'anonymous',
    allowlist: [
      'createdAt', 'lastActiveAt', 'expiresAt', 'browserConnectedAt',
      'openProductId', 'consentWrite', 'consentRead', 'lastSeq',
      'appVersion', 'appId',
    ],
    appMax: [
      'createdAt', 'lastActiveAt', 'expiresAt', 'browserConnectedAt',
      'openProductId', 'consentWrite', 'consentRead', 'lastSeq',
      'appVersion', 'appId',
    ],
    // The create rule pairs hasOnly() with a hasAll() over the same list minus
    // `appId`, so the minimal legal document is exactly the nine required
    // fields. That rollout-window case - an older browser build that omits
    // appId - is the one this site can most plausibly regress on.
    appMin: [
      'createdAt', 'lastActiveAt', 'expiresAt', 'browserConnectedAt',
      'openProductId', 'consentWrite', 'consentRead', 'lastSeq', 'appVersion',
    ],
    coincides: true,
    source: 'spert-story-map/src/hooks/useAiConnectivity.ts:474 (setDoc on session create)',
    sourceVersion: 'spert-story-map v0.52.3',
    sourceCommit: '8f0cfb2',
    notes:
      'BROWSER-WRITTEN, not Admin-SDK-only. Verified at the call site, which carries a ' +
      'comment noting aiLastSeenAt is omitted BECAUSE hasOnly() would reject it. ' +
      'Unauthenticated by design: the sessionId is the capability token, so there is ' +
      'no membership concept and no non-member case to assert. The rule also pins ' +
      'lastSeq == 0 and requires consentWrite/consentRead to be bools.',
  },
  {
    key: 'anonymous_sessions_update',
    path: 'anonymous_sessions/{sessionId}',
    collection: 'anonymous_sessions',
    sub: null,
    ops: ['update'],
    lines: [901],
    shape: 'anonymous',
    allowlist: [
      'browserConnectedAt', 'lastActiveAt', 'expiresAt',
      'openProductId', 'consentRead',
    ],
    // Union across the four client update call sites (337 heartbeat, 360
    // visibilitychange, 371 product-change, 515 changePermissions). No SINGLE
    // call site emits all five - the heartbeat emits four and
    // changePermissions emits two - but the allowlist must accept the union.
    appMax: [
      'browserConnectedAt', 'lastActiveAt', 'expiresAt',
      'openProductId', 'consentRead',
    ],
    // The product-change effect at line 371, the smallest real update.
    appMin: ['openProductId', 'lastActiveAt'],
    coincides: true,
    source:
      'spert-story-map/src/hooks/useAiConnectivity.ts:337,360,371,515 (updateDoc call sites)',
    sourceVersion: 'spert-story-map v0.52.3',
    sourceCommit: '8f0cfb2',
    notes:
      'Browser-written. aiLastSeenAt and lastSeq are deliberately absent from the ' +
      'allowlist - they are MCP-server-owned, and the rule is what stops a ' +
      'sessionId-holder advancing the op sequence.',
  },
];
