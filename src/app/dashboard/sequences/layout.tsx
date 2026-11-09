import { Suspense } from "react";
import { ModuleGate } from "@/components/dashboard/module-gate";

/** Only team members with the sales module (Settings, Users). */
export default function Layout({ children }: LayoutProps<"/dashboard/sequences">) {
  return (
    <>
      <Suspense fallback={null}>
        <ModuleGate module="sales" />
      </Suspense>
      {children}
    </>
  );
}
