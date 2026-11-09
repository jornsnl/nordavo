import { Suspense } from "react";
import { ModuleGate } from "@/components/dashboard/module-gate";
import { AcademyAdminTabs, AcademyAdminTabsFallback } from "@/components/academy/admin/admin-tabs";

/** Only team members with the academy module (Settings, Users), and admins. */
export default function Layout({ children }: LayoutProps<"/dashboard/academy">) {
  return (
    <>
      <Suspense fallback={null}>
        <ModuleGate module="academy" />
      </Suspense>
      <Suspense fallback={<AcademyAdminTabsFallback />}>
        <AcademyAdminTabs />
      </Suspense>
      {children}
    </>
  );
}
