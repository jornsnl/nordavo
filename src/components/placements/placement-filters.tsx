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
      className="mb-5 grid gap-3 sm:grid-cols-2 lg:max-w-2xl"
    >
      <div>
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
