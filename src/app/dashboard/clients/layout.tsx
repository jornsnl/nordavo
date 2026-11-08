import { Suspense } from "react";
import { ModuleGate } from "@/components/dashboard/module-gate";

/** Only team members with the clients module (Settings, Users). */
export default function Layout({ children }: LayoutProps<"/dashboard/clients">) {
  return (
    <>
      <Suspense fallback={null}>
        <ModuleGate module="clients" />
      </Suspense>
      {children}
    </>
  );
}
