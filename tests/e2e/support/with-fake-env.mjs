/*
 * Runs a command with the fake Supabase environment (fake.env), e.g.
 *   node tests/e2e/support/with-fake-env.mjs next build
 * (node --env-file does not work here: Next passes it on to its workers.)
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.loadEnvFile(fileURLToPath(new URL("./fake.env", import.meta.url)));
const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 1)));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
