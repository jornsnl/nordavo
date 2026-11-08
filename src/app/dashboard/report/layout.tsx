import { Suspense } from "react";
import { ModuleGate } from "@/components/dashboard/module-gate";

/** Only team members with the report module (Settings, Users). */
export default function Layout({ children }: LayoutProps<"/dashboard/report">) {
  return (
    <>
      <Suspense fallback={null}>
        <ModuleGate module="report" />
      </Suspense>
      {children}
    </>
  );
}
