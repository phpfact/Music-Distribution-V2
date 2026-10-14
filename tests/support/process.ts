import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export type ProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  /** stdout followed by stderr. */
  output: string;
};

/** Runs a command from the project root and waits for it; never rejects on a non-zero exit. */
export function runProcess(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr, output: `${stdout}\n${stderr}` }));
  });
}

/**
 * An explicit environment for a child process: only what is listed here and
 * in `variables`, so nothing else leaks in from the test process.
 */
export function childEnv(variables: Record<string, string>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    // Stops the Prisma CLI from contacting its update server.
    CHECKPOINT_DISABLE: "1",
    ...variables,
  };
}

/** The POSTGRES_* variables of this process, with the database replaced. */
export function postgresEnv(database: string): Record<string, string> {
  const variables: Record<string, string> = { POSTGRES_DB: database };
  for (const name of ["POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_USER", "POSTGRES_PASSWORD"]) {
    const value = process.env[name];
    if (value) variables[name] = value;
  }
  return variables;
}

/** For error messages: the output of a child process with any connection string removed. */
export function redactConnectionStrings(text: string): string {
  return text.replace(/postgres(ql)?:\/\/\S+/gi, "<connection string>");
}
