import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import Form from "next/form";
import { redirect } from "next/navigation";
import { GraduationCap, Plus, Search, SearchX, Sparkles, Star, Upload, Users } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { ExportCsvLink } from "@/components/custom-fields/export-link";
import { AutoSubmitSelects } from "@/components/entity/auto-submit";
import { FilterChips, filterHref } from "@/components/entity/filter-chips";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { MobileList, MobileListItem } from "@/components/ui/mobile-list";
import { ListSkeleton } from "@/components/ui/skeleton";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { getApplicationVacancyId } from "@/lib/data/applications";
import { listCandidateSkills, listCandidates } from "@/lib/data/candidates";
import { listAcademyColumns } from "@/lib/academy/ats/data";
import type { CandidateStatus } from "@/lib/database.types";
import { candidateStatuses, optionFor } from "@/lib/labels";
import { CustomFieldCells, CustomFieldFilters, CustomFieldHeaders, CustomFieldSummary } from "@/components/custom-fields/list-columns";
import { candidateListFields } from "@/lib/custom-fields/list";

export const metadata: Metadata = {
  title: "Candidates",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

export default function Page({ searchParams }: PageProps<"/dashboard/candidates">) {
  return (
    <>
      <PageHeader
        eyebrow="Recruitment"
        title="Candidates"
        description="Developers and data engineers from Bangalore, from screening to final interview."
        actions={
          <>
            <ButtonLink href="/dashboard/candidates/talent-pool" variant="secondary">
              <Sparkles aria-hidden="true" />
              Talent pool
            </ButtonLink>
            <ButtonLink href="/dashboard/candidates/academy" variant="secondary">
              <GraduationCap aria-hidden="true" />
              Academy results
            </ButtonLink>
            <ExportCsvLink href="/dashboard/candidates/export" />
            <ButtonLink href="/dashboard/candidates/import" variant="secondary">
              <Upload aria-hidden="true" />
              Import
            </ButtonLink>
            <ButtonLink href="/dashboard/candidates/new">
              <Plus aria-hidden="true" />
              New candidate
            </ButtonLink>
          </>
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
      redirect(`/dashboard/vacancies/${vacancyId}/pipeline?application=${applicationId}`);
    }
  }

  const q = first(params.q);
  const statusParam = first(params.status);
  const status = candidateStatuses.some((s) => s.value === statusParam)
    ? (statusParam as CandidateStatus)
    : undefined;
  const skill = first(params.skill);
  const toppers = first(params.toppers) === "1" ? "1" : undefined;

  const [found, skills, customFields] = await Promise.all([
    listCandidates({ q, status, skill, toppers: !!toppers }),
    listCandidateSkills(),
    candidateListFields(params),
  ]);
  const candidates = customFields.apply(found);
  // Academy to ATS (docs/academy.md): progress in the developer course, live.
  const academy = await listAcademyColumns(candidates.map((c) => c.id));
  const filtered = !!(q || status || skill || toppers) || customFields.filters.length > 0;
  const current = { q, status, skill, toppers };

  return (
    <div className="space-y-4">
      <Form
        action="/dashboard/candidates"
        role="search"
        aria-label="Search candidates"
        className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:rounded-2xl sm:border sm:border-border sm:bg-card sm:p-3 sm:shadow-xs"
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <label htmlFor="candidate-q" className="sr-only">
            Search by name, role or skill
          </label>
          <Input
            id="candidate-q"
            name="q"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            defaultValue={q}
            placeholder="Search by name, role or skill"
            className="pl-10"
          />
        </div>
        {/* Phones: status as chips, the skill applies as soon as it changes. */}
        <FilterChips
          label="Status"
          className="sm:hidden"
          chips={[
            { label: "All", href: filterHref("/dashboard/candidates", current, { status: undefined }), active: !status },
            ...candidateStatuses.map((s) => ({
              label: s.label,
              href: filterHref("/dashboard/candidates", current, { status: s.value }),
              active: status === s.value,
            })),
          ]}
        />
        <div className="max-sm:hidden">
          <label htmlFor="candidate-status" className="sr-only">
            Status
          </label>
          <Select id="candidate-status" name="status" defaultValue={status ?? ""}>
            <option value="">All statuses</option>
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
          <SearchSelect
            id="candidate-skill"
            name="skill"
            defaultValue={skill ?? null}
            className="max-sm:w-full sm:w-48"
            placeholder="All skills"
            searchPlaceholder="Search skills"
            submitOnChange
            options={[...(skill && !skills.includes(skill) ? [skill] : []), ...skills].map((s) => ({ value: s, label: s }))}
          />
          {filtered && (
            <ButtonLink href="/dashboard/candidates" variant="ghost" className="shrink-0 sm:hidden">
              Clear
            </ButtonLink>
          )}
        </AutoSubmitSelects>
        {/* Toppers only (2.13): a checkbox on desktop, a chip on phones. */}
        <label className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-medium text-ink max-sm:hidden has-checked:border-amber-500 has-checked:bg-amber-50">
          <input type="checkbox" name="toppers" value="1" defaultChecked={!!toppers} className="size-4 accent-amber-500" />
          <Star className="size-4 text-amber-500" aria-hidden="true" />
          Toppers only
        </label>
        <FilterChips
          label="Toppers"
          className="sm:hidden"
          chips={[
            {
              label: toppers ? "Toppers only" : "Show toppers only",
              href: filterHref("/dashboard/candidates", current, { toppers: toppers ? undefined : "1" }),
              active: !!toppers,
            },
          ]}
        />
        <div className="flex gap-2 max-sm:hidden">
          <Button type="submit" variant="secondary" className="flex-1">
            Filter
          </Button>
          {filtered && (
            <ButtonLink href="/dashboard/candidates" variant="ghost">
              Clear
            </ButtonLink>
          )}
        </div>
      </Form>
      <CustomFieldFilters fields={customFields} />

      {candidates.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="No candidates found"
            description="Nobody matches this search. Adjust or clear your filters."
          />
        ) : (
          <EmptyState
            icon={Users}
            title="No candidates yet"
            description="Add your first candidate with a CV, skills and video intro. Then link them to a vacancy."
          />
        )
      ) : (
        <>
          <p className="text-sm text-muted" aria-live="polite">
            {candidates.length === 1 ? "1 candidate" : `${candidates.length} candidates`}
          </p>
          <MobileList label="Candidates" className="md:hidden">
            {candidates.map((c) => {
              const statusOption = optionFor(candidateStatuses, c.status);
              return (
                <MobileListItem
                  key={c.id}
                  href={`/dashboard/candidates/${c.id}`}
                  leading={<Avatar name={c.full_name} />}
                  title={c.full_name}
                  subtitle={[c.current_title, c.years_experience !== null ? `${c.years_experience} yrs` : null]
                    .filter(Boolean)
                    .join(" · ") || "Role unknown"}
                  meta={`${c.location}${c.activeApplications > 0 ? ` · ${c.activeApplications} active` : ""}`}
                >
                  {/* Status sits with the skills, so the name gets the full width. */}
                  <div className="flex flex-wrap gap-1">
                    {c.is_topper && (
                      <Badge tone="warning">
                        <Star className="size-3 fill-amber-400 text-amber-500" aria-hidden="true" />
                        Topper
                      </Badge>
                    )}
                    <Badge tone={statusOption.tone}>{statusOption.label}</Badge>
                    {c.skills.slice(0, 3).map((s) => (
                      <Badge key={s}>{s}</Badge>
                    ))}
                    {c.skills.length > 3 && <Badge tone="brand">+{c.skills.length - 3}</Badge>}
                  </div>
                  <CustomFieldSummary fields={customFields} id={c.id} />
                </MobileListItem>
              );
            })}
          </MobileList>
          <Table className="hidden md:block">
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH className="text-right">Experience</TH>
                <TH>Skills</TH>
                <CustomFieldHeaders fields={customFields} />
                <TH>Status</TH>
                <TH className="text-right">Academy</TH>
                <TH className="text-right">Active</TH>
              </tr>
            </THead>
            <TBody>
              {candidates.map((c) => {
                const statusOption = optionFor(candidateStatuses, c.status);
                return (
                  <TR key={c.id}>
                    <TD>
                      <Link
                        href={`/dashboard/candidates/${c.id}`}
                        className="flex items-center gap-3 font-medium text-brand-900 hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
                      >
                        <Avatar name={c.full_name} size="sm" />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1 truncate">
                            {c.is_topper && (
                              <Star
                                className="size-3.5 shrink-0 fill-amber-400 text-amber-500"
                                aria-label="Topper"
                              />
                            )}
                            {c.full_name}
                          </span>
                          <span className="block truncate text-xs font-normal text-muted">{c.location}</span>
                        </span>
                      </Link>
                    </TD>
                    <TD className="text-muted">{c.current_title ?? "Unknown"}</TD>
                    <TD className="text-right whitespace-nowrap tabular-nums">
                      {c.years_experience !== null ? `${c.years_experience} yrs` : "Unknown"}
                    </TD>
                    <TD>
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {c.skills.slice(0, 4).map((s) => (
                          <Badge key={s}>{s}</Badge>
                        ))}
                        {c.skills.length > 4 && <Badge tone="brand">+{c.skills.length - 4}</Badge>}
                        {c.skills.length === 0 && <span className="text-muted">None</span>}
                      </div>
                    </TD>
                    <CustomFieldCells fields={customFields} id={c.id} />
                    <TD>
                      <Badge tone={statusOption.tone}>{statusOption.label}</Badge>
                    </TD>
                    <TD className="text-right whitespace-nowrap tabular-nums">
                      <AcademyCell value={academy.get(c.id)} />
                    </TD>
                    <TD className="text-right tabular-nums">
                      <span className="sr-only">Active applications: </span>
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

function AcademyCell({ value }: { value: { enrolled: boolean; progress: number; inactive: boolean; certificate: boolean } | undefined }) {
  if (!value?.enrolled) return <span className="text-muted">–</span>;
  return (
    <span className={value.inactive ? "font-medium text-danger" : undefined} title={value.inactive ? "Inactive for 14 days" : undefined}>
      {value.certificate ? "✓ " : ""}
      {value.progress}%
    </span>
  );
}
