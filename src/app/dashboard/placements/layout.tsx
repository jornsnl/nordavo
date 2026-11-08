import { Suspense } from "react";
import { ModuleGate } from "@/components/dashboard/module-gate";

/** Only team members with the recruitment module (Settings, Users). */
export default function Layout({ children }: LayoutProps<"/dashboard/placements">) {
  return (
    <>
      <Suspense fallback={null}>
        <ModuleGate module="recruitment" />
      </Suspense>
      {children}
    </>
  );
}
