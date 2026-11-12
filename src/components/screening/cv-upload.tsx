"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { FileUp, LoaderCircle, Play, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormMessage, Select } from "@/components/ui/field";
import type { CandidateOrigin, CandidateSource } from "@/lib/database.types";
import { candidateOrigins, candidateSources } from "@/lib/labels";
import { cvFileKind, MAX_CV_BYTES } from "@/lib/screening/cv-text";
import { uploadCvAction, type CvUploadActionResult } from "@/app/dashboard/vacancies/screening-actions";

type Item = {
  file: File;
  status: "waiting" | "uploading" | "done" | "failed";
  result?: Extract<CvUploadActionResult, { ok: true }>["result"];
  error?: string;
};

const MAX_FILES = 300;

/**
 * Bulk CV upload (2.6.2): drop many PDF or DOCX files; they go to the
 * server one after the other, each is read, matched to an existing
 * candidate (email, phone or LinkedIn in the CV, else a unique name) or
 * creates a new one, and with a vacancy lands in it as Sourced.
 */
export function CvUpload({ vacancyId = null, claude }: { vacancyId?: string | null; claude: boolean }) {
  const inputId = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [source, setSource] = useState<CandidateSource>("other");
  const [origin, setOrigin] = useState<CandidateOrigin>("applied");
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const stopRef = useRef(false);

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const files = [...list];
    const accepted: Item[] = [];
    let rejected = 0;
    for (const file of files) {
      if (!cvFileKind(file.name, file.type)) {
        rejected += 1;
        continue;
      }
      accepted.push(file.size > MAX_CV_BYTES ? { file, status: "failed", error: `Larger than ${MAX_CV_BYTES / 1024 / 1024} MB` } : { file, status: "waiting" });
    }
    setItems((current) => {
      const names = new Set(current.map((i) => `${i.file.name}:${i.file.size}`));
      const fresh = accepted.filter((i) => !names.has(`${i.file.name}:${i.file.size}`));
      return [...current, ...fresh].slice(0, MAX_FILES);
    });
    setNotice(rejected > 0 ? `${rejected} ${rejected === 1 ? "file was" : "files were"} left out: only PDF and DOCX files are read.` : null);
  }

  async function start() {
    stopRef.current = false;
    setRunning(true);
    for (let i = 0; i < items.length; i += 1) {
      if (stopRef.current) break;
      if (items[i].status !== "waiting") continue;
      setItems((all) => all.map((it, n) => (n === i ? { ...it, status: "uploading" } : it)));
      const form = new FormData();
      form.set("file", items[i].file);
      if (vacancyId) form.set("vacancy_id", vacancyId);
      form.set("source", source);
      form.set("origin", origin);
      let response: CvUploadActionResult;
      try {
        response = await uploadCvAction(form);
      } catch {
        response = { ok: false, error: "The connection to the server was lost." };
      }
      setItems((all) =>
        all.map((it, n) => (n === i ? (response.ok ? { ...it, status: "done", result: response.result } : { ...it, status: "failed", error: response.error }) : it)),
      );
    }
    setRunning(false);
  }

  const waiting = items.filter((i) => i.status === "waiting").length;
  const done = items.filter((i) => i.status === "done");
  const created = done.filter((i) => i.result?.outcome === "created").length;
  const matched = done.filter((i) => i.result?.outcome === "matched").length;
  const pending = done.filter((i) => i.result?.textStatus === "pending").length;
  const failed = items.filter((i) => i.status === "failed").length;

  return (
    <div className="space-y-6">
      {!claude && (
        <p className="rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-brand-900">
          DOCX files and simple PDFs are read in code; other PDFs are stored with their text marked pending, and Claude reads them
          through the MCP in its scheduled task claude-screening before it scores them. Names, email and phone are found in the text by pattern.
        </p>
      )}
      <Card>
        <CardHeader title="1. Source and origin" description="Applied to every CV in this upload, on the candidate and on the application." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Source" htmlFor="cv-source">
            <Select id="cv-source" value={source} disabled={running} onChange={(e) => setSource(e.target.value as CandidateSource)}>
              {candidateSources.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Origin" htmlFor="cv-origin">
            <Select id="cv-origin" value={origin} disabled={running} onChange={(e) => setOrigin(e.target.value as CandidateOrigin)}>
              {candidateOrigins.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="2. Drop the CVs" description={`PDF or DOCX, at most ${MAX_CV_BYTES / 1024 / 1024} MB each and ${MAX_FILES} at a time.`} />
        <CardBody className="space-y-4">
          <label
            htmlFor={inputId}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!running) addFiles(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center text-sm text-muted transition focus-within:outline-2 focus-within:outline-brand-500 ${
              dragging ? "border-brand-500 bg-brand-50" : "border-brand-200 bg-surface/50 hover:border-brand-400"
            }`}
          >
            <FileUp className="size-6 text-brand-600" aria-hidden="true" />
            <span className="font-medium text-ink">Drop files here or choose them</span>
            <span>{items.length > 0 ? `${items.length} files selected` : "Many files at once is fine"}</span>
            <input
              id={inputId}
              type="file"
              multiple
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              disabled={running}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <FormMessage error={notice ?? undefined} />
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button variant="secondary" onClick={() => (stopRef.current = true)}>
                <Square aria-hidden="true" />
                Stop after this file
              </Button>
            ) : (
              <Button onClick={start} disabled={waiting === 0}>
                <Play aria-hidden="true" />
                Upload and read {waiting} {waiting === 1 ? "CV" : "CVs"}
              </Button>
            )}
            {running && (
              <p className="flex items-center gap-2 text-sm text-muted" role="status">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                Reading CVs one by one. Keep this tab open.
              </p>
            )}
          </div>
          {done.length + failed > 0 && (
            <p className="text-sm text-ink" aria-live="polite">
              {created} new, {matched} matched to an existing candidate, {failed} failed{pending > 0 ? `, ${pending} with text pending` : ""}.
            </p>
          )}
        </CardBody>
      </Card>

      {items.length > 0 && (
        <Card>
          <CardHeader title="Files" />
          <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto overscroll-contain">
            {items.map((item, i) => (
              <li key={`${item.file.name}-${i}`} className="flex flex-col gap-1 px-5 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-3">
                <span className="min-w-0 flex-1 truncate text-ink">{item.file.name}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {item.status === "waiting" && <Badge>Waiting</Badge>}
                  {item.status === "uploading" && (
                    <Badge tone="brand">
                      <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                      Reading
                    </Badge>
                  )}
                  {item.status === "failed" && <Badge tone="danger">{item.error ?? "Failed"}</Badge>}
                  {item.status === "done" && item.result && (
                    <>
                      <Badge tone={item.result.outcome === "created" ? "success" : "accent"}>{item.result.outcome === "created" ? "New" : "Matched"}</Badge>
                      {item.result.textStatus === "pending" && <Badge tone="warning">Text pending</Badge>}
                      {item.result.textStatus === "failed" && <Badge tone="danger">Text not readable</Badge>}
                      {item.result.alreadyInVacancy && <Badge>Already in vacancy</Badge>}
                      <Link href={`/dashboard/candidates/${item.result.candidateId}`} className="font-medium text-brand-700 hover:underline">
                        {item.result.candidateName}
                      </Link>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
