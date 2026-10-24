"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/field";
import { STATUS_FILTERS, type StatusFilter } from "./status-filters";

export function PlacementFilters({
  status,
  clientId,
  clients,
}: {
  status: StatusFilter;
  clientId: string;
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function update(next: { status?: string; klant?: string }) {
    const params = new URLSearchParams();
    const nextStatus = next.status ?? status;
    const nextClient = next.klant ?? clientId;
    if (nextStatus !== "lopend") params.set("status", nextStatus);
    if (nextClient) params.set("klant", nextClient);
    const query = params.toString();
    startTransition(() => {
      router.replace(`/dashboard/plaatsingen${query ? `?${query}` : ""}`, { scroll: false });
    });
  }

  return (
    <div
      role="search"
      aria-label="Plaatsingen filteren"
      aria-busy={pending}
      className="mb-5 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:max-w-2xl"
    >
      {/* Phones: the status as a strip of chips instead of a select. */}
      <div className="-mx-4 sm:hidden">
        <div role="group" aria-label="Status" className="flex snap-strip scrollbar-none gap-2 px-4 py-0.5">
          {STATUS_FILTERS.map((option) => {
            const active = option.value === status;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => update({ status: option.value })}
                className={`inline-flex min-h-10 shrink-0 snap-start scroll-ml-4 items-center rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
                  active ? "border-brand-700 bg-brand-700 text-white" : "border-border bg-white text-ink active:bg-brand-50"
                }`}
              >
                {option.short}
              </button>
            );
          })}
        </div>
      </div>
      <div className="max-sm:hidden">
        <label htmlFor="filter-status" className="sr-only">
          Status
        </label>
        <Select id="filter-status" value={status} onChange={(e) => update({ status: e.target.value })}>
          {STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="filter-client" className="sr-only">
          Klant
        </label>
        <Select id="filter-client" value={clientId} onChange={(e) => update({ klant: e.target.value })}>
          <option value="">Alle klanten</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
