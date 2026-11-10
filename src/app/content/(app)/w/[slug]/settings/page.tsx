import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PageTabs } from "@/components/work/page-tabs";
import { ActionButton, ActionForm, Checkbox, FieldTypeInputs, MoveButtons, TimeSlotInputs } from "@/components/content/settings/forms";
import { DriveFoldersCard } from "@/components/content/media/drive-folders-card";
import { getContentWorkspace, requireContentUser, type ContentWorkspace } from "@/lib/content/data";
import { listContentCandidates, listMembers, listOptionRows } from "@/lib/content/settings";
import { fieldTypes, memberRoles, modules, optionLists, roleLabel } from "@/lib/content/rules";
import {
  addFieldAction,
  addMemberAction,
  addOptionAction,
  addStatusAction,
  moveFieldAction,
  moveOptionAction,
  moveStatusAction,
  removeMemberAction,
  saveGeneralSettingsAction,
  saveModulesAction,
  saveTransitionsAction,
  setFieldArchivedAction,
  setMemberRoleAction,
  setOptionArchivedAction,
  setOwnerAction,
  setStatusArchivedAction,
  setWorkspaceArchivedAction,
  updateFieldAction,
  updateOptionAction,
  updateStatusAction,
} from "@/app/content/actions/settings";

export const metadata: Metadata = { title: "Workspace settings" };

const tabs = [
  { value: "general", label: "General" },
  { value: "modules", label: "Modules" },
  { value: "options", label: "Dropdowns" },
  { value: "fields", label: "Extra fields" },
  { value: "workflow", label: "Statuses and flow" },
  { value: "members", label: "People" },
  { value: "drive", label: "Google Drive" },
] as const;

type Tab = (typeof tabs)[number]["value"];

export default function SettingsPage({ params, searchParams }: PageProps<"/content/w/[slug]/settings">) {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <Settings params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Settings({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const workspace = await getContentWorkspace(slug);
  if (!workspace.canManage) notFound();
  const tab: Tab = tabs.some((t) => t.value === query.tab) ? (query.tab as Tab) : "general";

  return (
    <>
      <PageHeader
        eyebrow={workspace.name}
        title="Settings"
        description="Dropdowns, extra fields, statuses and modules are managed here, not in code. Archiving keeps the history of old posts."
      />
      <div className="mb-6">
        <PageTabs
          label="Settings"
          tabs={tabs.map((t) => ({ label: t.label, href: `/content/w/${slug}/settings?tab=${t.value}`, active: t.value === tab }))}
        />
      </div>
      {tab === "general" && <General workspace={workspace} />}
      {tab === "modules" && <Modules workspace={workspace} />}
      {tab === "options" && <Options workspace={workspace} />}
      {tab === "fields" && <Fields workspace={workspace} />}
      {tab === "workflow" && <Workflow workspace={workspace} />}
      {tab === "members" && <Members workspace={workspace} />}
      {tab === "drive" && <DriveFoldersCard workspaceId={workspace.id} />}
    </>
  );
}

// ---------------------------------------------------------------------------

async function General({ workspace }: { workspace: ContentWorkspace }) {
  const user = await requireContentUser();
  const candidates = user.isAdmin ? await listContentCandidates() : [];
  const slug = workspace.slug;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Workspace" description="Rhythm, buffer and the threshold for a successful post." />
        <CardBody>
          <ActionForm action={saveGeneralSettingsAction.bind(null, slug)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="g_name" required>
                <Input id="g_name" name="name" defaultValue={workspace.name} required maxLength={80} />
              </Field>
              <Field label="Rhythm goal" htmlFor="g_rhythm" hint="Posts per week">
                <Input id="g_rhythm" name="rhythm_goal" type="number" min={0} max={21} defaultValue={workspace.rhythmGoal} />
              </Field>
              <Field label="Buffer target, minimum" htmlFor="g_bmin" hint="Posts in Approved or Scheduled">
                <Input id="g_bmin" name="buffer_min" type="number" min={0} max={100} defaultValue={workspace.bufferMin} />
              </Field>
              <Field label="Buffer target, maximum" htmlFor="g_bmax">
                <Input id="g_bmax" name="buffer_max" type="number" min={0} max={100} defaultValue={workspace.bufferMax} />
              </Field>
              <Field label="Success threshold" htmlFor="g_success" hint="Likes plus comments after 7 days">
                <Input id="g_success" name="success_threshold" type="number" min={0} defaultValue={workspace.successThreshold} />
              </Field>
              <Field label="Photo reuse warning" htmlFor="g_reuse" hint="Months; 0 switches it off">
                <Input id="g_reuse" name="media_reuse_months" type="number" min={0} max={60} defaultValue={workspace.mediaReuseMonths} />
              </Field>
            </div>
            <Checkbox
              name="admin_approval_required"
              label="Admin approval required"
              hint={user.isAdmin ? "For new employees: only an admin can approve posts." : "Set by an admin."}
              defaultChecked={workspace.adminApprovalRequired}
              disabled={!user.isAdmin}
            />
          </ActionForm>
        </CardBody>
      </Card>

      {user.isAdmin && (
        <Card>
          <CardHeader title="Owner and archive" description="The owner is the author of this workspace. Admins only." />
          <CardBody className="space-y-4">
            <ActionForm action={setOwnerAction.bind(null, slug)} submit="Change owner">
              <Field label="Owner" htmlFor="g_owner">
                <Select id="g_owner" name="owner" defaultValue={workspace.ownerId ?? ""}>
                  <option value="">Pick a person</option>
                  {candidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.email ? `(${p.email})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            </ActionForm>
            <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
              <p className="text-sm text-muted">
                {workspace.archived ? "This workspace is archived. Only admins see it." : "Archiving hides the workspace for everyone but admins. Nothing is deleted."}
              </p>
              <ActionButton
                action={setWorkspaceArchivedAction.bind(null, slug, !workspace.archived)}
                variant={workspace.archived ? "secondary" : "danger"}
                confirm={workspace.archived ? undefined : `Archive ${workspace.name}?`}
              >
                {workspace.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                {workspace.archived ? "Restore" : "Archive"}
              </ActionButton>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Modules({ workspace }: { workspace: ContentWorkspace }) {
  return (
    <Card>
      <CardHeader title="Modules" description="Switch parts of the module on or off for this workspace. Data stays when a module is off." />
      <CardBody>
        <ActionForm action={saveModulesAction.bind(null, workspace.slug)}>
          <div className="grid gap-4 sm:grid-cols-2">
            {modules.map((m) => (
              <Checkbox key={m.value} name={m.value} label={m.label} hint={m.description} defaultChecked={workspace.modules[m.value]} />
            ))}
          </div>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

async function Options({ workspace }: { workspace: ContentWorkspace }) {
  const rows = await listOptionRows(workspace.id);
  const slug = workspace.slug;
  return (
    <div className="space-y-6">
      {optionLists.map((list) => {
        const items = rows.filter((r) => r.list === list.value);
        const active = items.filter((r) => !r.archived);
        return (
          <Card key={list.value}>
            <CardHeader
              title={list.label}
              description={
                list.value === "format"
                  ? "Formats that need media cannot be scheduled without chosen media."
                  : list.value === "time_slot"
                    ? "Fixed time slots of this workspace, with the days they are meant for."
                    : undefined
              }
            />
            <CardBody className="space-y-3">
              <ul className="divide-y divide-border">
                {items.map((item) => {
                  const index = active.findIndex((a) => a.id === item.id);
                  return (
                    <li key={item.id} className={`flex flex-wrap items-end gap-3 py-3 ${item.archived ? "opacity-60" : ""}`}>
                      <ActionForm action={updateOptionAction.bind(null, slug, item.id)} inline className="flex flex-1 flex-wrap items-end gap-3">
                        {list.value === "time_slot" ? (
                          <>
                            <TimeSlotInputs
                              id={`o_${item.id}`}
                              time={typeof item.meta.time === "string" ? item.meta.time : item.label}
                              days={Array.isArray(item.meta.weekdays) ? (item.meta.weekdays as number[]) : []}
                            />
                          </>
                        ) : (
                          <Field label="Label" htmlFor={`o_${item.id}`} className="min-w-48 flex-1">
                            <Input id={`o_${item.id}`} name="label" defaultValue={item.label} required maxLength={80} />
                          </Field>
                        )}
                        {list.value === "format" && <Checkbox name="needs_media" label="Needs media" defaultChecked={item.meta.needs_media === true} />}
                      </ActionForm>
                      <span className="flex items-center gap-1">
                        {item.archived && <Badge>Archived</Badge>}
                        {!item.archived && (
                          <MoveButtons
                            up={index > 0 ? moveOptionAction.bind(null, slug, item.id, -1) : null}
                            down={index < active.length - 1 ? moveOptionAction.bind(null, slug, item.id, 1) : null}
                          />
                        )}
                        <ActionButton action={setOptionArchivedAction.bind(null, slug, item.id, !item.archived)} variant="ghost" label={item.archived ? "Restore" : "Archive"}>
                          {item.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                        </ActionButton>
                      </span>
                    </li>
                  );
                })}
                {items.length === 0 && <li className="py-3 text-sm text-muted">No options yet.</li>}
              </ul>
              <ActionForm action={addOptionAction.bind(null, slug)} submit="Add" inline className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
                <input type="hidden" name="list_key" value={list.value} />
                {list.value === "time_slot" ? (
                  <TimeSlotInputs id={`new_${list.value}`} />
                ) : (
                  <Field label="New option" htmlFor={`new_${list.value}`} className="min-w-48 flex-1">
                    <Input id={`new_${list.value}`} name="label" maxLength={80} required />
                  </Field>
                )}
                {list.value === "format" && <Checkbox name="needs_media" label="Needs media" />}
              </ActionForm>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

const entityLabels = { post: "Posts", idea: "Ideas", media: "Media files" } as const;

function Fields({ workspace }: { workspace: ContentWorkspace }) {
  const slug = workspace.slug;
  return (
    <div className="space-y-6">
      {(Object.keys(entityLabels) as (keyof typeof entityLabels)[]).map((entity) => {
        const items = [...workspace.fields[entity]].sort((a, b) => Number(a.archived) - Number(b.archived));
        const active = items.filter((f) => !f.archived);
        return (
          <Card key={entity}>
            <CardHeader title={`Extra fields on ${entityLabels[entity].toLowerCase()}`} description="The type of a field stays fixed once it is made; archive it and add a new one to change it." />
            <CardBody className="space-y-3">
              <ul className="divide-y divide-border">
                {items.map((field) => {
                  const index = active.findIndex((a) => a.id === field.id);
                  const choices = field.type === "single_choice" || field.type === "multiple_choice";
                  return (
                    <li key={field.id} className={`flex flex-wrap items-end gap-3 py-3 ${field.archived ? "opacity-60" : ""}`}>
                      <ActionForm action={updateFieldAction.bind(null, slug, field.id)} inline className="flex flex-1 flex-wrap items-end gap-3">
                        <Field label="Label" htmlFor={`f_${field.id}`} className="min-w-48 flex-1">
                          <Input id={`f_${field.id}`} name="label" defaultValue={field.label} required maxLength={80} />
                        </Field>
                        {choices && (
                          <Field label="Choices" htmlFor={`fc_${field.id}`} hint="One per line" className="min-w-48 flex-1">
                            <Textarea id={`fc_${field.id}`} name="choices" rows={2} defaultValue={field.choices.join("\n")} />
                          </Field>
                        )}
                        {field.type === "relation" && <input type="hidden" name="target" value={field.target ?? "post"} />}
                      </ActionForm>
                      <span className="flex items-center gap-2">
                        <Badge tone="brand">{fieldTypes.find((t) => t.value === field.type)?.label ?? field.type}</Badge>
                        {field.archived && <Badge>Archived</Badge>}
                        {!field.archived && (
                          <MoveButtons
                            up={index > 0 ? moveFieldAction.bind(null, slug, field.id, -1) : null}
                            down={index < active.length - 1 ? moveFieldAction.bind(null, slug, field.id, 1) : null}
                          />
                        )}
                        <ActionButton action={setFieldArchivedAction.bind(null, slug, field.id, !field.archived)} variant="ghost" label={field.archived ? "Restore" : "Archive"}>
                          {field.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                        </ActionButton>
                      </span>
                    </li>
                  );
                })}
                {items.length === 0 && <li className="py-3 text-sm text-muted">No extra fields yet.</li>}
              </ul>
              <ActionForm action={addFieldAction.bind(null, slug)} submit="Add field" className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                <input type="hidden" name="entity" value={entity} />
                <Field label="New field" htmlFor={`nf_${entity}`}>
                  <Input id={`nf_${entity}`} name="label" maxLength={80} required />
                </Field>
                <FieldTypeInputs id={`nf_${entity}`} types={fieldTypes} />
              </ActionForm>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

function Workflow({ workspace }: { workspace: ContentWorkspace }) {
  const slug = workspace.slug;
  const statuses = [...workspace.statuses].sort((a, b) => Number(a.archived) - Number(b.archived) || a.position - b.position);
  const active = statuses.filter((s) => !s.archived);
  const allowed = new Set(workspace.transitions.map((t) => `${t.from}:${t.to}`));
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Statuses"
          description="Rename, reorder and decide who may set each status. The rules stay on the built-in ones: only the author (or an admin) approves, Scheduled needs approval, a date, a time slot and media where the format needs it, Published needs the LinkedIn URL, Measured needs the 7 day results."
        />
        <CardBody className="space-y-3">
          <ul className="divide-y divide-border">
            {statuses.map((status) => {
              const index = active.findIndex((a) => a.key === status.key);
              return (
                <li key={status.key} className={`flex flex-wrap items-end gap-3 py-3 ${status.archived ? "opacity-60" : ""}`}>
                  <ActionForm action={updateStatusAction.bind(null, slug, status.key)} inline className="flex flex-1 flex-wrap items-end gap-4">
                    <Field label="Label" htmlFor={`s_${status.key}`} className="min-w-44 flex-1">
                      <Input id={`s_${status.key}`} name="label" defaultValue={status.label} required maxLength={60} />
                    </Field>
                    <fieldset className="flex gap-4 pb-2.5">
                      <legend className="sr-only">Who may set it</legend>
                      <Checkbox name="role_author" label="Author" defaultChecked={status.allowedRoles.includes("author")} />
                      <Checkbox
                        name="role_reviewer"
                        label="Reviewer"
                        defaultChecked={status.allowedRoles.includes("reviewer")}
                        disabled={status.key === "approved"}
                      />
                    </fieldset>
                  </ActionForm>
                  <span className="flex items-center gap-2">
                    {status.isCore ? <Badge tone="brand">Built in</Badge> : status.archived ? <Badge>Archived</Badge> : null}
                    {!status.archived && (
                      <MoveButtons
                        up={index > 0 ? moveStatusAction.bind(null, slug, status.key, -1) : null}
                        down={index < active.length - 1 ? moveStatusAction.bind(null, slug, status.key, 1) : null}
                      />
                    )}
                    {!status.isCore && (
                      <ActionButton action={setStatusArchivedAction.bind(null, slug, status.key, !status.archived)} variant="ghost" label={status.archived ? "Restore" : "Archive"}>
                        {status.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                      </ActionButton>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <ActionForm action={addStatusAction.bind(null, slug)} submit="Add status" inline className="flex flex-wrap items-end gap-4 border-t border-border pt-4">
            <Field label="New status" htmlFor="s_new" className="min-w-44 flex-1">
              <Input id="s_new" name="label" maxLength={60} required />
            </Field>
            <fieldset className="flex gap-4 pb-2.5">
              <legend className="sr-only">Who may set it</legend>
              <Checkbox name="role_author" label="Author" defaultChecked />
              <Checkbox name="role_reviewer" label="Reviewer" />
            </fieldset>
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Flow"
          description="Which status may follow which (row: from, column: to). Parked and Rejected are always reachable. Admins are not bound to the flow, only to the rules."
        />
        <CardBody>
          <ActionForm action={saveTransitionsAction.bind(null, slug)} submit="Save flow">
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="text-sm">
                <thead>
                  <tr>
                    <th className="p-2 text-left text-xs font-medium text-muted">From \ to</th>
                    {active.map((to) => (
                      <th key={to.key} className="p-2 text-xs font-medium text-muted">
                        <span className="block max-w-20 truncate" title={to.label}>
                          {to.label}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {active.map((from) => (
                    <tr key={from.key} className="border-t border-border">
                      <th scope="row" className="p-2 text-left font-medium whitespace-nowrap">
                        {from.label}
                      </th>
                      {active.map((to) => (
                        <td key={to.key} className="p-2 text-center">
                          {from.key === to.key ? (
                            <span className="text-muted" aria-hidden="true">
                              ·
                            </span>
                          ) : (
                            <input
                              type="checkbox"
                              name={`t:${from.key}:${to.key}`}
                              defaultChecked={allowed.has(`${from.key}:${to.key}`)}
                              aria-label={`${from.label} to ${to.label}`}
                              className="size-4 accent-brand-700"
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}

async function Members({ workspace }: { workspace: ContentWorkspace }) {
  const user = await requireContentUser();
  const [members, candidates] = await Promise.all([listMembers(workspace.id, workspace.ownerId), listContentCandidates()]);
  const slug = workspace.slug;
  const memberIds = new Set(members.map((m) => m.id));
  return (
    <Card>
      <CardHeader
        title="People"
        description={
          user.isAdmin
            ? "Authors own a workspace, reviewers can be linked to several workspaces, viewers only read. Portal admins see every workspace."
            : "Only an admin adds or removes people."
        }
      />
      <CardBody className="space-y-4">
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {m.name} {m.isOwner && <Badge tone="brand">Owner</Badge>}
                </p>
                {m.email && <p className="truncate text-xs text-muted">{m.email}</p>}
              </div>
              {user.isAdmin && !m.isOwner ? (
                <span className="flex items-center gap-1">
                  {memberRoles.map((r) => (
                    <ActionButton
                      key={r.value}
                      action={setMemberRoleAction.bind(null, slug, m.id, r.value)}
                      variant={m.role === r.value ? "primary" : "ghost"}
                    >
                      {r.label}
                    </ActionButton>
                  ))}
                  <ActionButton action={removeMemberAction.bind(null, slug, m.id)} variant="ghost" label="Remove" confirm={`Remove ${m.name} from ${workspace.name}?`}>
                    <Trash2 aria-hidden="true" />
                  </ActionButton>
                </span>
              ) : (
                <Badge tone={roleLabel(m.role).tone}>{roleLabel(m.role).label}</Badge>
              )}
            </li>
          ))}
          {members.length === 0 && <li className="py-3 text-sm text-muted">Nobody yet.</li>}
        </ul>
        {user.isAdmin && (
          <ActionForm action={addMemberAction.bind(null, slug)} submit="Add" inline className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
            <Field label="Person" htmlFor="m_user" className="min-w-56 flex-1">
              <Select id="m_user" name="user_id" defaultValue="" required>
                <option value="">Pick a person</option>
                {candidates
                  .filter((p) => !memberIds.has(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.email ? `(${p.email})` : ""}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Role" htmlFor="m_role">
              <Select id="m_role" name="role" defaultValue="reviewer">
                {memberRoles.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
          </ActionForm>
        )}
        {user.isAdmin && (
          <p className="text-xs text-muted">
            People need an account first: invite freelancers (such as a reviewer) in Work, team members in the portal settings.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
