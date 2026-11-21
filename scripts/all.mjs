export const meta = {
  purpose:
    "Run the project's checks one after another (typecheck, lint, test, build: one command of each kind the project has) and give one line per check plus the first failures of each. The answer to 'is everything green', 'is this ready to commit', 'run all the checks'.",
  params: {
    only: "names or kinds to run, as a list or comma-separated; default typecheck, lint, test, build",
    dir: "another folder whose project to check, optional",
    stopOnFail: "stop at the first check that fails, default false",
    timeout: "seconds allowed per check, default 600",
  },
  returns: "{verdict, root, checks:[{name, kind, cmd, ok, seconds, failed, verdict, failures:[first 5], id}], notRun:[{name, why}]}",
  example: 'await scripts.run("all")',
};

export default async function ({ checks }, { only, dir, stopOnFail = false, timeout = 600 } = {}) {
  const c = dir ? checks.at(dir) : checks;
  const all = c.commands();
  const want = (typeof only === "string" ? only.split(",") : only ?? ["typecheck", "lint", "test", "build"]).map((s) => String(s).trim()).filter(Boolean);
  const chosen = [];
  const notRun = [];
  for (const w of want) {
    // A name wins; a kind takes the command named like the kind, else the first runnable one of that kind.
    const hit = all.find((x) => x.name === w) ?? all.find((x) => x.kind === w && x.name === w) ?? all.find((x) => x.kind === w && x.runnable);
    if (!hit) {
      if (only) notRun.push({ name: w, why: "the project defines no such check" });
      continue;
    }
    if (!hit.runnable) notRun.push({ name: hit.name, why: hit.why });
    else if (!chosen.includes(hit)) chosen.push(hit);
  }
  const out = [];
  for (const [i, ch] of chosen.entries()) {
    const r = await c.run(ch.name, { timeoutS: Number(timeout), max: 5 });
    out.push({ name: r.name, kind: r.kind, cmd: r.cmd, ok: r.ok, seconds: r.seconds, failed: r.failed, verdict: r.verdict, failures: r.failures, ...(r.failuresLeftOut ? { failuresLeftOut: r.failuresLeftOut } : {}), ...(r.errorLines?.length ? { errorLines: r.errorLines.slice(-5) } : {}), id: r.id });
    if (!r.ok && stopOnFail) {
      for (const rest of chosen.slice(i + 1)) notRun.push({ name: rest.name, why: `stopped after ${r.name} failed` });
      break;
    }
  }
  const bad = out.filter((r) => !r.ok);
  const verdict = !out.length
    ? "no check was run: the project defines none of " + want.join(", ")
    : bad.length
      ? `${bad.length} of ${out.length} checks failed: ${bad.map((r) => `${r.name} (${r.failed ? `${r.failed} failures` : "no failure named"})`).join(", ")}`
      : `all ${out.length} checks passed: ${out.map((r) => r.name).join(", ")}`;
  return { verdict, root: c.project().root, checks: out, notRun };
}
