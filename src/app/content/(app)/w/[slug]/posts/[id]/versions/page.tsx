import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { ListSkeleton } from "@/components/ui/skeleton";
import { VersionCompare } from "@/components/content/post/version-compare";
import { RestoreVersionButton } from "@/components/content/post/restore-version-button";
import { getContentWorkspace } from "@/lib/content/data";
import { listVersions, type VersionItem } from "@/lib/content/posts";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Versions" };

export default function VersionsPage({ params, searchParams }: PageProps<"/content/w/[slug]/posts/[id]/versions">) {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <Versions params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function texts(v: VersionItem) {
  return { title: v.title, hook: v.hook, body: v.body, closing_question: v.closing_question, first_comment: v.first_comment };
}

async function Versions({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug, id }, query] = await Promise.all([params, searchParams]);
  const workspace = await getContentWorkspace(slug);
  const { title, versions } = await listVersions(workspace, id);
  const pick = (value: unknown, fallback: VersionItem | undefined) =>
    versions.find((v) => String(v.version) === value) ?? fallback;
  const to = pick(query.to, versions[0]);
  const from = pick(query.from, versions.find((v) => to && v.version < to.version) ?? versions[versions.length - 1]);
  const canRestore = workspace.role === "admin" || workspace.role === "author";

  return (
    <>
      <Link href={`/content/w/${slug}/posts/${id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-brand-900">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {title}
      </Link>
      <PageHeader eyebrow={workspace.name} title="Versions" description="Every save of the text is a version. Compare any two." />

      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <ol className="space-y-1.5">
          {versions.map((v) => (
            <li key={v.version}>
              <Link
                href={`?from=${from?.version ?? v.version}&to=${v.version}`}
                scroll={false}
                className={`block rounded-xl border px-3 py-2 text-sm ${
                  to?.version === v.version ? "border-brand-500 bg-brand-50" : "border-border bg-card hover:border-brand-200"
                }`}
              >
                <span className="font-medium text-brand-900">Version {v.version}</span>
                <span className="block text-xs text-muted">
                  {v.editorName} · {formatDateTime(v.created_at)}
                </span>
              </Link>
            </li>
          ))}
        </ol>

        <div className="min-w-0 space-y-4">
          {from && to && (
            <>
              <form method="get" className="flex flex-wrap items-center gap-2 text-sm">
                <label htmlFor="v-from">Compare</label>
                <Select id="v-from" name="from" defaultValue={String(from.version)} className="w-32">
                  {versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      Version {v.version}
                    </option>
                  ))}
                </Select>
                <label htmlFor="v-to">with</label>
                <Select id="v-to" name="to" defaultValue={String(to.version)} className="w-32">
                  {versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      Version {v.version}
                    </option>
                  ))}
                </Select>
                <Button type="submit" variant="secondary" size="sm">
                  Compare
                </Button>
                {canRestore && to.version !== versions[0]?.version && <RestoreVersionButton slug={slug} postId={id} version={to.version} />}
              </form>
              <VersionCompare before={texts(from)} after={texts(to)} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
