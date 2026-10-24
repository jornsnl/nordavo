import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import Form from "next/form";
import { redirect } from "next/navigation";
import { Plus, Search, SearchX, Users } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { AutoSubmitSelects } from "@/components/entity/auto-submit";
import { FilterChips, filterHref } from "@/components/entity/filter-chips";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { getApplicationVacancyId } from "@/lib/data/applications";
import { listCandidateSkills, listCandidates } from "@/lib/data/candidates";
import type { CandidateStatus } from "@/lib/database.types";
import { candidateStatuses, optionFor } from "@/lib/labels";

export const metadata: Metadata = {
  title: "Kandidaten",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

export default function Page({ searchParams }: PageProps<"/dashboard/kandidaten">) {
  return (
    <>
      <PageHeader
        eyebrow="Werving"
        title="Kandidaten"
        description="Developers en data engineers uit Bangalore, van screening tot eindgesprek."
        actions={
          <ButtonLink href="/dashboard/kandidaten/nieuw">
            <Plus aria-hidden="true" />
            Nieuwe kandidaat
          </ButtonLink>
        }
      />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <CandidateList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function CandidateList({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  // Links to an application (activity log, tasks) land on its pipeline.
  const applicationId = first(params.application);
  if (applicationId) {
    const vacancyId = await getApplicationVacancyId(applicationId);
    if (vacancyId) {
      redirect(`/dashboard/vacatures/${vacancyId}/pipeline?application=${applicationId}`);
    }
  }

  const q = first(params.q);
  const statusParam = first(params.status);
  const status = candidateStatuses.some((s) => s.value === statusParam)
    ? (statusParam as CandidateStatus)
    : undefined;
  const skill = first(params.skill);

  const [candidates, skills] = await Promise.all([
    listCandidates({ q, status, skill }),
    listCandidateSkills(),
  ]);
  const filtered = !!(q || status || skill);
  const current = { q, status, skill };

  return (
    <div className="space-y-4">
      <Form
        action="/dashboard/kandidaten"
        role="search"
        aria-label="Kandidaten zoeken"
        className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:rounded-2xl sm:border sm:border-border sm:bg-card sm:p-3 sm:shadow-xs"
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <label htmlFor="candidate-q" className="sr-only">
            Zoek op naam, functie of skill
          </label>
          <Input
            id="candidate-q"
            name="q"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            defaultValue={q}
            placeholder="Zoek op naam, functie of skill"
            className="pl-10"
          />
        </div>
        {/* Phones: status as chips, the skill applies as soon as it changes. */}
        <FilterChips
          label="Status"
          className="sm:hidden"
          chips={[
            { label: "Alle", href: filterHref("/dashboard/kandidaten", current, { status: undefined }), active: !status },
            ...candidateStatuses.map((s) => ({
              label: s.label,
              href: filterHref("/dashboard/kandidaten", current, { status: s.value }),
              active: status === s.value,
            })),
          ]}
        />
        <div className="max-sm:hidden">
          <label htmlFor="candidate-status" className="sr-only">
            Status
          </label>
          <Select id="candidate-status" name="status" defaultValue={status ?? ""}>
            <option value="">Alle statussen</option>
            {candidateStatuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <AutoSubmitSelects className="flex gap-2 sm:block">
          <label htmlFor="candidate-skill" className="sr-only">
            Skill
          </label>
          <Select id="candidate-skill" name="skill" defaultValue={skill ?? ""} className="max-sm:w-full">
            <option value="">Alle skills</option>
            {skill && !skills.includes(skill) && <option value={skill}>{skill}</option>}
            {skills.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          {filtered && (
            <ButtonLink href="/dashboard/kandidaten" variant="ghost" className="shrink-0 sm:hidden">
              Wissen
            </ButtonLink>
          )}
        </AutoSubmitSelects>
        <div className="flex gap-2 max-sm:hidden">
          <Button type="submit" variant="secondary" className="flex-1">
            Filteren
          </Button>
          {filtered && (
            <ButtonLink href="/dashboard/kandidaten" variant="ghost">
              Wissen
            </ButtonLink>
          )}
        </div>
      </Form>

      {candidates.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="Geen kandidaten gevonden"
            description="Niemand past bij deze zoekopdracht. Pas je filters aan of wis ze."
          />
        ) : (
          <EmptyState
            icon={Users}
            title="Nog geen kandidaten"
            description="Voeg je eerste kandidaat toe met cv, skills en video-intro. Daarna koppel je hem aan een vacature."
          />
        )
      ) : (
        <>
          <p className="text-sm text-muted" aria-live="polite">
            {candidates.length === 1 ? "1 kandidaat" : `${candidates.length} kandidaten`}
          </p>
          <MobileList label="Kandidaten" className="md:hidden">
            {candidates.map((c) => {
              const statusOption = optionFor(candidateStatuses, c.status);
              return (
                <MobileListItem
                  key={c.id}
                  href={`/dashboard/kandidaten/${c.id}`}
                  leading={<Avatar name={c.full_name} />}
                  title={c.full_name}
                  subtitle={[c.current_title, c.years_experience !== null ? `${c.years_experience} jr` : null]
                    .filter(Boolean)
                    .join(" · ") || "Functie onbekend"}
                  meta={`${c.location}${c.activeApplications > 0 ? ` · ${c.activeApplications} actief` : ""}`}
                >
                  {/* Status sits with the skills, so the name gets the full width. */}
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={statusOption.tone}>{statusOption.label}</Badge>
                    {c.skills.slice(0, 3).map((s) => (
                      <Badge key={s}>{s}</Badge>
                    ))}
                    {c.skills.length > 3 && <Badge tone="brand">+{c.skills.length - 3}</Badge>}
                  </div>
                </MobileListItem>
              );
            })}
          </MobileList>
          <Table className="hidden md:block">
            <THead>
              <tr>
                <TH>Naam</TH>
                <TH>Functie</TH>
                <TH className="text-right">Ervaring</TH>
                <TH>Skills</TH>
                <TH>Status</TH>
                <TH className="text-right">Actief</TH>
              </tr>
            </THead>
            <TBody>
              {candidates.map((c) => {
                const statusOption = optionFor(candidateStatuses, c.status);
                return (
                  <TR key={c.id}>
                    <TD>
                      <Link
                        href={`/dashboard/kandidaten/${c.id}`}
                        className="flex items-center gap-3 font-medium text-brand-900 hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
                      >
                        <Avatar name={c.full_name} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate">{c.full_name}</span>
                          <span className="block truncate text-xs font-normal text-muted">{c.location}</span>
                        </span>
                      </Link>
                    </TD>
                    <TD className="text-muted">{c.current_title ?? "Onbekend"}</TD>
                    <TD className="text-right whitespace-nowrap tabular-nums">
                      {c.years_experience !== null ? `${c.years_experience} jr` : "Onbekend"}
                    </TD>
                    <TD>
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {c.skills.slice(0, 4).map((s) => (
                          <Badge key={s}>{s}</Badge>
                        ))}
                        {c.skills.length > 4 && <Badge tone="brand">+{c.skills.length - 4}</Badge>}
                        {c.skills.length === 0 && <span className="text-muted">Geen</span>}
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={statusOption.tone}>{statusOption.label}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums">
                      <span className="sr-only">Actieve sollicitaties: </span>
                      {c.activeApplications}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </>
      )}
    </div>
  );
}
