"use client";

import type { ActionState } from "@/lib/action-state";
import { Badge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/candidates/confirm-button";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export type McpTokenRow = {
  id: string;
  name: string;
  prefix: string;
  access: "read" | "write";
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  status: "active" | "expired" | "revoked";
};

const statusBadge = {
  active: { label: "Actief", tone: "success" },
  expired: { label: "Verlopen", tone: "warning" },
  revoked: { label: "Ingetrokken", tone: "neutral" },
} as const;

/** Tokens of the signed-in user. Dates arrive formatted from the server. */
export function McpTokenList({
  tokens,
  revokeAction,
}: {
  tokens: McpTokenRow[];
  revokeAction: (tokenId: string) => Promise<ActionState>;
}) {
  if (tokens.length === 0) {
    return <p className="text-sm text-muted">Je hebt nog geen tokens. Maak er hieronder een aan.</p>;
  }

  return (
    <Table>
      <THead>
        <tr>
          <TH>Naam</TH>
          <TH>Rechten</TH>
          <TH>Aangemaakt</TH>
          <TH>Laatst gebruikt</TH>
          <TH>Verloopt</TH>
          <TH>Status</TH>
          <TH>
            <span className="sr-only">Acties</span>
          </TH>
        </tr>
      </THead>
      <TBody>
        {tokens.map((token) => {
          const status = statusBadge[token.status];
          return (
            <TR key={token.id}>
              <TD>
                <p className="font-medium text-ink">{token.name}</p>
                <p className="font-mono text-xs text-muted">{token.prefix}…</p>
              </TD>
              <TD>
                <Badge tone={token.access === "write" ? "accent" : "brand"}>
                  {token.access === "write" ? "Lezen en schrijven" : "Lezen"}
                </Badge>
              </TD>
              <TD className="text-muted">{token.createdAt}</TD>
              <TD className="text-muted">{token.lastUsedAt}</TD>
              <TD className="text-muted">{token.expiresAt}</TD>
              <TD>
                <Badge tone={status.tone}>{status.label}</Badge>
              </TD>
              <TD className="text-right">
                {token.status === "active" && (
                  <ConfirmButton
                    size="sm"
                    variant="ghost"
                    title="Token intrekken?"
                    description={`Claude Code kan met "${token.name}" daarna niet meer bij Nordavo. Dit kun je niet ongedaan maken.`}
                    confirmLabel="Intrekken"
                    action={() => revokeAction(token.id)}
                  >
                    Intrekken
                  </ConfirmButton>
                )}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
