import { loadQuestionnaire, loadReport, type WspAccess } from "@/lib/wsp/data";
import { privacyUrl } from "@/lib/wsp/text";
import { WspQuestionnaire } from "./questionnaire";
import { WspReportView } from "./report-view";
import { WspDeleteButton, WspSharePanel } from "./share-panel";

/**
 * What the person sees for one assessment, through the personal link or the
 * own account: the intro and questionnaire, or (once completed) the own
 * report first, the permissions per linked client under it and "Delete my
 * profile". Server component; read inside <Suspense>.
 */
export async function WspPersonView({ access, pdfHref, afterDeleteHref }: { access: WspAccess; pdfHref: string; afterDeleteHref: string }) {
  const data = await loadQuestionnaire(access);
  if (!data) {
    return <Message title="Link not found" text="This link is not valid any more. Ask your contact at Nordavo for a new one." />;
  }
  if (data.status === "completed") {
    const report = await loadReport(access);
    if (!report) return <Message title="Report not available" text="Your report could not be opened. Please try again later." />;
    return (
      <div className="space-y-5">
        <WspReportView report={report} audience="person" pdfHref={pdfHref} />
        <WspSharePanel
          assessmentId={report.id}
          clients={report.clients}
          canShare={report.canShare}
          signInHref={`/login?next=${encodeURIComponent("/academy/working-style")}`}
        />
        <WspDeleteButton access={access} afterHref={afterDeleteHref} />
      </div>
    );
  }
  if (data.status === "expired") {
    return (
      <div className="space-y-5">
        <Message
          title="This link has expired"
          text="The link to your Working Style Profile was valid for 14 days. Ask your contact at Nordavo to send it again; the answers you already gave are kept."
        />
        <WspDeleteButton access={access} afterHref={afterDeleteHref} />
      </div>
    );
  }
  return <WspQuestionnaire access={access} data={data} privacyUrl={privacyUrl()} />;
}

export function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-xs">
      <h1 className="font-display text-xl font-bold text-brand-900">{title}</h1>
      <p className="mt-2 text-sm text-muted">{text}</p>
    </div>
  );
}
