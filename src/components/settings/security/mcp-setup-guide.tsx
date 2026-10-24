import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { McpCodeBlock, mcpAddCommand } from "@/components/settings/security/mcp-code-block";

const examplePrompts = [
  "Welke vacatures staan langer dan 3 weken open en hebben nog geen 3 voorgestelde kandidaten?",
  "Geef me een overzicht van de pipeline voor de vacature Senior React Developer bij Acme.",
  "Zoek kandidaten met Python en minstens 5 jaar ervaring die beschikbaar zijn.",
  "Welke van mijn taken zijn te laat of moeten deze week af?",
  "Wat is er de afgelopen week gebeurd bij klant Acme?",
  "Maak een taak voor mij om vrijdag de check-in met Priya te plannen. (schrijfrechten)",
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
    <section aria-labelledby="mcp-guide-heading" className="space-y-4 border-t border-border pt-6">
      <h3 id="mcp-guide-heading" className="text-sm font-semibold text-brand-900">
        Zo stel je het in
      </h3>
      <ol className="space-y-5">
        <Step n={1} title="Installeer Claude Code">
          <p className="text-sm text-muted">
            Volg de installatie op{" "}
            <a
              href="https://code.claude.com/docs/en/setup"
              className="font-medium text-brand-700 underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
            >
              code.claude.com/docs
            </a>
            , bijvoorbeeld met npm:
          </p>
          <McpCodeBlock code="npm install -g @anthropic-ai/claude-code" label="Installatiecommando" />
        </Step>
        <Step n={2} title="Maak hierboven een token aan">
          <p className="text-sm text-muted">
            Kies <strong>Lezen</strong>, tenzij Claude ook taken en notities voor je moet aanmaken. Kopieer het
            token meteen: je ziet het maar één keer.
          </p>
        </Step>
        <Step n={3} title="Koppel Nordavo aan Claude Code">
          <p className="text-sm text-muted">
            Plak dit in je terminal en vervang <Code>JOUW_TOKEN</Code> door je token (na het aanmaken staat het
            commando kant-en-klaar hierboven). Voeg <Code>--scope user</Code> toe om Nordavo in al je projecten te
            gebruiken.
          </p>
          <McpCodeBlock code={mcpAddCommand(endpoint, "JOUW_TOKEN")} label="Commando" />
        </Step>
        <Step n={4} title="Controleer de koppeling">
          <p className="text-sm text-muted">
            Start <Code>claude</Code> en typ <Code>/mcp</Code>. Je ziet <Code>nordavo</Code> met status connected
            en de beschikbare tools. Buiten Claude Code kan het ook met <Code>claude mcp list</Code>.
          </p>
        </Step>
        <Step n={5} title="Of: zet het in een project zonder je token te committen">
          <p className="text-sm text-muted">
            Een <Code>.mcp.json</Code> in de root van een repository deelt de koppeling met je team. Het token komt
            uit een omgevingsvariabele, zodat het nooit in git belandt. Zet bijvoorbeeld{" "}
            <Code>export NORDAVO_MCP_TOKEN=nrd_...</Code> in je shellprofiel.
          </p>
          <McpCodeBlock code={mcpJson} label=".mcp.json" />
        </Step>
        <Step n={6} title="Stel je eerste vraag">
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
          Veilig gebruiken
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Een token geeft toegang met jouw rechten: wie het heeft, ziet wat jij ziet.</li>
          <li>Deel je token nooit, ook niet met collega&apos;s. Iedereen maakt een eigen token.</li>
          <li>Zet het nooit in code, een repository of een chat. Gebruik een omgevingsvariabele.</li>
          <li>Kwijt of gelekt? Trek het token hierboven meteen in en maak een nieuw.</li>
          <li>Kies lezen, tenzij schrijven echt nodig is, en een zo kort mogelijke geldigheid.</li>
        </ul>
      </div>
    </section>
  );
}
