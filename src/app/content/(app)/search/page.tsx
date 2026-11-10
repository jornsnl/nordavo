import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/skeleton";
import { searchContent, type SearchHit } from "@/lib/content/search";
import { ideaStatuses, statusTone } from "@/lib/content/rules";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage({ searchParams }: PageProps<"/content/search">) {
  return (
    <>
      <PageHeader title="Search" description="Ideas and posts by title, text and tags, within what you may see." />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Results({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = typeof (await searchParams).q === "string" ? ((await searchParams).q as string).trim() : "";
  const results = q ? await searchContent(q) : { ideas: [], posts: [] };
  const total = results.ideas.length + results.posts.length;
  return (
    <div className="space-y-6">
      <form action="/content/search" role="search" className="flex gap-2">
        <label htmlFor="q" className="sr-only">
          Search ideas and posts
        </label>
        <Input id="q" name="q" type="search" defaultValue={q} placeholder="A word, a phrase or #tag" enterKeyHint="search" className="flex-1" />
        <Button type="submit">
          <Search aria-hidden="true" />
          Search
        </Button>
      </form>
      {q && total === 0 && <EmptyState icon={Search} title="Nothing found" description={`No ideas or posts match "${q}". Try a shorter word.`} />}
      {results.posts.length > 0 && <HitList title={`Posts (${results.posts.length})`} hits={results.posts} kind="post" />}
      {results.ideas.length > 0 && <HitList title={`Ideas (${results.ideas.length})`} hits={results.ideas} kind="idea" />}
    </div>
  );
}

function HitList({ title, hits, kind }: { title: string; hits: SearchHit[]; kind: "post" | "idea" }) {
  return (
    <Card>
      <CardHeader title={title} />
      <ul className="divide-y divide-border">
        {hits.map((hit) => {
          const idea = ideaStatuses.find((s) => s.value === hit.status);
          return (
            <li key={hit.id}>
              <Link href={hit.href} className="block px-4 py-3 hover:bg-brand-50/50 sm:px-5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-brand-900">{hit.title}</span>
                  <Badge tone={kind === "idea" ? (idea?.tone ?? "neutral") : statusTone(hit.status)}>
                    {kind === "idea" ? (idea?.label ?? hit.status) : hit.status.replace(/_/g, " ")}
                  </Badge>
                  <span className="text-xs text-muted">{hit.workspace}</span>
                </span>
                {hit.snippet && <span className="mt-0.5 block text-sm text-muted">{hit.snippet}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
