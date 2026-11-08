import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StageNoteForm, type NoteTarget } from "@/components/pipeline/stage-note-form";
import { StageNoteList } from "@/components/pipeline/stage-note-list";
import { getCandidateRecruitment } from "@/lib/data/recruitment";
import { applicationStages, optionFor } from "@/lib/labels";
import { isExitStage } from "@/lib/recruitment/pipeline";
import { ParkCandidateControl, TopperControl } from "./recruitment-controls";

/**
 * Recruitment on the candidate page: topper mark (2.13), parking (2.3) and
 * notes per stage across all vacancies (2.4).
 */
export async function RecruitmentPanel({ candidateId }: { candidateId: string }) {
  const data = await getCandidateRecruitment(candidateId);
  if (!data) return null;
  const { candidate, applications, notes } = data;

  const active = applications.filter((a) => !isExitStage(a.stage) && a.stage !== "placed");
  const targets: NoteTarget[] = [
    { value: "candidate", label: "The candidate in general" },
    ...applications.map((a) => ({
      value: `application:${a.id}`,
      label: `${a.vacancyTitle} (${optionFor(applicationStages, a.stage).label})`,
    })),
  ];

  return (
    <>
      <Card>
        <CardHeader title="Topper and parking" />
        <CardBody className="grid gap-6 sm:grid-cols-2">
          <TopperControl
            candidateId={candidate.id}
            name={candidate.full_name}
            isTopper={candidate.is_topper}
            reason={candidate.topper_reason}
            byName={candidate.topperByName}
            at={candidate.topper_at}
          />
          <ParkCandidateControl
            candidateId={candidate.id}
            name={candidate.full_name}
            parked={candidate.status === "parked"}
            reason={candidate.park_reason}
            parkedAt={candidate.parked_at}
            activeApplications={active.map((a) => ({ id: a.id, vacancyTitle: a.vacancyTitle, stage: a.stage }))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Notes per stage"
          description="Calls, screenings and reviews, kept with the stage the candidate was in."
        />
        <CardBody className="space-y-6">
          <StageNoteForm candidateId={candidate.id} targets={targets} defaultKind="call" />
          <StageNoteList notes={notes} showVacancy />
        </CardBody>
      </Card>
    </>
  );
}
