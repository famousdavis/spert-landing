// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * The SPERT® Suite Approval Kit, as published at /approval-kit.
 *
 * The page renders from this module and src/guards/approval-kit.test.ts checks
 * it against the files in public/, so the two cannot drift apart. The files are
 * copied byte-for-byte from the release zip: never edit, re-export or rename
 * one. A new version gets its own folder and its own entry here; older folders
 * stay where they are, because the kit's PDFs link to their own version.
 */

export interface KitDocument {
  /** The file name without its extension; each document ships as .pdf and .docx. */
  file: string;
  name: string;
  /** Verbatim from the CONTENTS section of the kit's README.txt. */
  description: string;
  /** Who the document is for (the kit build's metadata, as the Guide lists it). */
  audience: string;
  /** "template" when the file name contains "Template" (README.txt); "example" for the invented example. */
  use: 'template' | 'forward' | 'read' | 'example';
  pages: number;
}

export interface ApprovalKit {
  version: string;
  /** The date the kit's content was reviewed, as printed under each document's title. */
  reviewed: string;
  /** Earlier versions, still served from their own folders; never removed. */
  earlier: readonly string[];
  zip: { file: string; bytes: number; sha256: string };
  documents: readonly KitDocument[];
}

export const APPROVAL_KIT: ApprovalKit = {
  version: '2.0.1',
  reviewed: '2026-11-19',
  earlier: ['1.0.0', '2.0.0'],
  zip: {
    file: 'SPERT-Suite-Approval-Kit-v2.0.1.zip',
    bytes: 10059133,
    sha256: '6176d8ac55dde155f560cf83ebba0c211b5f9f1319049e90509af8ad4dd5ee90',
  },
  /** In the order of the README's CONTENTS. */
  documents: [
    {
      file: 'SPERT-Approval-Kit_Reviewer-Summary',
      name: 'Reviewer Summary',
      description:
        'Two-page overview for reviewers: what SPERT® Suite is, the three tiers, key facts and gaps, and where to read more',
      audience: 'Every reviewer, as the first thing you send',
      use: 'forward',
      pages: 2,
    },
    {
      file: 'SPERT-Approval-Kit_Guide',
      name: 'Guide',
      description:
        'How a project manager runs an approval process: the smallest set of documents for each request, who to engage and in what order, and how to answer each reviewer',
      audience: 'You, the project manager',
      use: 'read',
      pages: 9,
    },
    {
      file: 'SPERT-Approval-Kit_Template-Approval-Pathway-Checklist',
      name: 'Approval Pathway Checklist',
      description:
        'Fill-in template: every approval step, the decision for each app and feature, its conditions, and the exit tasks',
      audience: 'You and your sponsor',
      use: 'template',
      pages: 5,
    },
    {
      file: 'SPERT-Approval-Kit_Template-Value-Brief',
      name: 'Value Brief',
      description:
        'Two-page fill-in template: the problem, the pilot, fit with existing tools, costs, measurable success criteria, risks and exit',
      audience: 'Your sponsor, manager, procurement',
      use: 'template',
      pages: 2,
    },
    {
      file: 'SPERT-Approval-Kit_Template-Information-Security-Profile',
      name: 'Information Security Profile',
      description:
        'Fill-in template: controls, gaps, risk decisions by owner and date, and attestation by app and feature, for information security and privacy reviewers',
      audience: 'Information security, privacy',
      use: 'template',
      pages: 14,
    },
    {
      file: 'SPERT-Approval-Kit_Template-Data-Flow-Diagram',
      name: 'Data Flow Diagram',
      description:
        "Fill-in template: data flows per tier, Connect AI snapshot contents and sessions, an endpoint matrix, and the organization's own controls",
      audience: 'Architecture, information security, AI governance',
      use: 'template',
      pages: 10,
    },
    {
      file: 'SPERT-Approval-Kit_Template-Reviewer-FAQ',
      name: 'Reviewer FAQ',
      description:
        'Fill-in template: short, sourced answers to the questions each reviewer asks',
      audience: 'All reviewers',
      use: 'template',
      pages: 6,
    },
    {
      file: 'SPERT-Approval-Kit_Architecture-Overview',
      name: 'Architecture Overview',
      description:
        'Components, data flows, trust boundaries and controls for architecture, security and privacy reviewers',
      audience: 'Architecture, information security, privacy',
      use: 'forward',
      pages: 13,
    },
    {
      file: 'SPERT-Approval-Kit_Connect-AI-Data-Explainer',
      name: 'Connect AI Data Explainer',
      description:
        'What Connect AI sends and to whom, what the AI can change, and how long data is kept, for all three apps that offer it',
      audience: 'Information security, privacy and AI governance',
      use: 'forward',
      pages: 7,
    },
    {
      file: 'SPERT-Approval-Kit_Scheduler-Security-Questionnaire-Answers',
      name: 'Scheduler Security Questionnaire Answers',
      description:
        'Draft answers to common vendor security questionnaire topics for SPERT® Scheduler, each with its control status and evidence',
      audience: 'Information security',
      use: 'forward',
      pages: 15,
    },
    {
      file: 'SPERT-Approval-Kit_App-and-Feature-Reference',
      name: 'App and Feature Reference',
      description:
        'The six apps, how each stores data and what sign-out does, export formats, headers, and every Connect AI tool',
      audience: 'Enterprise architecture, information security, and the project manager',
      use: 'forward',
      pages: 6,
    },
    {
      file: 'SPERT-Approval-Kit_Example-Completed-Request',
      name: 'Example Completed Request',
      description:
        'A fictional, filled-in request showing a completed decision record by app and feature, conditions, success measures, gap decisions and exit plan',
      audience: 'You, the project manager',
      use: 'example',
      pages: 3,
    },
    {
      file: 'SPERT-Approval-Kit_Evidence-Register',
      name: 'Evidence Register',
      description:
        'The facts register behind the kit: each product fact with its scope, source, revision, kind of evidence and verification date',
      audience: 'Any reviewer who wants to check a claim',
      use: 'forward',
      pages: 23,
    },
  ],
};

/** Where this version's files are served from (public/approval-kit/v<version>/). */
export const APPROVAL_KIT_BASE = `/approval-kit/v${APPROVAL_KIT.version}`;
