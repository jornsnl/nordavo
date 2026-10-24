import { CopyButton } from "@/components/talent/copy-button";

/** A command or config snippet with a copy button. */
export function McpCodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative rounded-xl border border-border bg-surface/70">
      <pre className="overflow-x-auto px-4 py-3 pr-28 font-mono text-xs leading-relaxed whitespace-pre text-ink">
        <code>{code}</code>
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <CopyButton text={code} label={label} />
      </div>
    </div>
  );
}

/**
 * The `claude mcp add` command for a token (or a placeholder). One line, so
 * it pastes the same in bash, zsh and PowerShell.
 */
export function mcpAddCommand(endpoint: string, token: string, scope?: "user") {
  const scopeFlag = scope ? ` --scope ${scope}` : "";
  return `claude mcp add --transport http${scopeFlag} nordavo ${endpoint} --header "Authorization: Bearer ${token}"`;
}
