import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { mergeCheatsheet, type CheatsheetSection } from "@/lib/sales/cheatsheet";

type Db = SupabaseClient<Database>;

/** The cheat sheet as Julius saved it; the drafts when nothing is stored or the table is not there yet. */
export async function loadCheatsheet(db: Db): Promise<CheatsheetSection[]> {
  const { data, error } = await db.from("sales_call_cheatsheet").select("key, title, body, position, hidden");
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message)) console.error("loadCheatsheet", error.message);
    return mergeCheatsheet([]);
  }
  return mergeCheatsheet(data ?? []);
}
