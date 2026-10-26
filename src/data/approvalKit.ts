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
  /** From the "Who it is for" column of the Guide's section 1. */
  audience: string;
  /** "template" when the file name contains "Template" (README.txt). */
  use: 'template' | 'forward' | 'read';
  pages: number;
}

export interface ApprovalKit {
  version: string;
  /** The date the kit's content was reviewed, as printed under each document's title. */
  reviewed: string;
  zip: { file: string; bytes: number; sha256: string };
  documents: readonly KitDocument[];
}

export const APPROVAL_KIT: ApprovalKit = {
  version: '1.0.0',
  reviewed: '2026-10-25',
  zip: {
    file: 'SPERT-Suite-Approval-Kit-v1.0.0.zip',
    bytes: 2810977,
    sha256: '3d759e84d24c911c8cdff34ccd2029db18e0f3ef00d7e0366ed04355d3ee285a',
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
        'How a project manager runs an approval process: who to engage, in what order, and how to answer each reviewer',
      audience: 'You, the project manager',
      use: 'read',
      pages: 8,
    },
    {
      file: 'SPERT-Approval-Kit_Template-Approval-Pathway-Checklist',
      name: 'Approval Pathway Checklist',
      description: 'Fill-in template: every approval step, owner, date and decision in one place',
      audience: 'You and your sponsor',
      use: 'template',
      pages: 3,
    },
    {
      file: 'SPERT-Approval-Kit_Template-Value-Brief',
      name: 'Value Brief',
      description:
        'Fill-in template: the problem, the pilot, how it fits with existing tools, cost, risks and exit',
      audience: 'Your sponsor, manager, procurement',
      use: 'template',
      pages: 4,
    },
    {
      file: 'SPERT-Approval-Kit_Template-Information-Security-Profile',
      name: 'Information Security Profile',
      description:
        'Fill-in template: controls, gaps, approval scope and attestation, for information security and privacy reviewers',
      audience: 'Information security, privacy',
      use: 'template',
      pages: 10,
    },
    {
      file: 'SPERT-Approval-Kit_Template-Data-Flow-Diagram',
      name: 'Data Flow Diagram',
      description:
        "Fill-in template: data flows per tier, Connect AI snapshot contents and tools, and the organization's own controls",
      audience: 'Architecture, information security, AI governance',
      use: 'template',
      pages: 10,
    },
    {
      file: 'SPERT-Approval-Kit_Template-Reviewer-FAQ',
      name: 'Reviewer FAQ',
      description: 'Fill-in template: short, sourced answers to the questions each reviewer asks',
      audience: 'All reviewers',
      use: 'template',
      pages: 4,
    },
    {
      file: 'SPERT-Approval-Kit_Architecture-Overview',
      name: 'Architecture Overview',
      description:
        'Components, data flows and trust boundaries for architecture, security and privacy reviewers',
      audience: 'Architecture, information security, privacy',
      use: 'forward',
      pages: 12,
    },
    {
      file: 'SPERT-Approval-Kit_Security-Questionnaire-Answers',
      name: 'Security Questionnaire Answers',
      description:
        "Draft answers to common vendor security questionnaire topics, for [ORGANIZATION]'s reviewers",
      audience: 'Information security',
      use: 'forward',
      pages: 14,
    },
    {
      file: 'SPERT-Approval-Kit_Connect-AI-Data-Explainer',
      name: 'Connect AI Data Explainer',
      description:
        'A one-document briefing for information security, privacy and architecture reviewers',
      audience: 'Privacy, AI governance',
      use: 'forward',
      pages: 3,
    },
  ],
};

/** Where this version's files are served from (public/approval-kit/v<version>/). */
export const APPROVAL_KIT_BASE = `/approval-kit/v${APPROVAL_KIT.version}`;
