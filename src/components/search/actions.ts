"use server";

import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import {
  isSearchableType,
  searchEverything,
  searchRecordsOfType,
  type RecordHit,
  type SearchGroups,
} from "@/lib/data/search";

const querySchema = z.string().trim().max(100);

/** Command palette: a few hits per record type. */
export async function globalSearch(query: string): Promise<SearchGroups> {
  await requireStaff();
  const q = querySchema.safeParse(query);
  if (!q.success) return { client: [], vacancy: [], candidate: [], placement: [] };
  return searchEverything(q.data);
}

/** Record picker: hits of one type. */
export async function searchRecords(type: string, query: string): Promise<RecordHit[]> {
  await requireStaff();
  const q = querySchema.safeParse(query);
  if (!q.success || !isSearchableType(type)) return [];
  return searchRecordsOfType(type, q.data);
}
