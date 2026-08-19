#!/usr/bin/env node
// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Runs the Firestore Security Rules suite against the local emulator.
 *
 * WHY A LAUNCHER RATHER THAN A PLAIN npm SCRIPT
 * ---------------------------------------------
 * Two environment problems, and one rule about how to fail.
 *
 * 1. macOS ships a STUB /usr/bin/java that exits 1 with "Unable to locate a
 *    Java Runtime". It is on PATH ahead of everything, so a Homebrew JDK
 *    (keg-only, not linked) loses to it unless its bin directory is
 *    PREPENDED. Appending is not enough — that was the first thing tried
 *    here and it failed exactly this way.
 * 2. CI (ubuntu-latest) has a real java on PATH, but it is OLDER THAN 21 and
 *    firebase-tools refuses it: "no longer supports Java version before 21".
 *    The runner does ship a JDK 21+, exposed only through JAVA_HOME_21_X64
 *    and friends, never as the default `java`. So "java runs" is not the
 *    question — "java is new enough" is. CI failed on exactly this after the
 *    first version of this script checked only that `java -version` exited 0.
 *
 * A single hardcoded PATH string cannot satisfy both, and a hardcoded
 * /opt/homebrew path in a committed script is wrong for CI regardless.
 *
 * THE RULE: if no working JRE is found, this EXITS NON-ZERO. It never skips.
 * A guard that quietly does nothing when its runtime is missing looks
 * identical to a guard that passed, and this one exists to hold a
 * cross-tenant read closed. Silence is the failure mode being designed out.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * firebase-tools 15.x refuses any JDK below 21. Checking only that `java`
 * runs is not enough — see the CI failure noted above.
 */
const MIN_JDK = 21;

/** Major version of the JDK at `binDir` (or on PATH), or 0 if unusable. */
function javaMajor(binDir) {
  const exe = binDir ? join(binDir, 'java') : 'java';
  if (binDir && !existsSync(exe)) return 0;
  const r = spawnSync(exe, ['-version'], { encoding: 'utf8' });
  if (r.status !== 0) return 0;
  // `java -version` writes to stderr. Modern: openjdk version "21.0.4".
  // Legacy: java version "1.8.0_202" — there the major is the second field.
  const m = /version "(\d+)(?:\.(\d+))?/.exec(`${r.stderr}${r.stdout}`);
  if (!m) return 0;
  const first = Number(m[1]);
  return first === 1 ? Number(m[2] ?? 0) : first;
}

function javaWorks(binDir) {
  return javaMajor(binDir) >= MIN_JDK;
}

/** macOS's java_home reports a real JDK when one is installed. */
function macJavaHome() {
  const r = spawnSync('/usr/libexec/java_home', [], { encoding: 'utf8' });
  return r.status === 0 ? join(r.stdout.trim(), 'bin') : null;
}

/**
 * GitHub runners expose every installed JDK as JAVA_HOME_<major>_<arch>.
 * Prefer the highest major at or above the floor, so a runner that adds a
 * newer JDK keeps working without a change here.
 */
function runnerJdkBinDirs() {
  return Object.entries(process.env)
    .map(([k, v]) => [/^JAVA_HOME_(\d+)_/.exec(k), v])
    .filter(([m, v]) => m && v && Number(m[1]) >= MIN_JDK)
    .sort((a, b) => Number(b[0][1]) - Number(a[0][1]))
    .map(([, v]) => join(v, 'bin'));
}

function resolveJavaBinDir() {
  if (javaWorks(null)) return null; // default java is already new enough
  const candidates = [
    ...runnerJdkBinDirs(), // CI lands here
    '/opt/homebrew/opt/openjdk/bin', // Homebrew, Apple Silicon
    '/usr/local/opt/openjdk/bin', // Homebrew, Intel
    macJavaHome(),
  ].filter(Boolean);
  return candidates.find((dir) => javaWorks(dir)) ?? undefined;
}

const javaBinDir = resolveJavaBinDir();

if (javaBinDir === undefined) {
  console.error(
    [
      '',
      `Cannot run the Firestore rules suite: no JDK ${MIN_JDK}+ found.`,
      '',
      `firebase-tools requires Java ${MIN_JDK} or newer for the Firestore emulator.`,
      `Java on PATH reports major version ${javaMajor(null) || 'none'}.`,
      '',
      'On macOS /usr/bin/java is a stub that exits 1 — having it on PATH does not',
      'mean Java is installed. On CI a JDK may be present but too old, exposed',
      'only via JAVA_HOME_<major>_<arch>.',
      '',
      `  macOS:  brew install openjdk`,
      `  Linux:  apt-get install -y openjdk-${MIN_JDK}-jre-headless`,
      '',
      'Failing rather than skipping: these tests hold a cross-tenant read closed,',
      'and a silent skip is indistinguishable from a pass.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const env = { ...process.env };
if (javaBinDir) env.PATH = `${javaBinDir}:${env.PATH}`;

const result = spawnSync(
  'firebase',
  [
    'emulators:exec',
    '--only',
    'firestore',
    '--project',
    'spert-suite',
    'vitest run --config vitest.rules.config.ts',
  ],
  { stdio: 'inherit', env, shell: false },
);

if (result.error) {
  console.error(`\nFailed to launch the Firebase CLI: ${result.error.message}`);
  console.error('Is firebase-tools installed? It is a devDependency of this package.');
  process.exit(1);
}

process.exit(result.status ?? 1);
