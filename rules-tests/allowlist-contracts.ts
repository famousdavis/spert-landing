// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Firestore Security Rules - the `hasOnly()` field allowlist contracts.
 *
 * WHAT THIS FILE IS
 * -----------------
 * `firestore.rules` contains FOURTEEN `hasOnly()` allowlist sites - twelve
 * before 2.5.17, which added `spertForecasterProjectFields()` and
 * `spertAhpProjectFields()`. Before 2.5.16 exactly one was tested -
 * `ganttAppSnapshotFields()`, added in 2.5.15 after that allowlist silently
 * rejected every GanttApp snapshot save for seven days. The other eleven were
 * unexercised: a rule tightened past what an app writes produces
 * `PERMISSION_DENIED` on a routine save, and nothing in the suite would fail.
 * The thirteen entries below cover every site but the snapshot one, which keeps
 * its own suite.
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
 * `appMax`, `appMin`, `source`, `minSource`, `sourceVersion` and
 * `sourceCommit` are the seam a later brief consumes to compare these
 * declarations against the apps' real converters. Inline literals scattered
 * through test cases cannot be consumed, so every test in
 * `allowlist-coverage.test.ts` derives from the structure below rather than
 * restating it.
 *
 * `sourceVersion` AND `sourceCommit` are both recorded because a tag can be
 * re-pointed and a SHA cannot. Together they let a later session report how
 * stale a snapshot is rather than merely that it is one.
 *
 * !! THESE FIELD SETS WERE READ FROM THE APP REPOSITORIES ON 2026-08-20.
 * They are a dated snapshot, not a live query, pinned per entry by
 * `sourceVersion` and `sourceCommit`.
 *
 * WHAT `source` NAMES IS NOT UNIFORM, and this header used to say it was
 * ("the exact function"). Most entries do name a function; `spertahp_projects`
 * names a TypeScript interface, `spertscheduler_settings` a Zod schema,
 * `spertforecaster_projects` a key-set constant, and four name more than one
 * function. Read the string rather than a rule about the strings. The `appMin`
 * counterpart is `minSource`, which is not uniform either and says so per
 * entry.
 *
 * At the time of reading, every site's real field set matched its allowlist
 * exactly (see `coincides`), with one exception: Story Map, whose update
 * allowlist was broader than any single save touches. 2.5.25 closed that by
 * scoping `appMax` to ALL write paths reaching a site rather than to the one
 * symbol `source` names - see that entry, and `appMax` below.
 *
 * !! `clearable` RE-DERIVED 2026-08-24 across all seven app repos, at
 * spert-story-map@3d6a1ab, spert-forecaster@b4ad06a, GanttApp@4df3e58,
 * spert-scheduler@93d7bd6, spert-cfd@e7185c1, MyScrumBudget@c803f9b and
 * spert-ahp@9ff3050. The original 2.5.17 pass populated `clearable` only for
 * the two sites it authored and back-filled `[]` for the other eleven without
 * a sweep, so five real `members.<editor>` deletion paths went unrecorded and
 * shape 5 generated no case for any of them.
 *
 * !! 2.5.25 read those same seven repositories AT THE SAME SEVEN SHAs listed
 * above - verified against their working trees at the time, not assumed - for
 * two further things: the member-removal SYMBOL now recorded beside each
 * project site's `clearable`, and a per-field check that every
 * `coincides: true` entry is really written by its app. Two sites were checked
 * exhaustively (`spertscheduler_settings` 25 of 25 fields,
 * `spertscheduler_projects` 16 of 16); the other ten were sampled at three
 * fields each, chosen as the least plausible. No counterexample. THESE ARE
 * THREE DISTINCT READS, NOT ONE SWEEP - 2.5.23's was a different release, and
 * the SHAs coinciding is a fact about these repositories on 2026-08-24 rather
 * than a property of the sweeps.
 *
 * Recorded as dated blocks rather than per-entry fields on purpose:
 * `sourceVersion`/`sourceCommit` already exist to say how stale a snapshot is,
 * and that pair has already failed silently here - `spertcfd_settings` pins a
 * commit at which the transforms its `source` describes did not exist. A
 * second instance of the same mechanism would not fix the first. A date, seven
 * repos at seven SHAs and a diff to read are checkable; twenty-six strings
 * nobody can verify without redoing the sweep are not.
 *
 * EACH CLAIM ABOVE NAMES ITS OWN DIFF, because one pointer cannot carry two
 * releases: the `clearable` re-derivation is PR #114, and the 2.5.25 additions
 * are PR #116. A single "the diff is ..." line under both would leave half
 * this block checkable and half of it pinned to a release that does not
 * contain it - which is the `spertcfd_settings` failure one level up.
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
  /**
   * Line number in firestore.rules per op, in the same order as `ops`.
   *
   * DELIBERATELY LINE NUMBERS, and the one place in this file where that is
   * right. These are SAME-REPO and SELF-VERIFIED: `allowlist-coverage.test.ts`
   * reads firestore.rules and asserts every number here still lands on a line
   * containing `hasOnly(`, so drift fails loudly instead of rotting quietly.
   * A line pointer is fine exactly when something can check it. Everywhere
   * else - see `source` below - the target is in another repository that no
   * test here can read, so those name a SYMBOL. Do not "fix" these into
   * symbols; that would delete a working check. See
   * `src/guards/cross-repo-pointers.test.ts`.
   */
  lines: number[];
  shape: AllowlistShape;
  /** Every field the `hasOnly()` permits. */
  allowlist: string[];
  /**
   * Maximal field set the app writes to this site.
   *
   * ALL-PATHS SCOPED, AND THE UNIT IS THE SITE
   * ------------------------------------------
   * Every write path in the app that reaches THIS SITE, unioned - not only the
   * one symbol `source` names. `source` records where the set was READ; it is
   * not the boundary of what counts. 2.5.23 shipped `clearable` all-paths
   * beside an `appMax` scoped to a single save path, and the two then made
   * opposite claims about `members` on `spertstorymap_projects`: one listed it
   * as cleared there, the other as never written there. 2.5.25 removed the
   * collision by scoping this field the same way rather than by narrowing
   * `clearable`.
   *
   * The unit is the SITE, not the document, and `anonymous_sessions` is split
   * into `_create`/`_update` for exactly that reason. Under a document reading
   * `anonymous_sessions_update` would have to gain `lastSeq` and
   * `aiLastSeenAt` - MCP-server-owned, absent from that allowlist, and the
   * subset self-check would red. That reading is not implementable here.
   *
   * `functions/` IS OUT OF SCOPE, and durably so: `appMax` is the app-side
   * pre-image of a rules predicate, and an Admin SDK write never faces the
   * predicate, so it cannot inform it. Counting Admin writes would report a
   * gap on `aiLastSeenAt`, whose EXCLUSION from the browser allowlist is the
   * security control - the report would argue for widening the thing that
   * holds the line.
   *
   * A MAXIMUM CAN BE SCOPED THIS WAY AND A MINIMUM CANNOT - see `appMin`.
   *
   * Note that `appMax` and `clearable` are still NOT read from the same place,
   * so the two sweeps are not one sweep. They co-locate for MOST project
   * sites, not all - 4 of 7 by the file the `source` SYMBOL lives in, 5 of 7
   * by whether the `source` string mentions the file at all. Forecaster is
   * the difference: it names `firestore-sharing.ts` in a parenthetical rather
   * than as its symbol. State which criterion you mean before quoting either
   * number.
   */
  appMax: string[];
  /**
   * Minimal realistic write to this site - every conditional field absent.
   *
   * NOT ALL-PATHS SCOPED, AND NOT UNIFORM. `appMax` is a union over write
   * paths: monotone, and well defined all-paths. A minimum is an infimum, and
   * taken over all paths it collapses to the smallest single-key write
   * anywhere, which asserts almost nothing. On `spertstorymap_projects` the
   * all-paths minimum would be `['_changeLog']` - one key - because the
   * changelog delta rides its own arrayUnion update.
   *
   * So each entry's `appMin` is ANCHORED at one write path or bound, and
   * `minSource` names which. Read `minSource` and the comment above each
   * array. There is no single rule covering all thirteen: the anchors are a
   * routine save for some, a rule-imposed bound for others, and a deliberate
   * policy for one. An attempt to state one uniform rule was wrong for five of
   * them, which is why the anchor is recorded per entry instead.
   */
  appMin: string[];
  /**
   * True when `appMax` and `allowlist` are the same set.
   *
   * `coincides: false` and a non-empty `unionOnly` are the same statement, and
   * both are pinned by self-checks that red when either moves. True for all
   * thirteen since 2.5.25 - the current answer, not an invariant. See
   * `unionOnly`.
   */
  coincides: boolean;
  /**
   * Allowlisted keys the app does NOT write here - `allowlist` minus `appMax`.
   * Derived, but recorded so a reader sees the gap named instead of computing
   * it, and pinned by a self-check so the two statements cannot drift apart.
   * Empty wherever `coincides` is true.
   *
   * A NON-EMPTY `unionOnly` MEANS AN ALLOWLISTED FIELD NO APP WRITES;
   * `coincides: false` says the same thing; the self-check reds when either
   * changes. Shape 4 in `allowlist-coverage.test.ts` runs ONLY in that case.
   * It is empty for all thirteen since 2.5.25, so shape 4 is skipped
   * everywhere - that is the current answer, NOT a dead branch. Do not remove
   * the branch because nothing exercises it: the day it runs is the day an
   * allowlist has grown past what its app writes, which is the gap a new app
   * field lands in.
   */
  unionOnly: string[];
  /**
   * Fields the app clears with `deleteField()`. A plain name is a top-level
   * removal; the token `members.<editor>` is a nested removal from the members
   * map, which the harness expands to the editor uid. Empty means the app has
   * no clearing path at this site - not that removals are forbidden.
   *
   * ALL-PATHS scoped - and since 2.5.25 so is `appMax`, which removes the
   * scope contrast this note used to draw. What survives it is the ANCHOR
   * contrast, which is the part that mattered: `clearable` never came from the
   * one symbol `source` names, and still does not. Forecaster's
   * `members.<editor>` comes from `firestore-sharing.ts`, not from the
   * `_PROJECT_WRITE_KEYS_GUARD` its `source` names. `appMin` remains the
   * narrow one - anchored per entry, see `minSource`.
   *
   * The symbol each project site removes a member with is named in the comment
   * beside its array, so the two sweeps stay traceable to different code.
   */
  clearable: string[];
  /*
   * THERE IS DELIBERATELY NO `transforms` FIELD - proposed twice, cut twice.
   *
   * Six of the thirteen sites carry a non-`deleteField` transform:
   * `users_tos.acceptedAt`; `spertscheduler_projects.updatedAt`;
   * `spertstorymap_projects.updatedAt` and `_changeLog`;
   * `spertcfd_settings.projectOrder` (arrayUnion AND arrayRemove); and both
   * `anonymous_sessions` rows' serverTimestamps. Every one already sits inside
   * its own allowlist, so there is nothing live to catch. Nothing would consume
   * the field either - shape 5 consumes `clearable`, `appMax`/`appMin` feed the
   * comparison brief - and of these same transforms
   * `ganttapp-snapshot-fields.test.ts:257` already says it: "They add no engine
   * information".
   *
   * Decisively, its `[]` cells would have been FALSE. `clearable` is swept from
   * the app repositories' `src/`, and `claimPendingInvitations.ts:126-133`
   * writes `updatedAt: FieldValue.serverTimestamp()` into all seven
   * `*_projects` collections from `functions/`, outside that boundary. Five
   * rows would have read "swept, nothing here."
   *
   * Revisit only for a NAMED consumer. "We are already reading these files" is
   * not one.
   */
  /**
   * True when the collection keeps `owner` OUT of the members map, so the two
   * are orthogonal (Forecaster alone). The seeded pre-image must then name the
   * ACTING uid in the top-level `owner` field: its update rule reads
   * `resource.data.owner`, and a pre-image owned by someone else is denied
   * before the allowlist is ever reached.
   */
  ownerOrthogonal?: boolean;
  /**
   * Exact function the field sets were read from, as `path:symbolName`.
   *
   * SYMBOL-anchored, never a line number: every target lives in another
   * repository on its own release cycle, so a line number here cannot be
   * verified and cannot stay correct. A symbol survives every edit that does
   * not rename it - and a rename is the one case where the reference should
   * break loudly. Eleven of these were already correct; the two
   * `useAiConnectivity.ts` entries were line-anchored and were re-anchored in
   * 2.5.18. Enforced by `src/guards/cross-repo-pointers.test.ts`.
   */
  source: string;
  /**
   * The symbol, or described write path, this entry's `appMin` is ANCHORED at.
   * Where the create rule compels extra keys, or the bound is read off a rule
   * rather than off code, the entry comment beside `appMin` states which.
   *
   * NOT the same kind of thing as `source`, and deliberately not uniform.
   * `source` says where `appMax` was read; `minSource` says what a minimum was
   * taken OVER, and the answers genuinely differ in kind: `saveProject` and
   * `updateStructure` are routine-save symbols, `anonymous_sessions_create`
   * has no app symbol at all (its bound is the create rule's own `hasAll()`),
   * and `users_tos` records a policy rather than a reading. Three entries -
   * `spertforecaster_projects`, `spertscheduler_projects` and
   * `spertstorymap_projects` - anchor somewhere OTHER than the symbol their
   * `source` names, so copying `source` here is wrong for them specifically.
   *
   * REQUIRED, so `tsc` fails when an entry omits it, and DELIBERATELY carrying
   * no runtime assertion. Not because a `toBeTruthy()` would be worthless - it
   * would catch `''`, which `tsc` will not - but because presence is not the
   * property that matters. A green presence check over a plausible-but-wrong
   * anchor is exactly the geometry 2.5.25 exists to remove, and adding one
   * would buy the appearance of coverage over the one field whose value only a
   * reader can judge. Do not "complete" this by asserting it is non-empty.
   *
   * Subject to `src/guards/cross-repo-pointers.test.ts`, which scans this file
   * WHOLE rather than merely its `source` strings, so a path followed by a
   * colon and a line number reds `npm test` here just as it would in `source`.
   * Name symbols, never line numbers. (Writing the offending form inline as an
   * illustration reds it too - that is how this sentence lost its example.)
   */
  minSource: string;
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
    unionOnly: [],
    // firestore-sharing.ts removeCollaborator drops members.<uid>.
    clearable: ['members.<editor>'],
    source: 'GanttApp/src/shared/utils/firestore-converters.ts:projectToFirestoreMeta',
    minSource: 'GanttApp/src/shared/utils/firestore-converters.ts:projectToFirestoreMeta',
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
    unionOnly: [],
    clearable: [],
    source: 'GanttApp/src/shared/utils/firestore-converters.ts:releaseToFirestore',
    minSource: 'GanttApp/src/shared/utils/firestore-converters.ts:releaseToFirestore',
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
    // ALL-PATHS: the union over every write path reaching this site, which is
    // the whole allowlist. `doSaveProduct` alone touches only twelve of the
    // seventeen - it builds mergeFields from the product keys, removes owner,
    // members, createdAt, _originRef and _changeLog, and adds updatedAt - and
    // scoping this field to that one symbol is what produced the 2.5.23
    // collision with `clearable`, which was already all-paths.
    //
    // !! THE WIDEST WRITER IS `replaceProduct`, NOT CREATE. Until 2.5.25 this
    // comment said createdAt and _originRef arrived "at create time only".
    // False: replaceProduct does an UNMERGED tx.set on a POSSIBLY-EXISTING
    // document, so it binds `allow update`, and it carries all five of the
    // formerly-excluded keys - owner, members, createdAt and _originRef
    // explicitly, and _changeLog through the `...data` spread of the product.
    // _changeLog also arrives alone via the separate arrayUnion update after
    // each save; owner and members also via createProduct and owner
    // member-management.
    //
    // replaceProduct cannot EXCEED the allowlist, which is why `coincides` is
    // true rather than a live 2.5.15-class defect: it strips only `id`, but
    // both of its production callers feed it products from `parseImportFile`,
    // which runs importProductFromJSON (deleting _storageRef, _exportedBy and
    // _exportedById) over validateProduct (which drops every key outside
    // PRODUCT_FIELDS - a list that omits owner, members, _owner and _members
    // behind a compile-time Omit<> guard).
    appMax: [
      'name', 'description', 'createdAt', 'updatedAt', 'schemaVersion',
      'sizeMapping', 'releases', 'sprints', 'sprintCadenceWeeks',
      'themes', 'releaseCardOrder', 'sizingCardOrder', 'cardColorLabels',
      '_originRef', '_changeLog',
      'owner', 'members',
    ],
    // Optional on Product: sprintCadenceWeeks, releaseCardOrder,
    // sizingCardOrder, cardColorLabels. sanitizeForFirestore drops undefined,
    // so a product that never used them emits none of the four.
    //
    // NOT rescoped with `appMax`, deliberately: the all-paths minimum here is
    // `['_changeLog']` - the lone arrayUnion update - and a shape 2 built from
    // one key would assert almost nothing. Anchored at `doSaveProduct`.
    appMin: [
      'name', 'description', 'updatedAt', 'schemaVersion',
      'sizeMapping', 'releases', 'sprints', 'themes',
    ],
    coincides: true,
    unionOnly: [],
    // firestoreDriver.ts removeCollaborator drops members.<uid>.
    clearable: ['members.<editor>'],
    source: 'spert-story-map/src/lib/firestoreDriver.ts:doSaveProduct',
    minSource: 'spert-story-map/src/lib/firestoreDriver.ts:doSaveProduct',
    sourceVersion: 'spert-story-map v0.52.7',
    sourceCommit: '3d6a1ab',
    notes:
      'UPDATE-only by design (firestore.rules:363-372): createProduct strips only ' +
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
    unionOnly: [],
    // firestore-driver.ts removeCollaborator drops members.<uid>.
    clearable: ['members.<editor>'],
    source:
      'spert-scheduler/src/infrastructure/firebase/firestore-driver.ts:create ' +
      '(field set governed by src/domain/models/types.ts:Project)',
    // NOT `create`: the minimum is the REQUIRED keys of the Project interface
    // - name, createdAt, schemaVersion, owner, scenarios - which `create`
    // spreads; `members` and `updatedAt` are then added by the driver.
    minSource: 'spert-scheduler/src/domain/models/types.ts:Project (required keys)',
    sourceVersion: 'spert-scheduler v0.64.4',
    sourceCommit: 'ee43bec',
  },
  {
    key: 'myscrumbudget_projects',
    path: 'myscrumbudget_projects/{projectId}',
    collection: 'myscrumbudget_projects',
    sub: null,
    ops: ['create', 'update'],
    lines: [624, 635],
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
    unionOnly: [],
    // invitations.ts removeCollaborator drops members.<uid>.
    clearable: ['members.<editor>'],
    source: 'MyScrumBudget/src/lib/storage/firestoreRepo.ts:createProject / saveProject',
    minSource: 'MyScrumBudget/src/lib/storage/firestoreRepo.ts:saveProject',
    sourceVersion: 'MyScrumBudget v0.37.0',
    sourceCommit: 'df11dca',
  },
  {
    key: 'spertcfd_projects',
    path: 'spertcfd_projects/{projectId}',
    collection: 'spertcfd_projects',
    sub: null,
    ops: ['create', 'update'],
    lines: [701, 716],
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
    unionOnly: [],
    // firestore-driver.ts removeCollaborator drops members.<uid>.
    clearable: ['members.<editor>'],
    source: 'spert-cfd/src/lib/firestore-driver.ts:createProject / saveProject',
    minSource: 'spert-cfd/src/lib/firestore-driver.ts:saveProject',
    sourceVersion: 'spert-cfd v0.15.1',
    sourceCommit: 'a29dbd0',
  },
  {
    key: 'spertforecaster_projects',
    path: 'spertforecaster_projects/{projectId}',
    collection: 'spertforecaster_projects',
    sub: null,
    ops: ['create', 'update'],
    lines: [555, 562],
    shape: 'project',
    // Exactly `keyof FirestoreProjectDoc` (types.ts). Every full write routes
    // through projectToFirestoreDoc, which emits these sixteen and nothing else;
    // sanitizeForFirestore then drops the undefined ones.
    allowlist: [
      'name', 'unitOfMeasure', 'sprints',
      'sprintCadenceWeeks', 'projectStartDate', 'projectFinishDate',
      'firstSprintStartDate', 'productivityAdjustments', 'milestones',
      'createdAt', 'updatedAt', 'owner', 'members',
      '_originRef', '_changeLog', 'schemaVersion',
    ],
    appMax: [
      'name', 'unitOfMeasure', 'sprints',
      'sprintCadenceWeeks', 'projectStartDate', 'projectFinishDate',
      'firstSprintStartDate', 'productivityAdjustments', 'milestones',
      'createdAt', 'updatedAt', 'owner', 'members',
      '_originRef', '_changeLog', 'schemaVersion',
    ],
    // The always-present set. The four CLEARABLE_PROJECT_FIELDS are optional on
    // `Project` itself; _originRef and _changeLog are optional PARAMETERS of
    // projectToFirestoreDoc, so a caller that passes neither emits neither.
    // productivityAdjustments and milestones survive because the converter
    // defaults them to [] rather than leaving them undefined.
    appMin: [
      'name', 'unitOfMeasure', 'sprints',
      'productivityAdjustments', 'milestones',
      'createdAt', 'updatedAt', 'owner', 'members', 'schemaVersion',
    ],
    coincides: true,
    unionOnly: [],
    // saveProject writes deleteField() sentinels for the four clearable scalars
    // (firestore-driver.ts CLEARABLE_PROJECT_FIELDS); firestore-sharing.ts
    // removeProjectMember removes a member.
    clearable: [
      'sprintCadenceWeeks', 'projectStartDate', 'projectFinishDate',
      'firstSprintStartDate', 'members.<editor>',
    ],
    ownerOrthogonal: true,
    source:
      'spert-forecaster/src/shared/firebase/firestore-driver.ts:' +
      '_PROJECT_WRITE_KEYS_GUARD (+ owner/members, which that guard Omits by ' +
      'construction and firestore-sharing.ts writes)',
    // NOT `_PROJECT_WRITE_KEYS_GUARD`, which is a Record<..., true> key set
    // with no conditional fields and so cannot anchor a minimum. The
    // optionality lives in projectToFirestoreDoc's optional PARAMETERS
    // (_originRef, _changeLog) and in CLEARABLE_PROJECT_FIELDS being optional
    // on Project itself.
    minSource:
      'spert-forecaster/src/shared/firebase/firestore-driver.ts:' +
      'projectToFirestoreDoc (optional parameters) + CLEARABLE_PROJECT_FIELDS',
    sourceVersion: 'spert-forecaster v0.40.2',
    sourceCommit: '4223e1d',
    notes:
      'Five write sites: firestore-driver.ts saveProject (masked merge, ' +
      'PROJECT_MERGE_FIELDS) and saveProjectImmediate (UNMASKED full document - the ' +
      'reason the allowlist must cover every key the type can carry, not just what ' +
      'a routine save touches); firestore-sharing.ts shareProject, ' +
      'removeProjectMember and updateMemberRole, all touching members.<uid> only. ' +
      'ownerOrthogonal because Forecaster alone keeps `owner` out of the members map.',
  },
  {
    key: 'spertahp_projects',
    path: 'spertahp_projects/{modelId}',
    collection: 'spertahp_projects',
    sub: null,
    ops: ['create', 'update'],
    lines: [827, 841],
    shape: 'project',
    // Exactly `keyof FirestoreModelDoc` (FirestoreAdapter.ts).
    allowlist: [
      'owner', 'members', 'title', 'goal', 'createdBy',
      'createdAt', 'updatedAt', 'status', 'completionTier',
      'synthesisStatus', 'disagreementConfig', 'publishedSynthesisId',
      'criteria', 'alternatives', 'structureVersion',
      'collaborators', 'responses', 'synthesis',
      'resultsVisibility', 'order',
      '_originRef', '_changeLog', 'schemaVersion',
    ],
    // Every one of the 23 is written by at least one of the thirteen sites, so
    // this equals `allowlist` and `unionOnly` is empty. `resultsVisibility` is
    // the one that looks absent and is not: it never appears in a write-payload
    // LITERAL because it arrives through updateModel's Object.entries spread
    // (FirestoreAdapter.ts), driven from ManagePanel.tsx updateVisibility via
    // useAHP.ts updateModel. `order` is written outright by createModel,
    // createModelFromBundle and reorderModels.
    appMax: [
      'owner', 'members', 'title', 'goal', 'createdBy',
      'createdAt', 'updatedAt', 'status', 'completionTier',
      'synthesisStatus', 'disagreementConfig', 'publishedSynthesisId',
      'criteria', 'alternatives', 'structureVersion',
      'collaborators', 'responses', 'synthesis',
      'resultsVisibility', 'order',
      '_originRef', '_changeLog', 'schemaVersion',
    ],
    // updateStructure (FirestoreAdapter.ts) is the smallest multi-field real
    // write; owner and members are added because the create rule binds them.
    appMin: [
      'criteria', 'alternatives', 'structureVersion',
      'updatedAt', 'schemaVersion', 'owner', 'members',
    ],
    coincides: true,
    unionOnly: [],
    // removeCollaborator (FirestoreAdapter.ts) clears members.<uid>.
    clearable: ['members.<editor>'],
    source: 'spert-ahp/src/storage/FirestoreAdapter.ts:FirestoreModelDoc',
    minSource: 'spert-ahp/src/storage/FirestoreAdapter.ts:updateStructure',
    sourceVersion: 'spert-ahp v0.18.23',
    sourceCommit: 'a3a6254',
    notes:
      'Thirteen write sites, THREE of them full-document: setDoc in createModel ' +
      'and createModelFromBundle, tx.set in replaceModelFromBundle. Partial: ' +
      'updateDoc in updateModel, updateStructure, createResponse, updateResponse, ' +
      'saveComparisons and saveSynthesis; batch.update in reorderModels; ' +
      'tx.update in addCollaborator, updateCollaborator and removeCollaborator. ' +
      'All four transaction and batch sites are invisible to a setDoc/updateDoc ' +
      'search. Create IS guarded: all three full writes build explicit ' +
      'FirestoreModelDoc literals, the only conditional being ' +
      'replaceModelFromBundle spreading `order` when the existing doc has one. ' +
      'The allowlist rests on keyof ModelDoc being a subset of ' +
      'keyof FirestoreModelDoc, which spert-ahp v0.18.24 (bf6fe97) now enforces ' +
      'at compile time via the _relationHolds subset assertion below ' +
      'FirestoreModelDoc - see the note above spertAhpProjectFields() in ' +
      'firestore.rules for the two residuals that guard does NOT close.',
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
    unionOnly: [],
    clearable: [],
    source: 'spert-scheduler/src/domain/schemas/preferences.schema.ts:UserPreferencesSchema',
    minSource:
      'spert-scheduler/src/domain/schemas/preferences.schema.ts:' +
      'UserPreferencesSchema (the keys not marked .optional())',
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
    lines: [746],
    shape: 'selfOwned',
    allowlist: ['projectOrder'],
    appMax: ['projectOrder'],
    appMin: ['projectOrder'],
    coincides: true,
    unionOnly: [],
    clearable: [],
    source:
      'spert-cfd/src/lib/firestore-driver.ts:loadProjectOrder / createProject / deleteProject / reorderProjects',
    // No derivation: one field of one, so the minimum and the maximum are the
    // same set by construction. There is no symbol to name here, and naming
    // one would imply a reading that was never taken.
    minSource: 'no derivation - single-field allowlist, appMin == appMax necessarily',
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
    lines: [933],
    shape: 'selfOwned',
    allowlist: ['acceptedAt', 'tosVersion', 'privacyPolicyVersion', 'appId', 'authProvider'],
    appMax: ['acceptedAt', 'tosVersion', 'privacyPolicyVersion', 'authProvider', 'appId'],
    // Re-acceptance of an updated ToS omits `appId` on purpose, to preserve
    // the app that recorded the FIRST acceptance.
    appMin: ['acceptedAt', 'tosVersion', 'privacyPolicyVersion', 'authProvider'],
    coincides: true,
    unionOnly: [],
    clearable: [],
    source: 'spert-story-map/src/lib/tosHelpers.ts:writeTosAcceptance',
    // A POLICY, not a reading: writeTosAcceptance emits `appId` only when the
    // document does not yet exist, so a re-acceptance deliberately omits it to
    // preserve the app that recorded the FIRST acceptance. The minimum is that
    // branch, not a conditional-field analysis.
    minSource:
      'policy - re-acceptance omits `appId` on purpose ' +
      '(spert-story-map/src/lib/tosHelpers.ts:writeTosAcceptance, the exists branch)',
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
    lines: [972],
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
    unionOnly: [],
    clearable: [],
    source: 'spert-story-map/src/hooks/useAiConnectivity.ts:startSession (setDoc on session create)',
    // NO APP SYMBOL EXISTS for this minimum. It is read off the RULE: the
    // create rule pairs hasOnly() with a hasAll() over the same list minus
    // `appId`, so the smallest legal document is those nine required fields.
    // The app itself has only one create payload, which sends all ten.
    minSource: "the create rule's own hasAll() bound, minus `appId` (firestore.rules)",
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
    lines: [990],
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
    // The openProductId product-change effect, the smallest real update.
    appMin: ['openProductId', 'lastActiveAt'],
    coincides: true,
    unionOnly: [],
    clearable: [],
    source:
      'spert-story-map/src/hooks/useAiConnectivity.ts:startHeartbeat, the ' +
      'visibilitychange and openProductId effects, and changePermissions ' +
      '(the four updateDoc call sites)',
    // The smallest of those four call sites: the openProductId product-change
    // effect, which emits two keys. Unlike every other entry this minimum IS
    // all-paths already - it is a minimum across the same four paths `source`
    // names - and it still asserts something, because two of the five keys is
    // not one.
    minSource:
      'spert-story-map/src/hooks/useAiConnectivity.ts:' +
      'the openProductId product-change effect (smallest of the four)',
    sourceVersion: 'spert-story-map v0.52.3',
    sourceCommit: '8f0cfb2',
    notes:
      'Browser-written. aiLastSeenAt and lastSeq are deliberately absent from the ' +
      'allowlist - they are MCP-server-owned, and the rule is what stops a ' +
      'sessionId-holder advancing the op sequence.',
  },
];
