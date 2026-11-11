import { loadConsentState, loadQuestionnaire, loadReport, type WspAccess } from "@/lib/wsp/data";
import { privacyUrl } from "@/lib/wsp/text";
import { WspQuestionnaire } from "./questionnaire";
import { WspReportView } from "./report-view";
import { WspConsentPanel, WspDeleteButton } from "./share-panel";
import { WspResultSummary } from "./result-summary";

/**
 * What the person sees for one assessment, through the personal link or the
 * own account: the intro and questionnaire, or (once completed) the own
 * report first and the one question about sharing (feedback Julius: on the
 * last screen a short result with the question under it; asked once more
 * after Not now), the sharing status and "Delete my profile". Server
 * component; read inside <Suspense>.
 */
export async function WspPersonView({ access, pdfHref, afterDeleteHref }: { access: WspAccess; pdfHref: string; afterDeleteHref: string }) {
  const data = await loadQuestionnaire(access);
  if (!data) {
    return <Message title="Link not found" text="This link is not valid any more. Ask your contact at Nordavo for a new one." />;
  }
  if (data.status === "completed") {
    const [report, consent] = await Promise.all([loadReport(access), loadConsentState(access)]);
    if (!report) return <Message title="Report not available" text="Your report could not be opened. Please try again later." />;
    const ask = Boolean(consent?.mayAsk && !consent.consented);
    return (
      <div className="space-y-5">
        {ask && consent && (
          <>
            <WspResultSummary report={report} />
            <WspConsentPanel access={access} state={consent} via={report.completedAt && isRecent(report.completedAt) ? "questionnaire" : "report"} prompt />
          </>
        )}
        <WspReportView report={report} audience="person" pdfHref={pdfHref} />
        {consent && !ask && <WspConsentPanel access={access} state={consent} via={"assessmentId" in access ? "academy" : "report"} />}
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

/** Completed in the last hour: the answer on the last screen of the questionnaire. */
function isRecent(iso: string) {
  return Date.now() - new Date(iso).getTime() < 60 * 60 * 1000;
}
