"use server";

import { z } from "zod";
import { getCurrentUser, requireStaff } from "@/lib/auth";
import {
  emptySearchGroups,
  isSearchableType,
  searchEverything,
  searchRecordsOfType,
  type RecordHit,
  type SearchGroups,
} from "@/lib/data/search";

const querySchema = z.string().trim().max(100);

/** Command palette: pages, a few hits per record type and Work tasks (Work guests: pages and tasks only). */
export async function globalSearch(query: string): Promise<SearchGroups> {
  await getCurrentUser();
  const q = querySchema.safeParse(query);
  if (!q.success) return emptySearchGroups;
  return searchEverything(q.data);
}

/** Record picker: hits of one type. */
export async function searchRecords(type: string, query: string): Promise<RecordHit[]> {
  await requireStaff();
  const q = querySchema.safeParse(query);
  if (!q.success || !isSearchableType(type)) return [];
  return searchRecordsOfType(type, q.data);
}
