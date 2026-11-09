import { SalesWorkspace } from "@/components/sales/data-grid";
import type { CompanyRow, ContactRow } from "@/lib/sales/rows";

// TEMPORARY test harness, never commit.
function company(i: number): CompanyRow {
  return {
    id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    name: `Company ${i}`, domain: `c${i}.nl`, website: null, prio: (i % 5) + 1, category: i % 2 ? "development" : "data_bi",
    description: null, sector: i % 3 ? "Software" : "Finance", employees: i * 3, city: i % 2 ? "Utrecht" : "Amsterdam", linkedin_url: null,
    general_phone: null, red_flags: [], opening_line: null, source_note: null, icp_decision: "GO", icp_score: 70,
    lead_status: (["new", "ready", "in_sequence", "enrich"] as const)[i % 4], lead_status_changed_at: new Date(Date.now() - i * 86400000).toISOString(),
    pipeline_stage: i % 5 === 0 ? "interested" : null, pipeline_stage_changed_at: null, pipeline_entered_at: null, lost_reason: null,
    owner_id: null, owner_name: null, partner_id: null, partner_name: null, next_action: i % 7 === 0 ? "Call back" : null, next_action_date: null,
    pinned_at: null, manual_position: null, client_id: null, source: "import", created_at: new Date().toISOString(),
    primary_contact: { id: "x", name: `Person ${i}`, title: "CTO", phone: "+3161234" + i, email: null, linkedinUrl: null },
    contacts_count: 2, signals_count: 1, last_activity_at: null, last_activity: null,
  };
}
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const p = await searchParams;
  const rows = Array.from({ length: 400 }, (_, i) => company(i + 1));
  void ({} as ContactRow);
  return <div className="p-6"><SalesWorkspace kind="companies" rows={rows} views={[]} initialViewId={null} initialMode={p.mode === "board" ? "board" : "table"} /></div>;
}
