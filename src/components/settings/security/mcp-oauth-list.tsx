"use client";

import type { ActionState } from "@/lib/action-state";
import { Badge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/candidates/confirm-button";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export type OAuthGrantRow = {
  id: string;
  appName: string;
  access: "read" | "write";
  createdAt: string;
  lastUsedAt: string;
};

/** Apps connected through OAuth (Claude and others), active ones only. Dates arrive formatted. */
export function McpOAuthList({
  grants,
  revokeAction,
}: {
  grants: OAuthGrantRow[];
  revokeAction: (grantId: string) => Promise<ActionState>;
}) {
  if (grants.length === 0) {
    return <p className="text-sm text-muted">No apps connected yet. Add Nordavo in Claude, see the steps below.</p>;
  }

  return (
    <>
      <MobileList label="Connected apps" className="md:hidden">
        {grants.map((grant) => (
          <MobileListItem
            key={grant.id}
            title={grant.appName}
            subtitle={grant.access === "write" ? "Read and write" : "Read"}
            meta={`Connected ${grant.createdAt}`}
            trailing={<Badge tone="success">Connected</Badge>}
          >
            <p className="text-xs text-muted">Last used {grant.lastUsedAt.toLowerCase()}</p>
            <div className="mt-2 pointer-coarse:[&_button]:min-h-11">
              <DisconnectButton grant={grant} revokeAction={revokeAction} />
            </div>
          </MobileListItem>
        ))}
      </MobileList>

      <Table className="hidden md:block">
        <THead>
          <tr>
            <TH>App</TH>
            <TH>Access</TH>
            <TH>Connected</TH>
            <TH>Last used</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {grants.map((grant) => (
            <TR key={grant.id}>
              <TD>
                <p className="font-medium text-ink">{grant.appName}</p>
              </TD>
              <TD>
                <Badge tone={grant.access === "write" ? "accent" : "brand"}>
                  {grant.access === "write" ? "Read and write" : "Read"}
                </Badge>
              </TD>
              <TD className="text-muted">{grant.createdAt}</TD>
              <TD className="text-muted">{grant.lastUsedAt}</TD>
              <TD className="text-right">
                <DisconnectButton grant={grant} revokeAction={revokeAction} />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

function DisconnectButton({
  grant,
  revokeAction,
}: {
  grant: OAuthGrantRow;
  revokeAction: (grantId: string) => Promise<ActionState>;
}) {
  return (
    <ConfirmButton
      size="sm"
      variant="ghost"
      title="Disconnect app?"
      description={`${grant.appName} can no longer reach Nordavo. To use it again, connect it again from the app.`}
      confirmLabel="Disconnect"
      action={() => revokeAction(grant.id)}
    >
      Disconnect
    </ConfirmButton>
  );
}
