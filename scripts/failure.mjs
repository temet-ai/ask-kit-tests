export const meta = {
  purpose:
    "One failure in full, from a run's log: the lines around a test name, a file or any text, with the stack and the diff a summary leaves out. Reads the saved log; runs nothing. Use it after `run` when a failure's message is not enough to say why.",
  params: { find: "a test name, a file name or words from the error (a regex, any case)", run: "a run id; default the latest run", around: "lines kept before and after each match, default 25", max: "lines returned, default 120" },
  returns: "{id, name, total, matches, lines:['<n>: text'], more?}",
  example: 'await scripts.run("failure", { find: "Cable Street has two officers" })',
};

export default async function ({ checks }, { find, run, around = 25, max = 120, dir } = {}) {
  if (!find) throw new Error("failure needs `find`: a test name, a file or words from the error");
  const c = dir ? checks.at(dir) : checks;
  const literal = String(find).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let asRegex = null;
  try {
    new RegExp(find);
    asRegex = String(find);
  } catch {}
  // The run named, or the newest of the last runs whose log holds the text: as it is first, then as a regex.
  const candidates = run ? [c.last(run)].filter(Boolean) : c.runs({ limit: 8 }).map((r) => c.last(r.id));
  if (!candidates.length) return { id: null, verdict: 'no run is recorded; scripts.run("run") runs one' };
  let rec = candidates[0];
  let pattern = literal;
  let hits = { lines: [] };
  search: for (const p of [literal, asRegex].filter(Boolean)) {
    for (const r of candidates) {
      let h;
      try {
        h = c.log(r.id, { grep: p, around: 0, max: 200 });
      } catch {
        continue; // its log is gone
      }
      if (h.lines.length) {
        [rec, pattern, hits] = [r, p, h];
        break search;
      }
    }
  }
  const out = c.log(rec.id, { grep: pattern, around: Number(around), max: Number(max) });
  return { id: rec.id, name: rec.name, total: out.total, matches: hits.lines.length + (hits.more ?? 0), lines: out.lines, ...(out.more ? { more: out.more } : {}), ...(hits.lines.length ? {} : { note: `nothing in the log matches "${find}"; the run's failures: ${rec.failures.map((f) => f.name).slice(0, 10).join(", ") || "none"}` }) };
}
