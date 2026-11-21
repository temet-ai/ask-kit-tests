interface Check { name: string; kind: "typecheck" | "lint" | "test" | "build" | "format" | "other"; cmd: string[]; from: string; runnable: boolean; why?: string; script?: string }
// A test failure, or one compiler or linter error. For tsc, vue-tsc and svelte-check: name and code are the error code
// ("TS2322"), col is set, and message holds the whole message with its indented lines ("Types of parameters ... are
// incompatible."). For node:test assertions: expected, received and operator as the assertion printed them.
interface Failure { name: string; file?: string; line?: number; col?: number; code?: string; message: string; expected?: string; received?: string; operator?: string }
interface Run {
  verdict: string;            // one line: "test failed: 2 of 5 tests; 1 new since the last run"
  id: string;                 // names the run and its log
  at: string; name: string; kind: string; cmd: string;
  ok: boolean; code: number; seconds: number;
  timedOut?: true | string; error?: string;      // error: the command could not start
  counts: Record<string, number>;                 // what the tool's summary said: total, passed, failed, skipped, errors, warnings, suitesPassed, suitesFailed
  failed: number; failures: Failure[]; failuresLeftOut?: number;
  byFile?: Record<string, number>;                // typecheck, lint and build: errors per file, most first (when more than one file)
  errorLines?: string[]; tail?: string[];         // only when it failed and no failure was recognised
  commit?: string; uncommittedFiles?: number;     // the git state the run saw
  filtered?: true;                                // run with extra arguments, so on a subset
  changed?: { previous: { id: string; at: string; ok: boolean; failed: number; commit?: string }; newFailures: string[]; fixed?: string[]; fixedUnknown?: string; stillFailing: number };
}

declare const checks: {
  // The project: the nearest folder at or above the caller's folder with a package.json, Cargo.toml, go.mod,
  // pyproject.toml, Makefile or justfile. stateDir holds the logs of the last 40 runs.
  project(): { root: string; workdir: string; stateDir: string };

  // The same API for another folder, relative to the caller's folder: a package of a monorepo, another checkout.
  // checks.at("packages/api").run("test")
  at(dir: string): typeof checks;

  // For a package.json project: the package manager (from the lockfile; packageManagerField is package.json's "packageManager";
  // managerNotes when two lockfiles exist or the field and the lockfile disagree), the Node version expected (each .nvmrc,
  // .node-version, .tool-versions, mise.toml, engines.node and volta.node entry with where it came from) against node.running,
  // whether node_modules exists, whether there is a tsconfig.json. Null for any other project. Runs only `node --version`.
  package(): { name: string | null; version: string | null; type: string; manager: "npm" | "pnpm" | "yarn" | "bun"; lockfile: string | null;
    packageManagerField: string | null; managerNotes?: string[]; node: { expected: { from: string; version: string }[]; running: string | null };
    installed: boolean; typescript: boolean } | null;

  // The checks the project defines, read from its files; nothing runs. runnable is false for a script that does not
  // end (dev, start, watch) or that changes things (deploy, release, format that writes): those are not run as checks.
  commands(): Check[];

  // Run one check to the end, by name ("test", "test:unit", "cargo-test") or by kind ("test", "lint", "typecheck",
  // "build": the first runnable command of that kind). The whole output goes to a log; you get the Run.
  // args are added after the command: a test file, "-k", "duty", "--test-name-pattern=duty". For npm, pnpm and yarn
  // scripts they are passed after "--" for you. timeoutS defaults to 600; max is the failures listed (default 25).
  // Never throws because the check failed; throws for an unknown name (the message lists the checks).
  // CI=1 and NO_COLOR=1 are set, so runners do not start a watch mode.
  run(name?: string, o?: { args?: string[]; timeoutS?: number; max?: number; env?: Record<string, string> }): Promise<Run>;

  // Earlier runs, newest first, without their failures. name keeps one check or kind; limit default 15.
  runs(o?: { name?: string; limit?: number }): { id: string; at: string; name: string; kind: string; cmd: string; ok: boolean; seconds: number; failed: number; commit?: string }[];

  // One earlier run in full: by id, or the latest run of a check by name or kind, or the latest of all. null when none.
  last(nameOrId?: string, o?: { max?: number }): Run | null;

  // Lines of a run's log (default the latest run), each as "<line number>: text", at most 200.
  // grep (regex, any case) keeps matching lines with `around` lines of context; otherwise start and lines
  // (default the last 60). Lines that carry a key, token or password are shown with it redacted.
  log(id?: string, o?: { grep?: string; around?: number; start?: number; lines?: number; max?: number }): { id: string; total: number; lines: string[]; more?: number };

  // Any other command line in the project root, logged and read like a check: exec(["npm", "ci"]),
  // exec(["npm", "run", "format"]). Only when the caller asked for a change (act: true); otherwise it throws.
  exec(cmd: string[], o?: { name?: string; timeoutS?: number; max?: number }): Promise<Run>;
};
