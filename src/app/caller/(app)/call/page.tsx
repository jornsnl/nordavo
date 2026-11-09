import type { Metadata } from "next";
import { CallScreen } from "@/components/calls/call-screen";
import { logCallerCall, releaseCallerCall, skipCallerCall, startCallerCalls } from "./actions";

export const metadata: Metadata = {
  title: "Call",
};

/** The call screen of an external caller: their own queue only (see the actions). */
export default function Page() {
  return (
    <>
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight text-brand-900">Call</h1>
        <p className="mt-1 text-sm text-muted">
          Tap the number to call, then pick the outcome. The next contact opens by itself.
        </p>
      </div>
      <CallScreen
        emptyText="Everyone on your list is called today, waiting for a call back or open with someone else. Check again later or ask Nordavo for a new list."
        actions={{
          start: startCallerCalls,
          log: logCallerCall,
          skip: skipCallerCall,
          release: releaseCallerCall,
        }}
      />
    </>
  );
}
