"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCampaign } from "@/app/dashboard/inbox/actions";
import { importCampaignMembers, setCampaignStatus } from "@/app/dashboard/sequences/campaign-actions";
import { Button } from "@/components/ui/button";

const control = "h-9 w-full rounded-lg border border-border bg-white px-2 text-sm";

/** A new campaign to send leads to; Claude links it to Instantly or Seleqt by its id there. */
export function NewCampaignForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<"mail" | "linkedin">("mail");
  const [externalId, setExternalId] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await createCampaign({ name, channel, externalId: externalId || null });
          if (!result.ok) return setMessage({ tone: "error", text: result.error });
          setName("");
          setExternalId("");
          setMessage({ tone: "ok", text: "Campaign added." });
          router.push(`/dashboard/sequences/campaigns/${result.id}`);
        });
      }}
    >
      <label className="block space-y-1">
        <span className="font-medium">Name</span>
        <input className={control} required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="Q4 CTO's data roles" />
      </label>
      <label className="block space-y-1">
        <span className="font-medium">Channel</span>
        <select className={control} value={channel} onChange={(e) => setChannel(e.target.value as "mail" | "linkedin")}>
          <option value="mail">Mail (Instantly)</option>
          <option value="linkedin">LinkedIn (Seleqt)</option>
        </select>
      </label>
      <label className="block space-y-1">
        <span className="font-medium">Id in Instantly or Seleqt (optional)</span>
        <input className={control} maxLength={300} value={externalId} onChange={(e) => setExternalId(e.target.value)} />
      </label>
      <Button type="submit" disabled={pending || !name.trim()}>
        Add campaign
      </Button>
      {message && <p className={message.tone === "error" ? "text-danger" : "text-emerald-700"}>{message.text}</p>}
    </form>
  );
}

export function CampaignStatusButtons({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const set = (next: "active" | "paused" | "finished") =>
    startTransition(async () => {
      if (next === "finished" && !window.confirm("Finish this campaign? Leads without a reply become free again.")) return;
      const result = await setCampaignStatus(id, next);
      if (result.ok) router.refresh();
      else window.alert(result.error);
    });
  return (
    <span className="flex flex-wrap gap-2">
      {status !== "active" && status !== "finished" && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => set("active")}>
          Active
        </Button>
      )}
      {status === "active" && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => set("paused")}>
          Pause
        </Button>
      )}
      {status !== "finished" && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => set("finished")}>
          Finish
        </Button>
      )}
    </span>
  );
}

/** Paste the export of Seleqt (or any list of leads with mail or LinkedIn, status and replied). */
export function ImportMembersForm({ id }: { id: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [force, setForce] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await importCampaignMembers(id, text, force);
          if (!result.ok) return setMessage({ tone: "error", text: result.error });
          setText("");
          setMessage({ tone: "ok", text: result.message });
          router.refresh();
        });
      }}
    >
      <label className="block space-y-1">
        <span className="font-medium">CSV or Excel cells with a header row</span>
        <textarea
          className="block min-h-32 w-full rounded-lg border border-border bg-white px-2 py-1.5 font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"email,linkedin,status,replied\njane@acme.nl,,active,no\n,https://www.linkedin.com/in/john-doe,replied,yes"}
        />
      </label>
      <input
        type="file"
        accept=".csv,.tsv,.txt,text/csv"
        className="text-xs"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) setText(await file.text());
        }}
      />
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
        Also leads that are in another running campaign
      </label>
      <Button type="submit" disabled={pending || !text.trim()}>
        Import leads
      </Button>
      {message && <p className={message.tone === "error" ? "text-danger" : "text-emerald-700"}>{message.text}</p>}
    </form>
  );
}
