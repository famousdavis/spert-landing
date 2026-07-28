// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {DocumentData, Firestore} from "firebase-admin/firestore";
import {getSession, touchSession} from "../session";
import {
  ok,
  sessionNotFound,
  readNotPermitted,
  checkSessionAppId,
} from "./shared";

const SESSIONS = "anonymous_sessions";

// The distribution list is DUPLICATED VERBATIM from the Forecaster client
// (src/shared/types/burn-up.ts DISTRIBUTION_TYPES). The two repos share no
// package, so a direct import is impossible; the same cross-repo duplication
// pattern as ai-op-contract.json. A per-repo test asserts these contents, so a
// list that drifts from the client fails here rather than misinforming an AI.
export const FORECASTER_DISTRIBUTIONS = [
  "lognormal",
  "truncatedNormal",
  "gamma",
  "bootstrap",
  "triangular",
  "uniform",
] as const;

// ── Explainer content ────────────────────────────────────────────────────────
// Served without a session, so it must be self-contained and must never
// describe the app's internals beyond what a user could read on screen.

const METHOD_TOPICS = {
  "overview":
    "SPERT Forecaster answers 'when will this be done?' with a Monte Carlo " +
    "simulation over the team's velocity, not with a single-point estimate. " +
    "Each trial draws a velocity for each future sprint from a probability " +
    "distribution, subtracts it from the remaining backlog, and counts the " +
    "sprints until the backlog reaches zero. Ten thousand trials (the " +
    "default) produce a distribution of completion sprints, which is read " +
    "as percentiles: P80 is the sprint by which 80% of trials finished. " +
    "IMPORTANT: this is NOT three-point PERT. There is no (O + 4M + P) / 6 " +
    "anywhere in this app, and describing it that way is wrong. The name " +
    "SPERT stands for Statistical PERT.",
  "distributions":
    "Six velocity distributions are available, and which ones the user can " +
    "see depends on the forecast mode and on their Settings. " +
    "lognormal: right-skewed and always positive — the app default, and a " +
    "good fit for delivery data where a bad sprint can be much worse than a " +
    "good sprint is better. " +
    "truncatedNormal: symmetric, bounded at zero by rejection sampling. " +
    "gamma: flexible shape, always positive (Marsaglia-Tsang). " +
    "triangular: peaks at the mean, always positive. " +
    "bootstrap: resamples the team's ACTUAL recorded sprint velocities " +
    "rather than fitting a curve — the #NoEstimates approach. Requires at " +
    "least five included sprints and is offered only in History mode. " +
    "uniform: flat between bounds; offered only in Subjective mode. " +
    "Always check the snapshot's visibleDistributions before quoting a " +
    "number: a distribution the app computed is not necessarily one the user " +
    "is looking at.",
  "modes":
    "History mode derives the velocity mean and standard deviation from the " +
    "team's recorded sprints, and needs at least five included sprints. " +
    "Subjective mode is the cold-start path: the user gives a velocity " +
    "estimate and picks how variable their delivery feels, which the app " +
    "turns into a coefficient of variation. The mode is auto-detected from " +
    "the included sprint count and can be overridden by the user; the " +
    "snapshot reports both the mode in force and whether it was overridden.",
  "percentiles":
    "A percentile answers 'by which sprint will the work be done with X% " +
    "confidence?' P50 is the median — as likely to be late as early. P80 " +
    "and P90 are the planning numbers: a date you would commit to. Because " +
    "completion is quantized to whole sprints, the displayed date is the " +
    "EARLIEST sprint end at which the cumulative probability reaches the " +
    "percentile, so the true probability at that date is at least the " +
    "percentile and can be materially higher.",
  "milestones":
    "A milestone carries the work the user believes REMAINS for it, which " +
    "they maintain by hand as work progresses, scope is added, or scope is " +
    "descoped. The app does not derive it from sprint history. Milestones " +
    "are forecast cumulatively: milestone i is reached when the trial has " +
    "delivered the running sum of every milestone up to and including it. A " +
    "milestone with zero remaining work is treated as complete.",
  "scope-growth":
    "Scope growth models a backlog that grows each sprint. When enabled, " +
    "each simulated sprint adds a fixed amount of work back to the " +
    "remaining backlog, either calculated from the project's own recorded " +
    "scope-change history or entered by the user. It is off by default; the " +
    "snapshot reports whether it was modeled and at what rate.",
  "productivity":
    "A productivity adjustment models a period of reduced output — a " +
    "holiday, a vacation, a company event. Each has a date range and a " +
    "factor from 0 to 100%, and the app weights each simulated sprint by " +
    "how much of it overlaps the adjustment's working days. Only enabled " +
    "adjustments affect a run, and only those whose range reaches into the " +
    "forecast period can change the result.",
  "deadline-probability":
    "Given a target date, the app reports the probability that the work " +
    "finishes on or before it: the share of trials whose completion sprint " +
    "ends by that date. The value is capped at 99% — no forward-looking " +
    "probability claims certainty.",
} as const;

const GLOSSARY = {
  "velocity":
    "Work completed in one sprint, in the project's unit of measure.",
  "remaining backlog":
    "The work the user says is still to be done. It pre-fills from the most " +
    "recent included sprint's recorded backlog-at-end but is user-editable, " +
    "and the app flags when the two have drifted apart.",
  "unit of measure":
    "Whatever the team counts — story points, items, hours. The app is " +
    "agnostic; it forecasts the number, not the meaning.",
  "sprint":
    "One iteration. Its length is the project's cadence in weeks. Sprint " +
    "finish dates are always business days.",
  "cadence": "The sprint length in weeks.",
  "trial":
    "One simulated run to completion. The default is 10,000 trials per " +
    "forecast per distribution.",
  "percentile":
    "PX is the sprint by which X% of trials had finished. Higher is more " +
    "conservative.",
  "standard deviation":
    "How much velocity varies sprint to sprint. Larger means a wider, less " +
    "certain forecast.",
  "coefficient of variation":
    "Standard deviation divided by the mean. Subjective mode elicits this " +
    "from the user as a plain-language question about how steady delivery " +
    "feels.",
  "volatility multiplier":
    "A History-mode dial that scales the calculated standard deviation up " +
    "or down when the user believes the future will be more or less " +
    "turbulent than the recorded past.",
  "milestone":
    "A named checkpoint carrying the work the user believes remains for it. " +
    "User-maintained, not derived. Zero remaining means complete.",
  "burn-up chart":
    "Cumulative work completed plotted against total scope, with forecast " +
    "lines projecting forward at chosen percentiles.",
  "cumulative distribution":
    "The curve of probability against sprint number. The app plots it; this " +
    "connection does not carry it.",
  "bootstrap":
    "Resampling the team's actual recorded velocities instead of fitting a " +
    "distribution to them — the #NoEstimates approach.",
  "scope growth": "Modeled work added back to the backlog each sprint.",
  "productivity adjustment":
    "A dated period of reduced output, applied as a weighting factor to the " +
    "sprints it overlaps.",
} as const;

/**
 * Register the SPERT Forecaster MCP tools.
 *
 * Three tools, all READ-ONLY. Forecaster never writes through this server:
 * it creates its session with consentWrite: false, and assertWriteAllowed in
 * writeOpBatch refuses any write against such a session. There is no
 * Forecaster op vocabulary and no entry in ai-op-contract.json, deliberately.
 *
 * @param {McpServer} server MCP server to register tools on.
 * @param {Firestore} db Admin Firestore instance (bypasses rules).
 * @return {void}
 */
export function registerForecasterTools(
  server: McpServer,
  db: Firestore,
): void {
  server.tool(
    "forecaster_get_project",
    `Read the open SPERT Forecaster project: its configuration, sprint history,
milestones, productivity adjustments, the forecast inputs in force, and the
percentile results of the most recent simulation run in the user's browser.
ONLY available when the user has enabled Read Mode in the Connect AI panel.

THIS CONNECTION IS READ-ONLY. There is no tool to change anything in
Forecaster; if the user asks for an edit, tell them what to change and where.

Before quoting any number, read results.status. "fresh" means the results
match the inputs; "stale" means the user changed something since the run and
statusReason says what; "recomputing" means a simulation is running right now;
"absent" means none has been run. Check visibleDistributions too — the app
computes distributions the user may not have on screen.

Forecaster uses Monte Carlo simulation over velocity. It is NOT three-point
PERT; there is no (O + 4M + P) / 6 in this app. Call forecaster_explain_method
before explaining the maths.`,
    {sessionId: z.string().uuid()},
    async ({sessionId}) => {
      let session: DocumentData | null;
      try {
        session = await getSession(db, sessionId);
      } catch {
        return ok({
          status: "error",
          error: "internal",
          message: "Temporary error; retry.",
        });
      }
      if (!session) return sessionNotFound();
      // strict: true — unlike the siblings. Forecaster has written an appId
      // since its first release, so there is no rollout window to tolerate,
      // and the Firestore create rule allows appId via hasOnly rather than
      // requiring it via hasAll. A session with no appId is therefore some
      // other app's, and must be refused.
      const appErr = checkSessionAppId(session, "forecaster", true);
      if (appErr) return appErr;
      if (!session.consentRead) return readNotPermitted();
      try {
        await touchSession(db, sessionId);
      } catch {
        // non-fatal: presence refresh is best-effort
      }
      try {
        const snap = await db.collection(SESSIONS).doc(sessionId)
          .collection("snapshot").doc("current").get();
        if (!snap.exists) {
          return ok({
            status: "no_snapshot",
            message: "No forecast data yet. Ask the user to open SPERT " +
              "Forecaster with Read Mode enabled and a project selected, " +
              "then retry.",
          });
        }
        const project = snap.data()?.project;
        if (project === undefined || project === null) {
          return ok({
            status: "no_snapshot",
            message: "The snapshot is present but carries no project. Ask " +
              "the user to reopen SPERT Forecaster, then retry.",
          });
        }
        return ok({status: "ok", project});
      } catch {
        return ok({
          status: "error",
          error: "internal",
          message: "Snapshot read failed; retry.",
        });
      }
    },
  );

  server.tool(
    "forecaster_explain_method",
    `Explain how SPERT Forecaster produces a forecast. Needs no session and no
Read Mode — call it whenever you are about to describe the method, and
ESPECIALLY before answering "how does this work?".

The single most common mistake is describing SPERT as three-point PERT with
the (O + 4M + P) / 6 weighted average. It is not. It is a Monte Carlo
simulation over sprint velocity.

topic: overview | distributions | modes | percentiles | milestones |
scope-growth | productivity | deadline-probability`,
    {
      topic: z.enum([
        "overview", "distributions", "modes", "percentiles", "milestones",
        "scope-growth", "productivity", "deadline-probability",
      ]),
    },
    async ({topic}) =>
      ok({
        status: "ok",
        topic,
        explanation: METHOD_TOPICS[topic],
        distributions: topic === "distributions" ?
          FORECASTER_DISTRIBUTIONS : undefined,
      }),
  );

  server.tool(
    "forecaster_get_glossary",
    `Define SPERT Forecaster's vocabulary. Needs no session and no Read Mode.
Omit "term" for the whole glossary, or pass one term for a single definition.
Use this rather than assuming a word means what it means in other planning
tools — "velocity", "milestone" and "remaining backlog" all carry specific
meanings here.`,
    {term: z.string().min(1).max(100).optional()},
    async ({term}) => {
      if (!term) return ok({status: "ok", glossary: GLOSSARY});
      const key = term.trim().toLowerCase();
      const definition = (GLOSSARY as Record<string, string>)[key];
      if (!definition) {
        return ok({
          status: "not_found",
          term,
          message: "No such term. Call this tool with no argument for the " +
            "full glossary.",
          availableTerms: Object.keys(GLOSSARY),
        });
      }
      return ok({status: "ok", term: key, definition});
    },
  );
}
