// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { CopyButton } from '@/components/CopyButton';
import { formatName } from '@/components/formatName';
import { DataAndPrivacy, PdfLink, StillStuck } from '@/components/HelpSections';
import { LINK_CLASS, LIST_CLASS, SECTION_HEADING_CLASS, TEXT_CLASS } from '@/components/textStyles';
import {
  ASSISTANTS,
  CONNECT_AI_PATH,
  CONNECTION_NAME,
  MCP_SERVER_URL,
  OTHER_ASSISTANTS_ID,
  type AssistantSection,
} from '@/data/connectAi';
import { HELP_APPS, connectAiGuide, guideUrl } from '@/data/help';

/**
 * /help/connect-ai (2.15.0): how to add the SPERT Suite MCP server to each AI
 * assistant, once, before a first Connect AI session. A fixed route beside
 * /help/[app]; Next serves it ahead of the dynamic segment, and G13 keeps any
 * app slug from ever taking the name.
 *
 * The address is never written out here: it comes from MCP_SERVER_URL (G15).
 */

export const metadata: Metadata = {
  title: 'Connect Your AI Assistant | SPERT® Suite',
  description:
    'Add SPERT® Suite to Claude, ChatGPT, Gemini, Grok, Claude Code or Copilot Studio once, then use Connect AI in the SPERT® apps.',
  // Per page, never in layout.tsx, where it would spread to every page.
  alternates: { canonical: CONNECT_AI_PATH },
};

const CODE_CLASS =
  'rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.8125rem] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200';
const STEPS_CLASS = 'list-decimal pl-6 space-y-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400';
const NOTE_CLASS = `mt-2 ${TEXT_CLASS}`;

/** A label the reader will see on screen: a menu, button or field name. */
function Ui({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-zinc-800 dark:text-zinc-200">{children}</strong>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className={CODE_CLASS}>{children}</code>;
}

/** The server address, as it appears in every assistant's steps. */
function Address() {
  return <Code>{MCP_SERVER_URL}</Code>;
}

function Name() {
  return <Ui>{CONNECTION_NAME}</Ui>;
}

/** A labelled paragraph inside an assistant's section: "Who can add it", "To use it". */
function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className={NOTE_CLASS}>
      <span className="font-semibold text-zinc-700 dark:text-zinc-300">{label}:</span> {children}
    </p>
  );
}

const CLAUDE_CODE_COMMAND = `claude mcp add --transport http --scope user spert-suite ${MCP_SERVER_URL}`;

/** Each assistant's steps, by its section id. A missing entry fails the build (see AssistantBlock). */
const STEPS: Record<string, ReactNode> = {
  claude: (
    <>
      <Part label="Who can add it">
        Any plan, including Free. The Free plan allows one custom connector. On the web at claude.ai or in the
        Claude desktop app.
      </Part>
      <ol className={`mt-2 ${STEPS_CLASS}`}>
        <li>
          Go to <Ui>Customize → Connectors</Ui>.
        </li>
        <li>
          Click <Ui>+ Add</Ui>, then <Ui>Add custom connector</Ui>.
        </li>
        <li>
          Name it <Name /> and paste <Address /> as the URL.
        </li>
        <li>
          Click <Ui>Continue</Ui> through the next screens. For Authentication, choose <Ui>No sign in</Ui>. Finish
          with <Ui>Add</Ui>.
        </li>
      </ol>
      <Part label="On a Team or Enterprise plan">
        an Owner or Primary Owner adds it first, under <Ui>Organization settings → Connectors → Add → Custom → Web</Ui>, with the
        same name and address and <Ui>No sign in</Ui>. Each member then opens <Ui>Customize → Connectors</Ui>, finds{' '}
        <Name /> (marked Custom) and clicks <Ui>Connect</Ui>.
      </Part>
      <Part label="To use it">
        in a new conversation, click <Ui>+</Ui> (lower left) → <Ui>Connectors</Ui> and make sure <Name /> is switched
        on. Then paste the prompt from Connect AI.
      </Part>
      <p className={NOTE_CLASS}>
        A connector added on claude.ai appears in the desktop app too, and in Claude Code if you sign in with the
        same account. There is no second setup.
      </p>
    </>
  ),

  chatgpt: (
    <>
      <Part label="Who can add it">
        On Pro, you add it yourself. On Business, a workspace admin or owner adds it once; on Enterprise and
        Edu, so can a member they authorise. On the web only.
      </Part>
      <p className={NOTE_CLASS}>
        What we&rsquo;ve seen versus what OpenAI says: OpenAI&rsquo;s documentation says Pro can use custom servers
        only &ldquo;with read/fetch permissions&rdquo;. In our own use, ChatGPT Pro builds and changes story maps
        and schedules through SPERT Suite without trouble. OpenAI&rsquo;s documentation doesn&rsquo;t mention
        Plus, Free or Go, and we haven&rsquo;t tested them.
      </p>
      <Part label="Plan note">
        if your plan doesn&rsquo;t show <Ui>Plugins → Add custom MCP server</Ui>, it doesn&rsquo;t support custom
        servers.
      </Part>
      <ol className={`mt-2 ${STEPS_CLASS}`}>
        <li>
          Go to <Ui>Plugins → + → Add custom MCP server</Ui>.
        </li>
        <li>
          Name it <Name /> and paste <Address /> under <Ui>Connection</Ui>.
        </li>
        <li>
          Choose <Ui>No authentication</Ui>.
        </li>
        <li>
          Tick <Ui>I understand and want to continue</Ui>, then click <Ui>Create as a plugin</Ui>.
        </li>
        <li>
          Install the <Name /> plugin.
        </li>
      </ol>
      <Part label="To use it">
        start a new chat, type <Code>@</Code> and pick <Name />, then paste the prompt from Connect AI.
      </Part>
      <p className={NOTE_CLASS}>
        Pick <Name /> with <Code>@</Code> again in every later message that asks it to read or change your project.
        ChatGPT uses a plugin only in the message where you pick it. It may also ask you to confirm changes.
      </p>
    </>
  ),

  gemini: (
    <>
      <Part label="Who can add it">
        Personal Google accounts, free ones included, for people 18 or over in the US, with Gemini&rsquo;s History
        turned on. Not work or school accounts. You add it on the web, and it then works in the Gemini mobile app
        too.
      </Part>
      <ol className={`mt-2 ${STEPS_CLASS}`}>
        <li>
          On gemini.google.com, click <Ui>Customize</Ui>, then <Ui>Connectors</Ui>, then <Ui>+ Custom</Ui>.
        </li>
        <li>
          In <Ui>Connect to an MCP server</Ui>, paste <Address />. Leave <Ui>Additional settings</Ui> as they are, and
          click <Ui>Next</Ui>.
        </li>
        <li>
          Gemini explains what it will share with the app. Tick{' '}
          <Ui>I understand and accept the security and privacy risks of connecting this custom app</Ui>, and click{' '}
          <Ui>Connect</Ui>.
        </li>
        <li>
          In <Ui>Save your custom app</Ui>, Gemini suggests the name &ldquo;Spert Suite&rdquo;. Change it to <Name />,
          and click <Ui>Connect</Ui>.
        </li>
      </ol>
      <Part label="To use it">
        start a new chat, type <Code>@</Code> and pick <Name />, then paste the prompt from Connect AI.
      </Part>
      <p className={NOTE_CLASS}>
        The first time Gemini uses each of SPERT Suite&rsquo;s tools, it asks whether it may, with{' '}
        <Ui>Don&rsquo;t allow</Ui>, <Ui>Allow once</Ui> and <Ui>Always allow</Ui>. <Ui>Always allow</Ui> covers
        that one tool, so a first session asks several times and later sessions ask less.
      </p>
      <p className={NOTE_CLASS}>
        Google&rsquo;s help page describes a different path, <Ui>Settings → Connected Apps → Add a custom app</Ui>.
        Use whichever your screen shows.
      </p>
    </>
  ),

  grok: (
    <>
      <Part label="Who can add it">anyone with a Grok account. xAI names no plan limit.</Part>
      <ol className={`mt-2 ${STEPS_CLASS}`}>
        <li>Go to grok.com/connectors.</li>
        <li>
          Click <Ui>New Connector</Ui>, then <Ui>Custom</Ui>.
        </li>
        <li>
          Paste <Address /> and finish. No sign-in is needed.
        </li>
      </ol>
      <Part label="On Grok Business or Enterprise">
        a team admin adds it first, at console.x.ai: your team, then{' '}
        <Ui>Grok Business → Connectors → + Add Connector → Other</Ui>, with the address. Members then connect it at
        grok.com/connectors.
      </Part>
      <Part label="To use it">
        open a Grok conversation and paste the prompt from Connect AI. Grok uses connected tools by itself, so
        there is nothing to pick first.
      </Part>
    </>
  ),

  'claude-code': (
    <>
      <Part label="Who can add it">Pro, Max, Ultra, Team, Enterprise or Console accounts. Not the Free plan.</Part>
      <p className={NOTE_CLASS}>Run this once, on one line:</p>
      <div className="mt-2 flex items-start gap-3">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-zinc-100 px-3 py-2 font-mono text-[0.8125rem] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
          {CLAUDE_CODE_COMMAND}
        </pre>
        <CopyButton text={CLAUDE_CODE_COMMAND} label="Copy" />
      </div>
      <p className={NOTE_CLASS}>
        <Code>--scope user</Code> makes it available in every folder. Without it, it is added only for the folder
        you run the command in. Check it with <Code>claude mcp list</Code>: <Code>spert-suite</Code> should be
        listed as Connected.
      </p>
      <p className={NOTE_CLASS}>
        If you already added the connector on claude.ai and sign in to Claude Code with that account, it is there
        already. Check with <Code>/mcp</Code> in a session.
      </p>
      <Part label="To use it">start a Claude Code session and paste the prompt from Connect AI.</Part>
    </>
  ),

  'copilot-studio': (
    <>
      <Part label="Who can add it">
        Anyone with a Copilot Studio licence, or Copilot Studio&rsquo;s free trial, which needs a work or school
        email. A trial agent can be tested but not published. The Copilot Studio features bundled with ordinary
        Microsoft 365 plans don&rsquo;t include the connectors that MCP tools run on. At work, expect your IT
        department to be involved.
      </Part>
      <ol className={`mt-2 ${STEPS_CLASS}`}>
        <li>
          In a Copilot Studio agent, open <Ui>Tools → Add a tool → New tool → Model Context Protocol</Ui>.
        </li>
        <li>
          Fill in <Ui>Server name</Ui> (<Name />), <Ui>Server description</Ui> (for example, &ldquo;Builds and edits
          SPERT Story Map products and SPERT Scheduler projects, and reads SPERT Forecaster projects&rdquo;) and{' '}
          <Ui>Server URL</Ui> (<Address />).
        </li>
        <li>
          Set <Ui>Authentication</Ui> to <Ui>None</Ui> and click <Ui>Create</Ui>.
        </li>
        <li>
          Click <Ui>Create a new connection</Ui>, then <Ui>Add to agent</Ui>.
        </li>
      </ol>
      <p className={NOTE_CLASS}>
        Agents made in Copilot Studio&rsquo;s newer experience (still a preview) add it differently: on the{' '}
        <Ui>Build</Ui> tab, under <Ui>Tools</Ui>, click <Ui>Add</Ui> → <Ui>Model Context Protocol (MCP)</Ui>, fill
        in the same name, description, address and no authentication, click <Ui>Add</Ui>, review the tools, and
        click <Ui>Save</Ui>.
      </p>
      <Part label="To use it">
        paste the prompt from Connect AI into the agent&rsquo;s test panel.
      </Part>
      <Part label="To use it in Microsoft 365 Copilot or Teams">
        publish the agent, add the <Ui>Microsoft 365 and Microsoft Teams</Ui> channel, and tick{' '}
        <Ui>Make agent available in Microsoft Copilot</Ui>. To offer it to your whole organisation, submit it to
        the org catalog, where an admin approves it. Your organisation&rsquo;s data policies can also block MCP
        servers, so expect to involve IT.
      </Part>
    </>
  ),
};

function CheckedLine({ a }: { a: AssistantSection }) {
  return (
    <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
      {a.checked.how === 'tested'
        ? `Tested with SPERT Suite on ${a.checked.date}.`
        : a.checked.how === 'both'
          ? `Tested with SPERT Suite, and checked against ${a.maker}’s documentation on ${a.checked.date}.`
          : `Checked against ${a.maker}’s documentation on ${a.checked.date}.`}{' '}
      Screens change. If yours don&rsquo;t match,{' '}
      <Link href="/contact" className={LINK_CLASS}>
        tell me
      </Link>
      .
    </p>
  );
}

function AssistantBlock({ a }: { a: AssistantSection }) {
  const steps = STEPS[a.id];
  // Thrown at build time, when the page is prerendered: a section with no steps never ships.
  if (!steps) throw new Error(`/help/connect-ai: no steps for assistant "${a.id}"`);
  return (
    <section id={a.id} className="scroll-mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
      <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{a.name}</h4>
      {steps}
      <CheckedLine a={a} />
    </section>
  );
}

export default function ConnectAiPage() {
  const connectAiApps = HELP_APPS.flatMap((app) => {
    const guide = connectAiGuide(app);
    return guide ? [{ app, guide }] : [];
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-12 sm:px-8 md:py-16">
      <Header linkHome />

      <main id="main-content" className="max-w-2xl">
        <Link
          href="/help"
          className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
        >
          &larr; Help Center
        </Link>

        <h2 className="mb-2 text-xl font-bold text-zinc-900 dark:text-zinc-100">Connect your AI assistant</h2>
        <p className={TEXT_CLASS}>
          Connect AI lets an AI assistant work with you in{' '}
          {connectAiApps.map(({ app }, i) => (
            <span key={app.slug}>
              {i > 0 && (i === connectAiApps.length - 1 ? ' and ' : ', ')}
              <Link href={`/help/${app.slug}`} className={LINK_CLASS}>
                {formatName(app.name)}
              </Link>
            </span>
          ))}
          . Before your first session, add SPERT Suite to your assistant. You do this once, and it then works in
          every app that has Connect AI.
        </p>
        <p className={`mt-3 ${TEXT_CLASS}`}>
          SPERT Suite isn&rsquo;t listed in any assistant&rsquo;s directory or store, so you add it yourself, by its
          address. It takes a couple of minutes.
        </p>

        <section className="mt-6 rounded-lg border border-zinc-300 bg-zinc-50 p-4 dark:border-zinc-600 dark:bg-zinc-900">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">What your assistant will ask for</h3>
          <dl className="mt-3 space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            <div>
              <dt className="font-semibold text-zinc-700 dark:text-zinc-300">Address (URL)</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-3">
                <Address />
                <CopyButton text={MCP_SERVER_URL} label="Copy address" />
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-zinc-700 dark:text-zinc-300">Name</dt>
              <dd>{CONNECTION_NAME}</dd>
            </div>
            <div>
              <dt className="font-semibold text-zinc-700 dark:text-zinc-300">Sign-in (authentication)</dt>
              <dd>None. SPERT Suite never asks for an account or a password.</dd>
            </div>
            <div>
              <dt className="font-semibold text-zinc-700 dark:text-zinc-300">Connection type, if it asks</dt>
              <dd>HTTP, sometimes called Streamable HTTP. Not SSE.</dd>
            </div>
          </dl>
        </section>

        <section>
          <h3 className={SECTION_HEADING_CLASS}>Pick your assistant</h3>
          <p className={TEXT_CLASS}>Each assistant has its own word for the same thing.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-600 dark:text-zinc-400">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th scope="col" className="py-2 pr-4 font-semibold text-zinc-700 dark:text-zinc-300">
                    Assistant
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold text-zinc-700 dark:text-zinc-300">
                    You add
                  </th>
                  <th scope="col" className="py-2 font-semibold text-zinc-700 dark:text-zinc-300">
                    Where
                  </th>
                </tr>
              </thead>
              <tbody>
                {ASSISTANTS.map((a) => (
                  <tr key={a.id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <th scope="row" className="py-2 pr-4 font-normal">
                      <a href={`#${a.id}`} className={LINK_CLASS}>
                        {a.name}
                      </a>
                    </th>
                    <td className="py-2 pr-4">{a.calledThere}</td>
                    <td className="py-2">{a.where}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="py-2 pr-4 font-normal">
                    <a href={`#${OTHER_ASSISTANTS_ID}`} className={LINK_CLASS}>
                      Another assistant
                    </a>
                  </th>
                  <td className="py-2 pr-4">a remote MCP server</td>
                  <td className="py-2">its settings</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className={SECTION_HEADING_CLASS}>Add SPERT Suite to your assistant</h3>
          <div className="space-y-4">
            {ASSISTANTS.map((a) => (
              <AssistantBlock key={a.id} a={a} />
            ))}
            <section
              id={OTHER_ASSISTANTS_ID}
              className="scroll-mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700"
            >
              <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Another assistant</h4>
              <p className={NOTE_CLASS}>
                Any assistant that can add a remote MCP server can use SPERT Suite. Look for a setting called
                connectors, apps, plugins, tools or MCP servers, and give it the address, no sign-in, and the HTTP
                connection type. Untested assistants may work well or not at all, so try a small change first.
              </p>
              <p className={NOTE_CLASS}>Two that should work, but haven&rsquo;t been tested with SPERT Suite:</p>
              <ul className={`mt-2 ${LIST_CLASS}`}>
                <li>
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">GitHub Copilot in VS Code</span>{' '}
                  (any Copilot plan; on Business and Enterprise, an admin must first allow MCP servers): run{' '}
                  <Ui>MCP: Add Server</Ui> from the Command Palette, choose <Ui>HTTP</Ui>, paste the address, and
                  name it <Code>spert-suite</Code>.
                </li>
                <li>
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">Antigravity CLI</span>{' '}
                  (Google&rsquo;s successor to Gemini CLI): add this to{' '}
                  <Code>~/.gemini/config/mcp_config.json</Code>:{' '}
                  <Code>{`{ "mcpServers": { "spert-suite": { "serverUrl": "${MCP_SERVER_URL}" } } }`}</Code>
                </li>
              </ul>
              <p className={NOTE_CLASS}>
                Not available today: the Microsoft Copilot app with a personal Microsoft account, and Gemini with a
                work or school account or outside the US. ChatGPT Plus, Free and Go are untested, and OpenAI&rsquo;s
                documentation doesn&rsquo;t list them.
              </p>
            </section>
          </div>
        </section>

        <section>
          <h3 className={SECTION_HEADING_CLASS}>The warnings you&rsquo;ll see</h3>
          <p className={TEXT_CLASS}>
            Because SPERT Suite isn&rsquo;t in their directories, Claude, ChatGPT and Gemini warn you before adding
            it, and ask you to confirm that you trust it. That is expected. Here is what SPERT Suite can and
            can&rsquo;t do:
          </p>
          <ul className={`mt-2 ${LIST_CLASS}`}>
            <li>It never asks who you are. There is no sign-in, account or password.</li>
            <li>
              It reaches a project only after you click Connect AI in that project, choose what the assistant may
              do, and paste the pairing code into your assistant. A code works once, and expires after 15 minutes
              if unused.
            </li>
            <li>It works only with the project you have open, and only in the ways you allowed.</li>
            <li>
              You can end it at any time with Disconnect in the app. Signing out ends it too. Otherwise it ends by
              itself 7 days after it was last used.
            </li>
          </ul>
          <p className={`mt-2 ${TEXT_CLASS}`}>
            The <PdfLink href="/ai-privacy">AI Privacy Notice</PdfLink> explains exactly what is shared, and for how
            long.
          </p>
        </section>

        <section>
          <h3 className={SECTION_HEADING_CLASS}>Then, in the app</h3>
          <ol className={STEPS_CLASS}>
            <li>
              Open your project and click <Ui>Connect AI</Ui>.
            </li>
            <li>
              Choose what the assistant may do, and click <Ui>Connect</Ui>.
            </li>
            <li>
              Click <Ui>Copy Prompt</Ui>.
            </li>
            <li>
              Paste it into your assistant and send it. In ChatGPT and Gemini, type <Code>@</Code> and pick <Name />{' '}
              first.
            </li>
          </ol>
          <p className={`mt-3 ${TEXT_CLASS}`}>Each app&rsquo;s Connect AI guide explains the rest:</p>
          <ul className={`mt-2 ${LIST_CLASS}`}>
            {connectAiApps.map(({ app, guide }) => (
              <li key={app.slug}>
                <PdfLink href={guideUrl(app, guide)}>
                  {formatName(app.name)} {guide.title}
                </PdfLink>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className={SECTION_HEADING_CLASS}>Which assistant for which job</h3>
          <ul className={LIST_CLASS}>
            <li>
              For a big build or reorganisation in Story Map, Claude and ChatGPT have held up best in our tests.
              Claude is the most reliable for adding descriptions, notes and acceptance criteria to many cards at
              once.
            </li>
            <li>
              Microsoft 365 Copilot Chat is good for small, targeted edits, but may ask you to confirm each step, or
              stall, partway through a large change. Copilot Studio holds up better on long changes.
            </li>
            <li>
              In Scheduler, a large schedule usually takes a handful of bulk steps, so most assistants hold up well.
              For a long build from scratch, Claude and ChatGPT are the safest.
            </li>
            <li>Gemini and Grok connect and work. Try a short test on your own project before a large change.</li>
            <li>Reading a forecast in Forecaster takes only a few steps, so any of them is fine there.</li>
          </ul>
        </section>

        <section>
          <h3 className={SECTION_HEADING_CLASS}>If something goes wrong</h3>
          <dl className="space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            <div>
              <dt className="font-semibold text-zinc-700 dark:text-zinc-300">
                The assistant answers, but nothing changes in the app
              </dt>
              <dd>
                It isn&rsquo;t really connected. Check that SPERT Suite is switched on in this conversation, or, in
                ChatGPT and Gemini, that you picked it with <Code>@</Code>. An assistant without the connection may
                even describe work it never did. The clue is tool names such as{' '}
                <Code>resolve_session_code</Code> in its reply while your project stays as it was.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-zinc-700 dark:text-zinc-300">
                ChatGPT loops, ignores your instructions or finds few tools
              </dt>
              <dd>
                Pick SPERT Suite again with <Code>@</Code>, or start a new chat.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-zinc-700 dark:text-zinc-300">
                The assistant shows old tools, or fewer than it should
              </dt>
              <dd>
                Assistants keep the tool list from when you added SPERT Suite, and refreshing often doesn&rsquo;t
                update it. Remove SPERT Suite from your assistant and add it again. On ChatGPT Business, Enterprise or
                Edu, an admin refreshes the list in the workspace&rsquo;s app settings. Each app&rsquo;s Connect AI
                User Guide says how many tools to expect.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-zinc-700 dark:text-zinc-300">The code is refused</dt>
              <dd>
                Codes expire after 15 minutes and work once, and the Connect AI panel replaces them as they expire.
                Copy the prompt again from the panel and paste that.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-zinc-700 dark:text-zinc-300">
                You can&rsquo;t find Connectors, Plugins or Custom
              </dt>
              <dd>
                Your plan or account may not include it (see &ldquo;Who can add it&rdquo; above), or your
                organisation may have turned custom connectors off, in which case ask your IT department. Or the
                assistant has moved the menu again: please{' '}
                <Link href="/contact" className={LINK_CLASS}>
                  let me know
                </Link>
                .
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-zinc-700 dark:text-zinc-300">Claude won&rsquo;t add another connector</dt>
              <dd>The Free plan allows one custom connector. Remove one you no longer use, or upgrade.</dd>
            </div>
          </dl>
        </section>

        <DataAndPrivacy />
        <StillStuck />
      </main>

      <Footer />
    </div>
  );
}
