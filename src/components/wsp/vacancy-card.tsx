import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getVacancyWsp } from "@/lib/wsp/data";
import { WspVacancyToggle } from "./staff-controls";

/** The vacancy setting of the Working Style Profile. Hidden while the system setting is off. */
export async function WspVacancyCard({ vacancyId }: { vacancyId: string }) {
  const wsp = await getVacancyWsp(vacancyId);
  if (!wsp) return null;
  return (
    <Card>
      <CardHeader title="Working style profile" description="Candidates reaching the trigger stage get the questionnaire, unless their own setting says otherwise." />
      <CardBody>
        <WspVacancyToggle vacancyId={vacancyId} enabled={wsp.enabled} />
      </CardBody>
    </Card>
  );
}
