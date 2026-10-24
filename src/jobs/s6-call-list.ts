import { defineJob } from "@/lib/gtm/jobs";
import { exportCallList, filterToJson, parseListFilter } from "@/lib/gtm/lists";
import { hasGoogleSheets } from "@/lib/integrations/google-sheets";

/**
 * S6: call list for Web Partners as a Google Sheet.
 *   npm run job -- s6-call-list --segment=saas --signal=vacature --tier=1 --min_score=60 --limit=100
 * Filter, re-check (rule 4 and 5), sheet, list_exports, status op_bellijst and
 * one "verstuurd" activity per contact all happen in exportCallList.
 */
export const s6CallList = defineJob({
  name: "s6-call-list",
  description: "S6: bellijst voor Web Partners naar Google Sheet",
  run: async (ctx) => {
    if (!hasGoogleSheets()) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON ontbreekt. Maak de bellijst als CSV via Lijsten in het dashboard, of zet het service account in de omgeving.");
    }
    const filter = parseListFilter(ctx.params);
    ctx.meta.filter = filterToJson(filter);
    const result = await exportCallList(ctx.db, { filter, deliver: "sheet", log: ctx.log });
    ctx.countIn(result.count + result.dropped);
    ctx.countOut(result.count);
    if (result.exportId) {
      ctx.meta.export_id = result.exportId;
      ctx.meta.destination = result.destination;
    } else {
      ctx.log("Geen contacten voor de bellijst met dit filter. Er is niets gemaakt.");
    }
  },
});
