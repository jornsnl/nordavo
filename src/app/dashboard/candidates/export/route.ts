import { connection } from "next/server";
import { exportResponse } from "@/lib/custom-fields/export-data";

/** All candidates as CSV, with every custom field as a column. */
export async function GET() {
  await connection();
  return exportResponse("candidate");
}
