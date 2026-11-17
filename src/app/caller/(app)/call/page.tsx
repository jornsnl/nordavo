import type { Metadata } from "next";
import { Suspense } from "react";
import { CallScreen } from "@/components/calls/call-screen";
import { CallSheet } from "@/components/calls/call-sheet";
import { ViewSwitch } from "@/components/calls/view-switch";
import { ListSkeleton } from "@/components/ui/skeleton";
import { requireCaller } from "@/lib/auth";
import { salesBookingBase } from "@/lib/sales/booking";
import { callOptions, loadOutcomeButtons } from "@/lib/sales/call-session";
import { loadCallerSheet } from "@/lib/sales/call-sheet-data";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addCallerContact,
  callerSheetHistory,
  claimCallerSheetContact,
  editCallerContact,
  logCallerCall,
  logCallerSheetCall,
  markCallerPhone,
  releaseCallerCall,
  reloadCallerSheetRow,
  skipCallerCall,
  startCallerCalls,
  undoCallerCall,
  undoCallerSheetCall,
} from "./actions";

export const metadata: Metadata = {
  title: "Call",
};

/** The call screen of an external caller: their own queue only (see the actions). The sheet shows the same queue as a table. */
export default function Page({ searchParams }: PageProps<"/caller/call">) {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <Calls searchParams={searchParams} />
    </Suspense>
  );
}

async function Calls({ searchParams }: { searchParams: PageProps<"/caller/call">["searchParams"] }) {
  const sheet = (await searchParams).view === "sheet";
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900">Call</h1>
          <p className="mt-1 text-sm text-muted">
            {sheet
              ? "Your call list with one row per company. Open a row to see its contacts, pick an outcome, change contacts and read the history."
              : "Tap the number to call, then pick the outcome. The next contact opens by itself."}
          </p>
        </div>
        <ViewSwitch screenHref="/caller/call" sheetHref="/caller/call?view=sheet" active={sheet ? "sheet" : "screen"} />
      </div>
      {sheet ? (
        <Sheet />
      ) : (
        <CallScreen
          emptyText="Everyone on your list is called today, waiting for a call back or open with someone else. Check again later or ask Nordavo for a new list."
          actions={{
            start: startCallerCalls,
            log: logCallerCall,
            skip: skipCallerCall,
            release: releaseCallerCall,
            undo: undoCallerCall,
            contacts: { edit: editCallerContact, markPhone: markCallerPhone, add: addCallerContact },
          }}
        />
      )}
    </>
  );
}

async function Sheet() {
  const caller = await requireCaller();
  const db = createAdminClient();
  if (!db) return <p className="text-sm text-muted">Calling is not available right now. Ask Nordavo to finish the setup.</p>;
  const [rows, profile, outcomes, options] = await Promise.all([
    loadCallerSheet(db, caller.callerId, caller.id),
    db.from("profiles").select("dial_template").eq("id", caller.id).maybeSingle(),
    loadOutcomeButtons(db),
    callOptions({ db, callerId: caller.callerId, actorId: caller.id }),
  ]);
  const bookingBase = salesBookingBase(process.env.NEXT_PUBLIC_CALCOM_SALES_URL, null);
  return (
    <CallSheet
      rows={rows}
      dialTemplate={profile.data?.dial_template ?? null}
      leadLinks={false}
      callHref="/caller/call"
      outcomes={outcomes}
      options={options}
      booking={bookingBase ? { base: bookingBase, callerId: caller.callerId } : null}
      actions={{
        claim: claimCallerSheetContact,
        release: releaseCallerCall,
        log: logCallerSheetCall.bind(null, null),
        undo: undoCallerSheetCall.bind(null, null),
        history: callerSheetHistory,
        reload: reloadCallerSheetRow.bind(null, null),
        contacts: { edit: editCallerContact, markPhone: markCallerPhone, add: addCallerContact },
      }}
    />
  );
}
