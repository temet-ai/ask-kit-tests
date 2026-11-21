export const meta = {
  purpose:
    "Whether a failure is flaky: runs one check several times and sorts its failures into those that fail every time and those that fail only sometimes. The answer to 'is this test flaky', 'does it fail every time'.",
  params: { check: "a check's name or kind, default test", times: "how many runs, default 3, at most 10", args: "extra arguments to narrow the run to a file or a test name, as a list or one string", dir: "another folder, optional", timeout: "seconds allowed per run, default 600" },
  returns: "{verdict, check, times, runs:[{id, ok, seconds, failed}], always:[{name, file, line, message}], sometimes:[{name, file, failedIn, of, message}]}",
  example: 'await scripts.run("flaky", { check: "test", times: 5, args: "test/roster.test.mjs" })',
};

export default async function ({ checks }, { check = "test", times = 3, args, dir, timeout = 600 } = {}) {
  const c = dir ? checks.at(dir) : checks;
  const n = Math.max(2, Math.min(10, Number(times) || 3));
  const extra = typeof args === "string" ? args.split(/\s+/).filter(Boolean) : args ?? [];
  const runs = [];
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const r = await c.run(check, { args: extra, timeoutS: Number(timeout), max: 500 });
    runs.push({ id: r.id, ok: r.ok, seconds: r.seconds, failed: r.failed });
    for (const f of r.failures) {
      const k = `${f.file ?? ""}::${f.name}`;
      const e = seen.get(k) ?? { ...f, failedIn: 0 };
      e.failedIn++;
      seen.set(k, e);
    }
    if (r.error) break; // the command could not start: more runs say nothing
  }
  const done = runs.length;
  const always = [...seen.values()].filter((f) => f.failedIn === done).map(({ failedIn, ...f }) => f);
  const sometimes = [...seen.values()].filter((f) => f.failedIn < done).map((f) => ({ name: f.name, file: f.file, failedIn: f.failedIn, of: done, message: f.message }));
  const mixed = runs.some((r) => r.ok) && runs.some((r) => !r.ok);
  const verdict = sometimes.length
    ? `flaky: ${sometimes.length} failed in some of ${done} runs but not all (${sometimes.slice(0, 3).map((f) => `${f.name} ${f.failedIn}/${f.of}`).join(", ")})${always.length ? `; ${always.length} failed every time` : ""}`
    : always.length
      ? `not flaky: the same ${always.length} failed in all ${done} runs`
      : mixed
        ? `the check passed in ${runs.filter((r) => r.ok).length} of ${done} runs, with no failure this kit could name`
        : runs.every((r) => r.ok)
          ? `passed in all ${done} runs`
          : `failed in all ${done} runs with no failure this kit could name; scripts.run("failure") reads the log`;
  return { verdict, check, times: done, runs, always: always.slice(0, 25), sometimes: sometimes.slice(0, 25) };
}
