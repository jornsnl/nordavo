import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { McpCodeBlock, mcpAddCommand } from "@/components/settings/security/mcp-code-block";

const examplePrompts = [
  "Which vacancies have been open for more than 3 weeks and do not have 3 presented candidates yet?",
  "Give me an overview of the pipeline for the Senior React Developer vacancy at Acme.",
  "Find available candidates with Python and at least 5 years of experience.",
  "Which of my tasks are overdue or due this week?",
  "What happened at client Acme in the past week?",
  "Create a task for me to plan the check-in with Priya on Friday. (write access)",
];

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium text-ink">{title}</p>
        {children}
      </div>
    </li>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">{children}</code>;
}

/** Step by step: from installing Claude Code to the first question. */
export function McpSetupGuide({ endpoint }: { endpoint: string }) {
  const mcpJson = JSON.stringify(
    {
      mcpServers: {
        nordavo: {
          type: "http",
          url: endpoint,
          headers: { Authorization: "Bearer ${NORDAVO_MCP_TOKEN}" },
        },
      },
    },
    null,
    2,
  );

  return (
    <>
      <section aria-labelledby="mcp-oauth-heading" className="space-y-4 border-t border-border pt-6">
        <div>
          <h3 id="mcp-oauth-heading" className="text-sm font-semibold text-brand-900">
            Connect with OAuth (recommended)
          </h3>
          <p className="mt-1 text-sm text-muted">
            No token to copy: you sign in to Nordavo and choose read or read and write. The connection shows up under
            Connected apps above, where you can disconnect it.
          </p>
        </div>
        <ol className="space-y-5">
          <Step n={1} title="Claude.ai or Claude Desktop">
            <p className="text-sm text-muted">
              Go to <strong>Settings, Connectors</strong>, choose <strong>Add custom connector</strong> and paste this
              URL. Leave the OAuth client fields empty.
            </p>
            <McpCodeBlock code={endpoint} label="Connector URL" />
          </Step>
          <Step n={2} title="Claude Code">
            <p className="text-sm text-muted">
              Add the server without a header, then start <Code>claude</Code>, type <Code>/mcp</Code>, pick{" "}
              <Code>nordavo</Code> and choose <strong>Authenticate</strong>.
            </p>
            <McpCodeBlock code={`claude mcp add --transport http --scope user nordavo ${endpoint}`} label="Command" />
          </Step>
          <Step n={3} title="Approve in Nordavo">
            <p className="text-sm text-muted">
              Your browser opens Nordavo. Sign in if needed, choose <strong>Read</strong> or{" "}
              <strong>Read and write</strong> and click <strong>Allow access</strong>. You go back to Claude and the
              connection is ready. Claude renews its access by itself; disconnect above to stop it.
            </p>
          </Step>
        </ol>
      </section>

      <section aria-labelledby="mcp-guide-heading" className="space-y-4 border-t border-border pt-6">
        <h3 id="mcp-guide-heading" className="text-sm font-semibold text-brand-900">
          Or with a personal token
        </h3>
        <ol className="space-y-5">
          <Step n={1} title="Install Claude Code">
            <p className="text-sm text-muted">
              Follow the installation on{" "}
              <a
                href="https://code.claude.com/docs/en/setup"
                className="font-medium text-brand-700 underline underline-offset-2"
                target="_blank"
                rel="noreferrer"
              >
                code.claude.com/docs
              </a>
              , for example with npm:
            </p>
            <McpCodeBlock code="npm install -g @anthropic-ai/claude-code" label="Install command" />
          </Step>
          <Step n={2} title="Create a token above">
            <p className="text-sm text-muted">
              Choose <strong>Read</strong>, unless Claude also needs to create tasks and notes for you. Copy the
              token right away: you only see it once.
            </p>
          </Step>
          <Step n={3} title="Connect Nordavo to Claude Code">
            <p className="text-sm text-muted">
              Paste this in your terminal and replace <Code>YOUR_TOKEN</Code> with your token (after you create it, the
              ready-made command is shown above). Add <Code>--scope user</Code> to use Nordavo in all your
              projects.
            </p>
            <McpCodeBlock code={mcpAddCommand(endpoint, "YOUR_TOKEN")} label="Command" />
          </Step>
          <Step n={4} title="Check the connection">
            <p className="text-sm text-muted">
              Start <Code>claude</Code> and type <Code>/mcp</Code>. You see <Code>nordavo</Code> with status connected
              and the available tools. Outside Claude Code you can also use <Code>claude mcp list</Code>.
            </p>
          </Step>
          <Step n={5} title="Or: add it to a project without committing your token">
            <p className="text-sm text-muted">
              A <Code>.mcp.json</Code> in the root of a repository shares the connection with your team. The token comes
              from an environment variable, so it never ends up in git. For example, put{" "}
              <Code>export NORDAVO_MCP_TOKEN=nrd_...</Code> in your shell profile.
            </p>
            <McpCodeBlock code={mcpJson} label=".mcp.json" />
          </Step>
          <Step n={6} title="Ask your first question">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              {examplePrompts.map((prompt) => (
                <li key={prompt}>{prompt}</li>
              ))}
            </ul>
          </Step>
        </ol>

        <div className="rounded-xl border border-border bg-surface/60 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-brand-900">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Use it safely
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            <li>A token or connection gives access with your permissions: whoever has it sees what you see.</li>
            <li>Never share your token, not even with colleagues. Everyone creates their own token.</li>
            <li>Never put it in code, a repository or a chat. Use an environment variable.</li>
            <li>Lost or leaked? Revoke the token above right away and create a new one.</li>
            <li>Choose read unless write is really needed, and the shortest validity possible.</li>
          </ul>
        </div>
      </section>
    </>
  );
}
