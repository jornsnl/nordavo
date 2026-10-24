/**
 * Run a GTM job or chain from the command line (GitHub Actions, cron, local):
 *   npm run job -- maandag
 *   npm run job -- t2-match --vacancy=<uuid>
 * Exits with code 1 when a job failed, so the scheduler shows red.
 */
import { chains, jobs } from "@/jobs/registry";
import { runByName } from "@/jobs/run";

const [name, ...rest] = process.argv.slice(2);

if (!name || name === "--help") {
  console.log("Gebruik: npm run job -- <naam> [--param=waarde]\n\nJobs:");
  for (const job of Object.values(jobs)) console.log(`  ${job.name.padEnd(24)} ${job.description}`);
  console.log("\nReeksen:");
  for (const [chainName, chain] of Object.entries(chains)) console.log(`  ${chainName.padEnd(24)} ${chain.description}`);
  process.exit(name ? 0 : 1);
}

const params = Object.fromEntries(
  rest
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, ...value] = arg.slice(2).split("=");
      return [key, value.join("=") || "true"];
    }),
);

async function main() {
  const { results } = await runByName(name, { params, triggeredBy: process.env.GITHUB_ACTIONS ? "github-actions" : "cli" });
  for (const { job, result } of results) {
    console.log(`${result.status === "success" ? "OK  " : "FOUT"} ${job}: ${result.recordsIn} in, ${result.recordsOut} uit${result.error ? `\n${result.error}` : ""}`);
  }
  process.exit(results.some(({ result }) => result.status === "failed") ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
