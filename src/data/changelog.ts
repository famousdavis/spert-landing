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
    version: '2.5.25',
    date: 'August 24, 2026',
    sections: [
      {
        heading: 'Infrastructure',
        items: [
          'The record of which fields each app writes has been re-scoped, and the disagreement noted last release is settled. One entry claimed an app both does and does not write the same key. Neither half was wrong on its own: the two neighbouring fields were simply counting different things, one looking at every way the app can write to that collection and the other at a single routine save. The wider of the two now counts every write path, which is what the narrower one was always compared against.',
          'The other field, the one that records the smallest write an app makes, has deliberately not been changed to match. A largest-of is well behaved when you widen what it covers; a smallest-of is not, because it collapses to whatever the tiniest write in the whole app happens to be, and then it no longer tests anything. Instead each entry now names the specific write it was measured against, because the honest answer differs from app to app: for some it is a routine save, for one it is a rule the app has to satisfy rather than any code, and for another it is a deliberate decision about what to leave out. A previous attempt to state one rule covering all of them was wrong for five.',
          'While re-scoping it, every entry claiming an app writes the whole of its permitted field list was checked against the app itself, two of them field by field and the rest by sampling the least likely fields. All of them held. The comments that had gone out of date were corrected in the same pass, including one that named the wrong function as the widest writer.',
        ],
      },
    ],
  },
  {
    version: '2.5.24',
    date: 'August 24, 2026',
    sections: [
      {
        heading: 'Infrastructure',
        items: [
          'A note, and nothing else. Alongside the record of which fields each app deletes, this repository keeps a record of which fields each app writes. The second one has not been re-checked against the apps yet, and doing it in the same release as the first would have been a mistake — both records feed the same tests, so if anything had gone wrong there would have been no way to tell which of the two changes caused it.',
          'That decision is now written down where the next person to pick the work up will find it, together with the thing that has to be sorted out first: the two records disagree with each other about whether the list of collaborators counts as a field the app writes. One app\u2019s entry says yes, another\u2019s says no. Both have been shipped that way for a while and neither is causing a problem, but they cannot both be the rule, and that needs settling before the record is re-checked rather than discovered halfway through.',
        ],
      },
    ],
  },
  {
    version: '2.5.23',
    date: 'August 24, 2026',
    sections: [
      {
        heading: 'Infrastructure',
        items: [
          'Nothing in this release changes what the apps do. It corrects a record that was wrong, and adds two checks that go off if it ever goes wrong the same way again.',
          'Each app keeps a list of who may work on a project. When someone is removed, the app does not overwrite that list — it sends a specific instruction to delete just that one person\u2019s entry, so that two people removing different collaborators at the same time cannot undo each other. All seven apps do it exactly this way.',
          'This repository keeps a written record of which fields each app deletes like that, and a test reads the record to decide what to check. The record said only two of the seven apps ever delete anything. It was written that way in a release that added the lists for those two apps and filled in a blank for the other eleven entries without going and looking. So for five of the seven apps the test had nothing to check, and it did not complain, because a check that was never created and a check that passed look exactly alike from the outside.',
          'The record has now been re-derived by reading all seven apps\u2019 own source code, and the five missing entries are filled in. The test that had been covering two deletion paths now covers all seven, and all seven pass — the rules were always accepting these deletions correctly, so nothing was broken for anyone. What was broken was the evidence that they were.',
          'Two new checks were added so this cannot recur quietly. The first says that every app holding a collaborator list must declare that it deletes from it — that is true of all seven today, and it would have failed on the day the record was written. The second catches the mirror-image mistake: an entry can be recorded against a part of the rules the test is unable to exercise, where it would again sit there checking nothing. Four of the thirteen entries are in that position today, all of them correctly blank, and the check makes sure it stays that way.',
          'A third gap was closed in the test itself. It confirmed a deletion by looking for the field afterwards and finding it gone — but a field that was never there in the first place is also gone, and the two are indistinguishable. It now also confirms the field was present before the deletion, and that confirmation deliberately sits in the part of the suite that checks the test\u2019s own setup, so that a problem with the setup cannot be mistaken for a problem with the rules.',
          'Finally, a note explains why a related record was considered and deliberately not created — including the reason that decides it, which is that it could not have been filled in correctly from where the reading is done. Writing the reason down means the idea does not have to be worked through from scratch a third time.',
        ],
      },
    ],
  },
  {
    version: '2.5.22',
    date: 'August 24, 2026',
    sections: [
      {
        heading: 'Infrastructure',
        items: [
          'Nothing in this release changes what the apps do. It adds checks around a question that was asked, measured and answered "no problem" — so that if the answer ever changes, something says so.',
          'The rules deciding what may be saved to each app’s records work by listing the field names that are allowed and refusing anything else. Alongside ordinary saves, which send a value, the database also accepts saves that send an instruction instead — "add this item to that list", "add one to that number", "put the current time here". The database works the instruction out on its own side. The question was whether the rules can still see which field is being written when the save arrives in that form. If they could not, every one of those permitted-field lists could be walked straight around by anyone who sent instructions rather than values, and none of them would have been protecting anything.',
          'They can see it. Eight outcomes were written down in advance and all eight came out as predicted, against the real rules, on two different days by two different people working separately. There is no hole here and no rule was changed.',
          'What the release adds is the alarm. The rules ask their question in two different ways depending on whether a record is being created or edited, and there are three kinds of instruction a save can carry, so six refusals are now checked — every combination of the two and the three. Alongside them sit two acceptances, and those matter more than they look: a database that quietly discarded the instruction would also have accepted the save, and an accepted save proves nothing on its own. So both acceptances read the saved record back afterwards and confirm the value actually arrived.',
          'They are deliberately not repeated for each of the lists. Doing that would have produced twenty checks covering one of the three kinds of instruction and none of the other two — more cases, less of the thing that could actually vary. Where a save is refused, it is refused for naming a field that is not permitted, and a field that is not permitted is not permitted anywhere. The part that does vary got the coverage.',
          'There are fourteen of these permitted-field lists. Thirteen are checked together in one place; the fourteenth keeps its own separate set of checks, because it is the one that silently rejected every saved snapshot in the Gantt app for seven days and its checks were written around that. Two matching cases were added there so that no list in the rules is left without one. They are labelled in place as being there for completeness rather than because they prove anything the other six do not — otherwise someone finds them in six months, works out that they add nothing, and removes them.',
          'One correction. A note recording where one of these lists came from named three places in the Cumulative Flow app that write to it and left out a fourth, which had been writing to it since long before the note was made. The missing name was added. The note’s date and version stamp were deliberately left alone: the field list it records was read correctly at the time, only the list of names was short, and re-stamping it would have made a statement at the top of that same file — that everything in it was read on one particular day — untrue for that one entry.',
        ],
      },
    ],
  },
  {
    version: '2.5.21',
    date: 'August 22, 2026',
    sections: [
      {
        heading: 'Infrastructure',
        items: [
          'Nothing in this release changes what the apps do. It removes a false statement from the top of the shared release-checking script, and adds two explanations that were missing beside it.',
          'The script that checks a release before it ships is deliberately the same file in all nine projects. The note at the top of it said there was no automated checking anywhere in the suite — that a green tick on a proposed change meant only that a preview copy of the site had been built, and that nothing ran the tests. That has not been true since the script existed. Automated checking runs on every one of the nine projects, on every proposed change and on every merge, and what it runs is this very script.',
          'The statement did not go out of date. It was untrue on the day it was written: the same set of edits that added the script also switched the automated checking on, so the file contradicted a change sitting beside it. That distinction decides the remedy, which is why it is recorded here. A statement that decays can be helped by writing down when it was made; a statement that was never true cannot. What went wrong was that a claim about the projects was written into an explanation without being checked against them — and an explanation is read as background rather than as an assertion somebody has to verify.',
          'The cost of leaving it was small each time and unbounded in total. Anyone reading the note would discount a real signal, or repeat work that had already been checked: a sensible-looking pause resting on a false premise, which produces no error and simply spends a round trip.',
          'Two explanations were added while the file was open. The first records that automated checking and a check run by hand are complementary rather than ranked. The automated one works from a clean copy, so it catches anything that quietly depends on a file existing only on the author’s own machine; but it also has less of the project to look at, so certain checks step aside there and only a hand-run finds what those cover.',
          'The second explains how the code-style step is judged. That step compares the number of reported issues against an agreed figure instead of reading pass or fail, and it does so for opposite reasons in different projects: in most of them the step reports failure at the agreed figure, so reading pass-or-fail would be too strict; in one it reports success at the agreed figure, so reading pass-or-fail would be too lenient and would let new issues through unnoticed. One mechanism, two reasons. The note also warns that the figure counts every kind of issue rather than the one kind a project set it for, and that when it reaches zero the setting must be removed rather than set to zero — at zero the tool prints no count at all, and the step then fails asking for a number that was never printed.',
          'Four notes in other projects pointed at this file by line number, and adding lines to the top moved all of them. They now name the part of the script they mean instead of a position in it. A stale line number is worse than a missing one: it lands on real code, so a reader who follows it finds something plausible and concludes the reference was sound. One of the four was written the day before this release and had already gone stale by the time it shipped, which is the argument in miniature.',
          'Predictions were recorded before anything was measured, and reported against afterwards. That the change would add twenty-four lines and touch nothing but comments held exactly, although the predicted split between lines added and lines removed was two out, because two unchanged lines had been counted as replaced. That no project’s checks would fail because of the change held. And that the false statement was not repeated in wording of its own anywhere else held — but only on the second attempt, because the first search returned nothing at all, including the nine copies it was certain to find, which showed the search was broken rather than the projects clean.',
        ],
      },
    ],
  },
  {
    version: '2.5.20',
    date: 'August 21, 2026',
    sections: [
      {
        heading: 'Infrastructure',
        items: [
          'Nothing in this release changes what the apps do. It corrects a date on this page, and adds the check that would have caught it.',
          'The previous release was dated August 20. It was written at three minutes past one in the morning on August 21, so the date was a day early — carried forward from the release before it rather than mistyped. Nothing on this site computes from these dates, so the cost was cosmetic. The way it happened is not, because the usual remedy is a line on a release checklist, and a checklist line is exactly the kind of control that quietly stops being followed.',
          'A check now compares the newest entry on this page against the moment its own change was recorded, and refuses a date that is not the same calendar day. It refuses a date one day early and one day late alike — a check catching only one direction would miss half the mistake. It also refuses a misspelled month, because the tool used to read the date accepts "Augustt" and "Auggust" as August without complaint; the date must now be written back exactly as it was given.',
          'The check runs only on the machine where the release is written, and that is a limitation rather than an oversight. Merging a change to this site discards the record of which timezone its author was in, so afterwards the correct local date genuinely cannot be recovered — no setting brings it back. Running the check on the build servers instead would compare a date written in one timezone against a clock keeping another. That reasoning is recorded beside the check itself, so anyone tempted to switch it on later reads why it cannot work rather than assuming nobody tried.',
          'Separately, a maintenance script comparing the database rules against their one surviving copy printed a nonsense location when pointed at a local file: it appended a filename to a path that already ended in one. Both of its reporting modes now describe their source correctly.',
          'Five things were confirmed against a recorded prediction before this shipped: that the check fails on the very date it was built for and stops failing only once that date is corrected; that it fails one day early and one day late; that the misspelling test catches what the date test cannot, with the date test confirmed to pass the same misspelling; that the check steps aside and names its reason on a build server, outside a repository, and with the version-control tool missing entirely — each of those three produced for real rather than simulated; and that the script fix changed only the reporting mode that was wrong, leaving the other byte-for-byte identical.',
        ],
      },
    ],
  },
  {
    version: '2.5.19',
    date: 'August 21, 2026',
    sections: [
      {
        heading: 'Infrastructure',
        items: [
          'Nothing in this release changes what the apps do. It puts a scheduled check on a second copy of the database rules that had been quietly falling out of date.',
          'The rules deciding who may read and write each project live in one place. A second copy is kept inside the Scheduler project, because a test there reads it to confirm that every setting the app saves is actually one the rules permit — a real guard, and the whole reason that copy exists. But nothing was watching the copy itself. It has fallen behind three times now, and every time the only reason anyone found out was a person comparing the two files by hand.',
          'A check now makes that comparison automatically, every six hours and again whenever the rules themselves are edited — so the person creating the gap hears about it rather than someone else discovering it later. It ignores the explanatory comments in both files deliberately. The two are meant to carry different notes, and that difference already accounts for roughly three hundred lines; counting it would bury the thirty-four that actually matter.',
          'This release reports the gap rather than closing it. The copy is currently behind by the two limits added in the previous release, so the check is expected to read red until a separate change to the Scheduler project brings it back in line. That is said plainly here, because a check that is red the day it arrives is exactly the kind that gets ignored instead of fixed.',
          'Five things were confirmed before this shipped, each against a recorded prediction: that it reports the real gap and gets the same answer as the standard comparison tool; that it stays silent on two files whose notes differ but whose rules agree; that editing a comment alone does not set it off; that the step which makes it ignore only the right comments is doing work, even though removing it appears to change nothing today; and that it fails loudly rather than quietly passing when it cannot read the other file at all.',
        ],
      },
    ],
  },
  {
    version: '2.5.18',
    date: 'August 20, 2026',
    sections: [
      {
        heading: 'Infrastructure',
        items: [
          'Nothing in this release changes what the apps do. It repairs the notes that explain the database rules, and adds a check so the same decay cannot set in again unnoticed.',
          'The database rules for all seven apps live in one place, and their comments explain themselves by pointing at the app code that writes each collection. That app code lives in separate projects. Until now those notes pointed at specific line numbers — and a line number in someone else\'s project stops being true the moment that project is edited for any unrelated reason. One recent change to a single file moved every note aimed below it by forty-eight lines, all at once and with no warning. The worst case found was a note off by a hundred and thirty-five lines: it named a line that no longer had anything to do with what the note described.',
          'Every one of those notes now names the function it means instead of a line number. A function keeps its name across edits, and if someone does rename it the reference breaks loudly and gets fixed, rather than quietly pointing at the wrong code and misleading whoever reads it next.',
          'A new check refuses to let a line number aimed at a file this project does not contain be added again. It works by asking whether the file named actually exists here, so notes pointing within this project — which are checked separately and are genuinely useful — keep working untouched. Both halves were confirmed: adding a note of the bad kind makes the check fail and names it; adding one of the good kind does not.',
          'Two notes also claimed a safeguard in the AHP app did not exist. It was built the day before this release, so the claim had gone stale; a third copy of the same claim was found during the sweep. All three now describe the safeguard, and record the two gaps it does not cover so no one reads more assurance into it than is there.',
        ],
      },
    ],
  },
  {
    version: '2.5.17',
    date: 'August 20, 2026',
    sections: [
      {
        heading: 'Security',
        items: [
          'Two of the seven apps — SPERT® Forecaster and SPERT® AHP — let anyone with access to a project save any piece of information they liked into it. Access itself was never in question: you still had to be a member of the project, and only an owner could change who could see it or who owned it. But once you were in, nothing limited what could be stored alongside the real data. The other five apps have had that limit since May; these two were missed at the time.',
          'Each of the two now has a list of exactly the information it uses, and the database refuses anything outside it. Nothing about who may open, change, share or delete a project has changed — only what may be kept inside one. Nothing was exploited; this closes a gap rather than repairing damage.',
          'Getting this wrong in the other direction is the real hazard, and it is worth saying how it was avoided. A list that is too short produces no error message: it makes every save fail silently, for every user, immediately. So each list was built by reading every place its app writes to the database — five places in Forecaster and thirteen in AHP, five of them written in a form that an ordinary search for the usual save commands does not find at all. The tests confirming that a normal save still works were written and run BEFORE the new limits went in, so the release rests on a recorded before-and-after rather than on an assurance.',
          'One piece of information in AHP came close to being left out. The setting controlling what participants see on the Results tab never appears by name in the code that saves it — it travels through a general-purpose routine that forwards whatever it is handed, so searching for it finds only a type definition and a default value. Had it been omitted, every change to that setting would have failed silently. It is on the list, and the reason it looks absent is now recorded beside it.',
          'Confirmed by removing a single permitted item from one of the two new lists and checking that exactly the two affected tests failed, on that one app, while the other twelve lists and every other test carried on passing — then restoring the file and verifying it was byte-for-byte unchanged.',
        ],
      },
      {
        heading: 'Changed',
        items: [
          'The database rules file described its own release process incorrectly. It said it was a copy of what had been pasted into the Firebase console by hand, which stopped being true in August: the repository is now the original, and the live database follows it automatically whenever a change is merged. That description has been corrected, and so has a second note claiming one app was the only one missing the limits described above — it was not, which is what this release is about.',
        ],
      },
    ],
  },
  {
    version: '2.5.16',
    date: 'August 20, 2026',
    sections: [
      {
        heading: 'Security',
        items: [
          'The rules governing the shared database keep twelve separate lists of which pieces of information each app is allowed to save. Until now only one of those lists was tested. A mistake in any of the other eleven — a list that no longer matches what its app actually writes — would have stopped that app saving, silently and every time, with nothing anywhere reporting a problem. That is not a hypothetical: it is exactly what happened to the twelfth list in the previous release, and it went unnoticed for seven days.',
          'All eleven are now covered. For each one, the tests confirm that a save carrying every permitted piece of information is accepted, that the smaller save an app makes when optional details are absent is also accepted, and that a save carrying anything unrecognised is still refused — on each operation the rule governs, since saving a new item and changing an existing one are separate rules that can fail independently. The tests also confirm that permission to save was not widened along the way: someone who is not a member of a project still cannot write to it, and a collaborator still cannot promote themselves to owner.',
          'The list of what each app writes was read from the apps themselves and recorded here alongside the exact function it came from, the version, and the commit — so a later review can tell how old that reading is rather than merely that it is a copy. At the time of reading, every one of the twelve matched.',
          'What this does and does not do is worth being plain about. It catches a rule tightened past what an app already saves. It cannot catch the reverse — an app adding something new that the rules were never told about, which is what caused the previous release’s fault. Closing that half requires checks inside the apps and is not something this release claims to have done.',
          'Confirmed by removing a single permitted item from one of the twelve lists and checking that exactly the three affected tests failed, on precisely that one list, while the other eleven and every other test carried on passing — then restoring the file and verifying it was byte-for-byte unchanged.',
        ],
      },
    ],
  },
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
