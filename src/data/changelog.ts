// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

export interface ChangelogEntry {
  version: string;
  date: string;
  sections: {
    heading: string;
    items: string[];
  }[];
}

export const changelog: ChangelogEntry[] = [
  {
    version: '2.5.15',
    date: 'August 20, 2026',
    sections: [
      {
        heading: 'Fixed',
        items: [
          'Saving a chart snapshot in GanttApp™ failed for anyone using cloud storage who had set a status date, and failed without saying so. The rules governing the shared database list which pieces of information a snapshot is allowed to carry. The status date, added to GanttApp in August, was never added to that list, so the database refused the snapshot outright. Nothing told the user — the snapshot simply never appeared, every time, for as long as a status date was set. Snapshots taken without a status date were unaffected, as was anyone working in local storage rather than the cloud.',
          'The status date is now on the list, so those snapshots save. A new automated test saves a snapshot carrying every piece of information the app actually writes, including the status date, and separately confirms that a snapshot carrying anything unrecognised is still refused. Testing only the second half is what allowed this to happen: the rules were checked for what they should block and never for what they must allow.',
        ],
      },
    ],
  },
  {
    version: '2.5.14',
    date: 'August 19, 2026',
    sections: [
      {
        heading: 'Security',
        items: [
          'The check that protects cloud project data now runs automatically. It was added in the previous release but had to be started by hand, so nothing actually forced it to run — a safeguard that depends on someone remembering is not a safeguard. It is now part of the release gate, running both on a developer’s machine and on every proposed change, and a release cannot complete while it fails.',
          'The check refuses to be skipped. It needs a Java runtime in order to start a local copy of the database, and where none is found it stops the release and explains why, rather than passing quietly. A check that does nothing when its dependencies are missing looks exactly like a check that passed, and that is the failure being designed out.',
          'Confirmed to work by deliberately reintroducing the original fault in one collection and watching the gate fail on precisely that collection and nothing else, before restoring it. The gate was never trusted on the strength of a green run alone.',
        ],
      },
    ],
  },
  {
    version: '2.5.13',
    date: 'August 19, 2026',
    sections: [
      {
        heading: 'Security',
        items: [
          'A signed-in user of any SPERT® Suite app could retrieve every project stored in cloud storage, including projects never shared with them. The rules governing the shared database allowed opening an individual project only to its members, and that check was correct and always worked. But the separate rule governing how a whole collection is listed asked only whether the request came from someone signed in. Anyone querying the database directly, rather than through one of the apps, would have received every project it held. All seven apps that share the database were affected. Projects kept in a browser’s local storage are never sent to the database and were never exposed.',
          'The listing rules now apply the same membership test that opening always applied, so the database enforces it regardless of which program asks. Each rule is shaped to the request its own app actually makes, so no app needed changing — two of the seven deliberately record ownership differently from the other five, and a single uniform rule would have quietly stopped those two from loading anything.',
          'A new automated test suite runs the real rules against a local copy of the database and checks both directions: that a request for another person’s projects is refused, and that each app’s own request still returns its own projects, down to the individual documents. Checking only the first half would have let a rule that blocks everyone pass as a success. The suite was confirmed to fail against the previous rules before it was trusted.',
          'The reasoning that produced the original rule was written into the rules file itself, and it was mistaken — it claimed the database could not check membership during a listing, which it can. That comment has been replaced with the correction and the evidence, so the same conclusion is not reached again.',
        ],
      },
    ],
  },
  {
    version: '2.5.12',
    date: 'August 2, 2026',
    sections: [
      {
        heading: 'Licensing',
        items: [
          'The additional conditions attached to this project’s licence have been revised, and two new ones added. What the licence permits is unchanged — anyone may still use, study, modify and share this software freely. What changed is the set of conditions that travel alongside it, and each of the six now follows the wording of the standard licence itself rather than paraphrasing it. That matters more than it sounds: the standard licence lets a recipient delete any added condition that strays outside the short list it allows, so a condition worded too ambitiously protects nothing at all.',
          'The first new condition says the author’s name may not be used to endorse or promote a product built from this software without permission. Nothing else in the licence covered this. The project’s trademarks are protected whether the licence mentions them or not, but a personal name has no such protection — and because another condition requires that name to stay in the source code, anyone forking the project already has it in hand.',
          'The second new condition applies to anyone who resells this software with a warranty or a support contract of their own. If those promises create a liability that lands on the original author, the reseller has to cover it. The standard licence already permits a reseller to make such promises; this simply makes clear that the promises are theirs to stand behind.',
          'The condition covering on-screen credit was rewritten. It previously required any modified version with a user interface to display a notice. It now requires that where such a version already displays legal notices, the original author’s name is preserved among them. The standard licence allows a project to require that existing notices be kept, not that new ones be created, and the earlier wording asked for more than that — which would have let a recipient strike the condition out entirely.',
          'Two smaller changes. A modified version may no longer misrepresent where this software came from. And the trademark condition now states plainly that referring to this project by name, in order to say honestly what a fork was derived from, is not itself prohibited — provided it does not suggest this project endorses the result. No change to how the application works.',
        ],
      },
    ],
  },
  {
    version: '2.5.11',
    date: 'July 31, 2026',
    sections: [
      {
        heading: 'Licensing',
        items: [
          'Every file of source code in this project now carries the copyright and licence notice, and 71 of them were either missing it or carrying an incomplete version. Most of the gap was in the server-side code that handles collaboration invitations and the AI connection — 43 files that were written after the notices were added everywhere else, and so never received them.',
          'Twenty-two files carried a shortened notice that named the licence but left out the line saying where to read it. That line is the part the licence actually requires: this software is released under terms that add four conditions to the standard licence, and a source file carrying those conditions has to either state them or say where they are found. A file that stops at the licence name points a recipient nowhere.',
          'A new automated check now refuses a release if any source file is missing the notice, including files that have not yet been committed, and including the security rules file that has no other check on it at all. Every way the check could fail was deliberately triggered and confirmed to be caught before it was trusted.',
        ],
      },
    ],
  },
  {
    version: '2.5.10',
    date: 'July 31, 2026',
    sections: [
      {
        heading: 'Release process',
        items: [
          'The release checks can now be told about every copy of a changelog a project keeps, rather than just one. Six of the nine SPERT® Suite repositories keep the same history in two or three places at once — a file alongside the source, a served copy the app actually reads, and in some cases a third copy built into the app itself. Until now the checks looked at one of them, so a release could pass while the others were left behind.',
          'This mattered most where the served copy is the one on screen. In SPERT® Story Map the app fetches that copy at the moment a reader opens the version history, which means the file the checks were watching was the one nobody ever saw. Had the two drifted apart, the app would have shown the stale one and every check would still have reported success.',
          'Each new check was deliberately broken before being trusted: a copy was altered, an entry was removed, and a file was deleted, and the checks were confirmed to fail in each case before the change was accepted.',
        ],
      },
    ],
  },
  {
    version: '2.5.9',
    date: 'July 31, 2026',
    sections: [
      {
        heading: 'Release process',
        items: [
          'The automated checks introduced in the previous release now run on the exact version of Node.js each repository pins, rather than on whichever recent version the build service happens to offer. Every repository already recorded its required version in a small file alongside the code; that file is now what the checks read. Two repositories that were missing the file have been given one.',
          'This closes a gap rather than repairing a visible fault. The checks had been passing on a newer version than the one declared, so a problem specific to the declared version could have gone unreported. One companion repository deliberately holds back from the newest release of Node.js to avoid a known fault in it, and the checks as written would have quietly ignored that instruction.',
        ],
      },
    ],
  },
  {
    version: '2.5.8',
    date: 'July 30, 2026',
    sections: [
      {
        heading: 'Release process',
        items: [
          'Every proposed change to this site is now checked automatically before it can be merged: the linter, a type check, a production build, the Cloud Functions test suite, and a check that the version number agrees everywhere it appears. This is the first automated checking this repository has ever had — previously a green checkmark meant only that a preview had been built.',
          'This site is the last of the nine SPERT® Suite repositories to receive the same release gate. All nine now run an identical script, with only their own configuration file differing.',
          'The versioning rule written down here since v2.4.0 — that package.json, the lockfile, the version the footer displays, and the changelog must all be bumped together — is now enforced rather than remembered. All four surfaces are checked, and a release cannot ship with any of them out of step.',
        ],
      },
      {
        heading: 'Shared documents',
        items: [
          'Added automatic checks for the documents this site publishes on behalf of the whole suite. The Terms of Service and Privacy Policy PDFs are linked directly by all eight other SPERT apps, and the AI Privacy and AI Consent notices are reached through permanent short links. Renaming or removing any of them would have broken those links in every app at once, with nothing anywhere reporting an error. Their presence is now verified on every test run, along with every short link that points at them.',
          'The license file kept here is the master copy that all nine repositories share. Its exact content is now verified against the same fingerprint the other eight check against, so the master and its copies can no longer drift apart unnoticed.',
        ],
      },
      {
        heading: 'Connect AI',
        items: [
          'The shared definition that this site’s AI service and SPERT Scheduler are both built against is now verified automatically in both places. Keeping the two copies identical had always been a written rule with a helper command, but that command only displayed a fingerprint for a person to compare by eye — nothing failed if the two ever drifted apart. Both halves now check the same fingerprint on every test run, so a one-sided change fails immediately instead of surfacing later as a rejected request.',
        ],
      },
    ],
  },
  {
    version: '2.5.7',
    date: 'July 29, 2026',
    sections: [
      {
        heading: 'Legal',
        items: [
          'The license now reserves the SPERT® brand explicitly. A new Trademark Reservation clause names "SPERT", "Statistical PERT" and "Estimation Made Easy" as trademarks registered with the USPTO, and "GanttApp" and "MyScrumBudget" as unregistered common-law marks, and grants no right to use any of them — whether alone, combined with other words such as "SPERT Suite", or as a logo.',
          'Previously the license said nothing at all about the brand, which left room to argue that the freedom to redistribute and modify the code carried the name along with it. That was never the intent.',
          'A companion clause now requires any modified version to be renamed so that it cannot be confused with those marks. Between them the two new clauses draw the line the license always meant to draw: the code is free to take, change and redistribute, the author attribution has to travel with it, and the brand stays behind.',
          'The existing Attribution Preservation and UI Notice Preservation clauses are unchanged, and the GNU GPL v3 text itself is untouched — verified byte-for-byte against the previous release. Both additions sit in the ADDITIONAL TERMS section and fall inside the categories GPL v3 Section 7 permits, which is what stops a downstream recipient from simply deleting them.',
          'The ADDITIONAL TERMS heading now cites Section 7 rather than Section 7(b), because the terms draw on 7(b) for attribution, 7(c) for renaming modified versions, and 7(e) for the trademark reservation.',
        ],
      },
      {
        heading: 'Infrastructure',
        items: [
          'This repository is now the canonical source for the suite-wide license, and the same file is being copied into all eight sibling app repositories. The only difference permitted between copies is the project repository URL on line 4.',
          'An audit of all nine repositories found just one exact copy of the license before this release. Two apps shipped a summary and a link in place of the full GNU GPL v3 text, one was missing a section of it, five still carried the retired "Statistical PERT® Software Suite" name, and six carried an older and weaker wording of the additional terms. Each is being corrected in its own patch release.',
        ],
      },
    ],
  },
  {
    version: '2.5.6',
    date: 'July 29, 2026',
    sections: [
      {
        heading: 'Security',
        items: [
          'Updated the site framework to pick up nine published security advisories.',
          'Patched a file-disclosure advisory in the stylesheet build tool.',
          'Patched a denial-of-service advisory in a pattern-matching library used by the linter.',
        ],
      },
      {
        heading: 'Dependencies',
        items: [
          'Tightened two dependency ranges so routine installs can no longer pull in versions that have not completed review.',
          'Routine maintenance only — nothing changes in the site or the apps.',
        ],
      },
    ],
  },
  {
    version: '2.5.5',
    date: 'July 28, 2026',
    sections: [
      {
        heading: 'Fixed',
        items: [
          'Corrected the grammar in the "you’ve been added to a project" email, which read "added you as a editor" instead of "an editor".',
        ],
      },
    ],
  },
  {
    version: '2.5.4',
    date: 'July 28, 2026',
    sections: [
      {
        heading: 'Dependencies',
        items: [
          'Updated the email delivery library and the email template renderer used to send SPERT® Suite invitations.',
          'Invitation emails were confirmed to render identically before and after the change, down to the byte.',
          'Routine maintenance only — nothing changes in the site or the apps.',
        ],
      },
    ],
  },
  {
    version: '2.5.3',
    date: 'July 28, 2026',
    sections: [
      {
        heading: 'Dependencies',
        items: [
          'Updated the server-side linter to ESLint 10.4.1.',
          'Routine maintenance only — nothing changes in the site or the apps.',
        ],
      },
    ],
  },
  {
    version: '2.5.2',
    date: 'July 27, 2026',
    sections: [
      {
        heading: 'Dependencies',
        items: [
          'Moved the server-side linter to ESLint 10, bringing it in line with the rest of the SPERT® Suite. It was the last piece still on ESLint 8.',
          'Retired an unmaintained style configuration that had been holding the linter back, along with two dependencies it required.',
          'Routine maintenance only — nothing changes in the site or the apps.',
        ],
      },
    ],
  },
  {
    version: '2.5.1',
    date: 'July 27, 2026',
    sections: [
      {
        heading: 'Security',
        items: [
          'Patched a denial-of-service advisory in a pattern-matching library used throughout the server-side build and test tooling.',
        ],
      },
      {
        heading: 'Dependencies',
        items: [
          'Updated the server-side test toolchain to Jest 30.',
          'Updated firebase-admin to 13.10, React to 19.2.6, TypeScript ESLint to 8.60, and ts-jest to 29.4.11.',
          'Routine maintenance only — nothing changes in the site or the apps.',
        ],
      },
    ],
  },
  {
    version: '2.5.0',
    date: 'July 26, 2026',
    sections: [
      {
        heading: 'Legal',
        items: [
          'Updated the Terms of Service and the Privacy Policy to Version 1.1.',
          'Account deletion is now described accurately: deletion is requested through the contact form or by email and is carried out by the Operator, and both documents now state plainly that the apps do not yet offer a self-service account-deletion control.',
          'The Privacy Policy now commits to completing a deletion request within 30 days under normal circumstances.',
          'The Privacy Policy now calls out up front that turning on Read Mode uploads a copy of your open project even if you otherwise keep your data in local browser storage only.',
          'The Terms of Service now reflect that some apps offer AI Connectivity in read-only form, where no permission grants an AI assistant the ability to change your content.',
          'Reissued the SPERT® AI Privacy Notice and AI Connectivity Consent Notice with page numbering. The wording is unchanged — both remain Version 2.0.',
        ],
      },
      {
        heading: 'Fixed',
        items: [
          'Corrected a broken link in the Privacy Policy, which pointed at an address for the AI Privacy Notice that did not resolve. Copies of the older document already downloaded will now reach the notice as well.',
        ],
      },
    ],
  },
  {
    version: '2.4.0',
    date: 'July 26, 2026',
    sections: [
      {
        heading: 'Legal',
        items: [
          'Updated the SPERT® AI Privacy Notice to Version 2.0, published at /ai-privacy.',
          'Updated the SPERT® AI Connectivity Consent Notice to Version 2.0, published at /ai-consent-notice.',
          'Both notices now cover every application offering Connect AI — SPERT® Story Map and SPERT® Scheduler (write and read) and SPERT® Forecaster (read-only) — including a table of the modes each application offers.',
          'Clarified that enabling Read Mode uploads a copy of the open project even when an application is configured for local storage only, and added guidance for users connecting AI on behalf of an employer or organization.',
        ],
      },
    ],
  },
  {
    version: '2.1.2',
    date: 'June 28, 2026',
    sections: [
      {
        heading: 'Dependencies',
        items: [
          'Adopted Node.js 24 runtime.',
        ],
      },
    ],
  },
  {
    version: '2.1.1',
    date: 'June 28, 2026',
    sections: [
      {
        heading: 'Security',
        items: [
          'Updated the underlying framework and build tooling to address security advisories.',
        ],
      },
      {
        heading: 'Dependencies',
        items: [
          'Adopted TypeScript 6.0.3.',
          'Updated React, Tailwind CSS, and related build dependencies.',
        ],
      },
    ],
  },
  {
    version: '2.1.0',
    date: 'June 12, 2026',
    sections: [
      {
        heading: 'Legal',
        items: [
          'Updated Terms of Service and Privacy Policy to v06-12-2026 ahead of the upcoming AI Connectivity ("Connect AI") feature.',
          'Published the SPERT® AI Privacy Notice v1.0 at the permanent URL /ai-privacy and added an "AI Privacy Notice" link to the footer legal links.',
          'Published the SPERT® AI Connectivity Consent Notice v1.0 at /ai-consent-notice (background reference document; publicly accessible but not linked in navigation).',
        ],
      },
    ],
  },
  {
    version: '2.0.5',
    date: 'May 3, 2026',
    sections: [
      {
        heading: 'Accessibility',
        items: [
          'Added `autoComplete="name"` and `autoComplete="email"` to the shared form shell so Chrome stops flagging the autocomplete-attribute warning on the Contact, I Found a Bug, and I Have a Request forms — and so password managers and browser autofill recognize the user-name and user-email fields correctly.',
        ],
      },
    ],
  },
  {
    version: '2.0.2',
    date: 'May 1, 2026',
    sections: [
      {
        heading: 'Changed',
        items: [
          'Replaced the generic "Open App →" call-to-action on each of the six tool tiles with action-oriented, tool-specific CTAs: SPERT® Story Map → "Map Your Release"; SPERT® Forecaster → "Forecast Your Release"; GanttApp™ → "Build Your Timeline"; SPERT® Scheduler → "Schedule Your Project"; SPERT® CFD → "Analyze Your Flow"; MyScrumBudget™ → "Plan Your Budget".',
        ],
      },
    ],
  },
  {
    version: '2.0.1',
    date: 'May 1, 2026',
    sections: [
      {
        heading: 'Changed',
        items: [
          'Tightened hero headline to "Give stakeholders forecasts you can defend." — sized down (text-lg/xl, semibold) so it no longer competes with the "SPERT® Suite" brand title and capped at max-w-3xl with text-balance for cleaner wrapping on smaller laptop displays.',
          'Split hero subhead into two sentences (em-dash removed), clarified "delivery" as "product delivery," and added text-balance for cleaner wrapping.',
          'Italicized the "No sign-up required to get started!" line and added an exclamation mark for warmth.',
          'Refined three tile descriptions: SPERT® Story Map → "Map and size your release scope before the first sprint begins."; SPERT® Scheduler → "Build and maintain a project schedule that accounts for uncertainty."; MyScrumBudget™ → "Plan and reforecast your budget for any project, any team."',
        ],
      },
    ],
  },
  {
    version: '2.0.0',
    date: 'May 1, 2026',
    sections: [
      {
        heading: 'Changed',
        items: [
          'Rewrote hero copy: new headline ("Give stakeholders forecasts you can defend — not single-point guesses.") and subhead emphasizing defensibility and user judgment over feature description.',
          'Rewrote all six tool tile descriptions to be outcome-first and action-oriented — answering "when would I use this?" instead of describing the underlying technique.',
          'Trimmed homepage intro to a single "No sign-up required to get started." line below the subhead.',
        ],
      },
      {
        heading: 'Versioning',
        items: [
          'Switched from MAJOR.MINOR to full semver (MAJOR.MINOR.PATCH) starting with this release.',
        ],
      },
    ],
  },
  {
    version: '1.8',
    date: 'May 1, 2026',
    sections: [
      {
        heading: 'Added',
        items: [
          'Branded favicon for the browser tab and a small brand mark in the header beside "SPERT® Suite"; a charcoal dark-mode variant ships alongside the navy original.',
        ],
      },
      {
        heading: 'Changed',
        items: [
          'App tile colors realigned to each app’s official favicon palette: Scheduler orange (#f75b2b), Story Map indigo (#4f46e5), CFD purple (#7c3aed), GanttApp™ teal (#0891b2), MyScrumBudget™ green (#16a34a). Forecaster blue (#0070f3) unchanged.',
        ],
      },
    ],
  },
  {
    version: '1.7',
    date: 'April 5, 2026',
    sections: [
      {
        heading: 'Legal',
        items: [
          'Updated Terms of Service and Privacy Policy to v04-05-2026',
          'Added SPERT\u00AE AHP to list of covered apps',
          'Updated effective date to April 5, 2026',
        ],
      },
    ],
  },
  {
    version: '1.6',
    date: 'March 31, 2026',
    sections: [
      {
        heading: 'Legal',
        items: [
          'Updated Terms of Service and Privacy Policy to v03-31-2026',
          'Updated canonical legal document URLs from spert-landing.vercel.app to spertsuite.com',
          'Added License link to footer (links to GitHub LICENSE file)',
        ],
      },
    ],
  },
  {
    version: '1.5',
    date: 'March 30, 2026',
    sections: [
      {
        heading: 'Improvements',
        items: [
          'Updated all app tile URLs to use the new spertsuite.com subdomains (storymap, forecaster, ganttapp, scheduler, cfd, myscrumbudget)',
        ],
      },
    ],
  },
  {
    version: '1.4',
    date: 'March 30, 2026',
    sections: [
      {
        heading: 'Rebranding',
        items: ['Renamed main title from "Statistical PERT\u00AE" to "SPERT\u00AE Suite"'],
      },
    ],
  },
  {
    version: '1.3',
    date: 'March 16, 2026',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Added "I Have a Request" form for feature ideas and improvement suggestions (Formspree integration)',
          'Added "I Found a Bug" form for bug reports across all SPERT web apps (Formspree integration)',
          'Added "Support" section on the homepage grouping Contact Me, I Have a Request, and I Found a Bug tiles',
          'Both new forms include an optional multi-select checkbox for specifying which app(s) the submission relates to',
        ],
      },
      {
        heading: 'Improvements',
        items: [
          'Extracted shared FormPageShell component to eliminate duplication across all three form pages',
          'Added category field to app data for separating main apps from support tiles',
        ],
      },
    ],
  },
  {
    version: '1.2.3',
    date: 'March 11, 2026',
    sections: [
      {
        heading: 'Infrastructure',
        items: [
          'Pinned Vercel deployment target to Node.js 22 LTS ahead of Node 20 EOL (April 30, 2026)',
          'Added engines field to package.json requiring Node >= 22',
          'Added .nvmrc for consistent Node version across environments',
          'Updated @types/node from ^20 to ^22',
        ],
      },
    ],
  },
  {
    version: '1.2.2',
    date: 'March 11, 2026',
    sections: [
      {
        heading: 'Improvements',
        items: [
          'Extracted shared form input styling constant to reduce duplication in contact form',
        ],
      },
      {
        heading: 'Dependencies',
        items: [
          'Updated react and react-dom to 19.2.4',
          'Updated devDependencies to latest compatible versions (tailwindcss 4.2, eslint 9.39)',
        ],
      },
    ],
  },
  {
    version: '1.2.1',
    date: 'March 11, 2026',
    sections: [
      {
        heading: 'Improvements',
        items: [
          'Extracted reusable Header and Footer components to reduce duplication across pages',
          'Centralized app version constant in src/config.ts',
          'Fixed duplicate ThemeMode type definition',
          'Fixed pre-existing lint error in useTheme hook (replaced useState mounted pattern with useSyncExternalStore)',
          'Updated README with correct app names and URLs',
          'Upgraded @types/react-dom and typescript to latest stable versions',
        ],
      },
      {
        heading: 'Security',
        items: [
          'Added HTTP security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy)',
          'Patched transitive dependency vulnerabilities (minimatch, ajv) via npm audit fix',
        ],
      },
    ],
  },
  {
    version: '1.2',
    date: 'March 11, 2026',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Added Terms of Service and Privacy Policy as canonical PDFs served from this site',
          'Added legal document links (Terms of Service, Privacy Policy) to footer on all pages',
        ],
      },
    ],
  },
  {
    version: '1.1.3',
    date: 'March 10, 2026',
    sections: [
      {
        heading: 'Changes',
        items: [
          'Renamed "CFD Laboratory" tile to "SPERT\u00AE CFD"',
          'Added changelog page with version history',
          'Footer version number now links to changelog',
        ],
      },
    ],
  },
  {
    version: '1.1.2',
    date: 'March 10, 2026',
    sections: [
      {
        heading: 'Changes',
        items: [
          'Renamed "SPERT\u00AE Release Forecaster" tile to "SPERT\u00AE Forecaster"',
          'Updated SPERT Forecaster URL to spert-forecaster.vercel.app',
        ],
      },
    ],
  },
  {
    version: '1.1.1',
    date: 'March 10, 2026',
    sections: [
      {
        heading: 'Changes',
        items: [
          'Updated intro blurb to remove local-only data claim for cloud storage compatibility',
        ],
      },
    ],
  },
  {
    version: '1.1',
    date: 'March 10, 2026',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Added SPERT\u00AE Story Map tile (agile user story mapping for release planning)',
        ],
      },
    ],
  },
  {
    version: '1.0',
    date: 'March 8, 2026',
    sections: [
      {
        heading: 'New Features',
        items: [
          'Initial release with five app tiles: SPERT\u00AE Release Forecaster, GanttApp\u2122, SPERT\u00AE Scheduler, CFD Laboratory, MyScrumBudget\u2122',
          'Contact Me tile with Formspree-powered contact form',
          'Dark/light/system theme toggle with anti-flash script',
          'Responsive tile grid (1 column mobile, 2 tablet, 3 desktop)',
          'Branded header with blue gradient and "Estimation Made Easy\u00AE" tagline',
        ],
      },
    ],
  },
];
