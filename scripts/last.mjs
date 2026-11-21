import { execFileSync } from "node:child_process";

export const meta = {
  purpose:
    "What the most recent run of each check said, without running anything: when it ran, on which commit, passed or failed, and its failures. Says whether the code has changed since (another commit, uncommitted files), so an old result is not taken for the present state.",
  params: { check: "one check's name or kind; default the latest run of every check", dir: "another folder, optional", max: "failures listed per run, default 10" },
  returns: "{verdict, root, head?, runs:[{name, kind, at, age, commit?, staleBecause?, ok, seconds, failed, verdict, failures, id}]}",
  example: 'await scripts.run("last", { check: "test" })',
};

const age = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};

export default async function ({ checks }, { check, dir, max = 10 } = {}) {
  const c = dir ? checks.at(dir) : checks;
  const root = c.project().root;
  let head = null;
  try {
    head = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
  } catch {}
  const names = check ? [check] : [...new Set(c.runs({ limit: 40 }).map((r) => r.name))];
  const runs = [];
  for (const n of names) {
    const r = c.last(n, { max });
    if (!r) continue;
    const stale = head && r.commit && head !== r.commit ? `HEAD is now ${head}; this ran at ${r.commit}` : null;
    runs.push({ name: r.name, kind: r.kind, at: r.at, age: age(r.at), ...(r.commit ? { commit: r.commit } : {}), ...(stale ? { staleBecause: stale } : {}), ok: r.ok, seconds: r.seconds, failed: r.failed, verdict: r.verdict, failures: r.failures, ...(r.failuresLeftOut ? { failuresLeftOut: r.failuresLeftOut } : {}), ...(r.filtered ? { note: `a filtered run: ${r.cmd}` } : {}), id: r.id });
  }
  const verdict = !runs.length
    ? `no run of ${check ?? "any check"} is recorded for ${root}; scripts.run("run") runs one`
    : runs.map((r) => `${r.name} ${r.ok ? "passed" : `failed (${r.failed})`} ${r.age}${r.staleBecause ? ", before the current commit" : ""}`).join("; ");
  return { verdict, root, ...(head ? { head } : {}), runs };
}
