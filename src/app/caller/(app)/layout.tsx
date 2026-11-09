import { Suspense } from "react";
import { requireCaller } from "@/lib/auth";

/** Every caller page except Security needs an active caller with an authenticator app. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <CallerGate />
      </Suspense>
      {children}
    </>
  );
}

async function CallerGate() {
  await requireCaller();
  return null;
}
