// Leads of a campaign from a CSV export (feedback Julius, 4f7fd90a). Seleqt
// has no API the portal knows, so its export (or any list of leads) is
// pasted or uploaded on the campaign page. Pure, tested in
// tests/campaign-import.test.ts.

export type ImportedMember = {
  email: string | null;
  linkedinUrl: string | null;
  status: "active" | "replied" | "finished" | "stopped" | "bounced" | "unsubscribed";
  repliedAt: string | null;
  replyOutcome: "reply_positief" | "reply_neutraal" | "reply_negatief" | null;
};

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

function column(head: string[], names: string[]): number {
  return head.findIndex((h) => names.some((n) => norm(h) === n || norm(h).includes(n)));
}

const yes = /^(1|true|yes|ja|y|x|replied|beantwoord)$/i;

/** Reads a CSV or tab separated export with a header row. Lines without an email or LinkedIn link are skipped. */
export function parseMemberCsv(text: string): { members: ImportedMember[]; skipped: number; error?: string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) return { members: [], skipped: 0, error: "Paste a header row and at least one lead." };
  const first = lines[0];
  const sep = first.includes("\t") ? "\t" : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const head = splitLine(first, sep);
  const emailCol = column(head, ["email", "mail", "emailaddress"]);
  const linkedinCol = column(head, ["linkedin", "profileurl", "linkedinurl", "profile"]);
  if (emailCol < 0 && linkedinCol < 0) return { members: [], skipped: 0, error: "No column with an email or a LinkedIn link found." };
  const statusCol = column(head, ["status", "state", "stage"]);
  const repliedCol = column(head, ["replied", "reply", "answered", "beantwoord"]);
  const repliedAtCol = column(head, ["repliedat", "replydate", "lastreply"]);
  const sentimentCol = column(head, ["sentiment", "interest", "outcome"]);

  const members: ImportedMember[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, sep);
    const email = emailCol >= 0 ? cells[emailCol]?.toLowerCase() || null : null;
    const linkedin = linkedinCol >= 0 ? cells[linkedinCol] || null : null;
    const validEmail = email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
    const validLinkedin = linkedin && /linkedin\.com\/in\//i.test(linkedin) ? linkedin : null;
    if (!validEmail && !validLinkedin) {
      skipped += 1;
      continue;
    }
    const statusText = (statusCol >= 0 ? cells[statusCol] : "")?.toLowerCase() ?? "";
    const repliedCell = repliedCol >= 0 ? (cells[repliedCol] ?? "") : "";
    const repliedAtText = repliedAtCol >= 0 ? (cells[repliedAtCol] ?? "") : /^\d{4}-\d{2}-\d{2}/.test(repliedCell) ? repliedCell : "";
    const replied = yes.test(repliedCell.trim()) || /repl|answer|beantw|interested|meeting/.test(statusText) || Boolean(repliedAtText);
    const sentimentText = (sentimentCol >= 0 ? cells[sentimentCol] : statusText)?.toLowerCase() ?? "";
    const replyOutcome = replied
      ? /not interested|negat|niet|no thanks|geen/.test(sentimentText)
        ? "reply_negatief"
        : /interest|posit|meeting|yes|ja/.test(sentimentText)
          ? "reply_positief"
          : "reply_neutraal"
      : null;
    const status: ImportedMember["status"] = replied
      ? "replied"
      : /bounce/.test(statusText)
        ? "bounced"
        : /unsub|afgemeld/.test(statusText)
          ? "unsubscribed"
          : /finish|complete|done|ended|klaar/.test(statusText)
            ? "finished"
            : /stop|remove|paused/.test(statusText)
              ? "stopped"
              : "active";
    const repliedAt = repliedAtText && !Number.isNaN(Date.parse(repliedAtText)) ? new Date(repliedAtText).toISOString() : null;
    members.push({ email: validEmail, linkedinUrl: validLinkedin, status, repliedAt, replyOutcome });
  }
  return { members, skipped };
}
