export const meta = {
  purpose:
    "Run one of the project's checks to the end and say how it went: passed or failed, how long, how many tests, each failure with its test name, file, line and message, and what is new or fixed since the run before. The answer to 'do the tests pass', 'does it build', 'does lint pass', 'run the tests for X'.",
  params: {
    check: "a check's name or a kind: test (default), typecheck, lint, build",
    args: "extra arguments after the command, as a list or one string: a test file, a name filter such as '-k duty' or '--test-name-pattern=duty'",
    dir: "another folder whose project to check (a package of a monorepo), optional",
    timeout: "seconds allowed, default 600",
    max: "failures listed, default 25",
  },
  returns: "{verdict, id, name, kind, cmd, ok, code, seconds, counts, failed, failures:[{name, file, line, message}], failuresLeftOut?, errorLines?, tail?, commit?, uncommittedFiles?, changed?:{previous, newFailures, fixed, stillFailing}}",
  example: 'await scripts.run("run", { check: "test" })',
};

export default async function ({ checks }, { check = "test", args, dir, timeout = 600, max = 25 } = {}) {
  const c = dir ? checks.at(dir) : checks;
  const extra = typeof args === "string" ? args.split(/\s+/).filter(Boolean) : args ?? [];
  return c.run(check, { args: extra, timeoutS: Number(timeout), max });
}
