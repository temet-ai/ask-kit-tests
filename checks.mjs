// A project's checks for ask-kit: its tests, build, lint and typecheck, run outside the caller's
// context. The whole output goes to a log file; what comes back is whether it passed, how long it
// took, the failures (test name, file, line, message) and what changed since the run before.
//
// What it runs without being asked for a change: only the commands the project itself defines
// (package.json scripts, Makefile and justfile targets, cargo, go, pytest and the like), found by
// `commands()`, with extra arguments after them (a file, a test name filter). Any other command
// line is `exec`, which exists only when the caller asked for a change (act).
//
// A run always ends: it has a timeout, CI=1 is set so runners do not start a watch mode, and the
// process group is killed when the time is up.
import { spawn, execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, keyOf, clean } from "./parse.mjs";

const WIN = process.platform === "win32";
const MANIFESTS = ["package.json", "Cargo.toml", "go.mod", "pyproject.toml", "pytest.ini", "setup.py", "tox.ini", "Makefile", "makefile", "justfile", "Justfile", "deno.json", "build.gradle", "build.gradle.kts", "pom.xml", "mix.exs", "Gemfile"];
const KIND_ORDER = ["typecheck", "lint", "test", "build", "format", "other"];
const KEEP_RUNS = 40;
const MAX_LOG = 20 << 20;

const exists = (p) => fs.existsSync(p);
const readText = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
const slug = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(-120) || "root";
const expand = (p) => (typeof p === "string" ? p.replace(/^~(?=$|[\\/])/, os.homedir()) : p);

const stateRoot = () =>
  process.env.ASK_KIT_STATE ||
  (WIN ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "ask-kit", "state") : path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "ask-kit"));

/** The nearest folder at or above `from` that holds a project manifest; else the git root; else `from`. */
export function findRoot(from) {
  let dir = path.resolve(from);
  let git = null;
  for (;;) {
    if (MANIFESTS.some((m) => exists(path.join(dir, m)))) return dir;
    if (!git && exists(path.join(dir, ".git"))) git = dir;
    const up = path.dirname(dir);
    if (up === dir) return git ?? path.resolve(from);
    dir = up;
  }
}

const kindOf = (name, body = "") => {
  const n = name.toLowerCase();
  if (/^(pre|post)/.test(n) && !/^(pre-?commit|prettier)/.test(n)) return null; // npm lifecycle hooks run with their script
  if (/type-?check|^tsc$|^types?$|mypy|pyright|^check-types/.test(n)) return "typecheck";
  if (/lint|clippy|^vet$|ruff|eslint|biome|stylelint/.test(n)) return "lint";
  if (/^test|test$|^spec|^e2e|^unit|^integration|pytest|^check$|^ci$/.test(n) || /:test$|^test[:_-]/.test(n)) return "test";
  if (/^build|build$|^compile|^bundle|^dist$/.test(n)) return "build";
  if (/^(fmt|format)(:check|-check)?$|prettier/.test(n)) return "format";
  if (/\btsc\b.*--noEmit/.test(body)) return "typecheck";
  return "other";
};
// Scripts that never end or that change the world: listed, but not run without act.
const LONG_RUNNING = /^(dev|start|serve|watch|preview|storybook|docs:dev)$|[:_-](dev|watch|serve)$/i;
const CHANGES = /^(deploy|release|publish|push|migrate|seed|clean|reset|install|upgrade|bump|version|prepare|postinstall)$|[:_-](deploy|release|publish|fix|write)$|^(fmt|format)$/i;

function packageManager(root) {
  for (let dir = root; ; dir = path.dirname(dir)) {
    if (exists(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
    if (exists(path.join(dir, "yarn.lock"))) return "yarn";
    if (exists(path.join(dir, "bun.lockb")) || exists(path.join(dir, "bun.lock"))) return "bun";
    if (exists(path.join(dir, "package-lock.json"))) return "npm";
    if (path.dirname(dir) === dir) return "npm";
  }
}

const onPath = (bin) => (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).some((d) => (WIN ? [".cmd", ".exe", ""] : [""]).some((e) => exists(path.join(d, bin + e))));

const LOCKFILES = { "package-lock.json": "npm", "npm-shrinkwrap.json": "npm", "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "bun.lock": "bun", "bun.lockb": "bun" };

/**
 * For a package.json project: the package manager and where that comes from (the lockfile, the
 * `packageManager` field, and a note when they disagree or there are two lockfiles), the Node version
 * the package expects (.nvmrc, .node-version, .tool-versions, mise.toml, engines.node, volta.node,
 * at the package and the folders above it up to the git root) against the one running. Reads files
 * only, apart from `node --version`. Null for any other project.
 */
export function packageInfo(root) {
  const read = (f) => {
    try {
      return JSON.parse(readText(f) ?? "null");
    } catch {
      return null;
    }
  };
  const pj = read(path.join(root, "package.json"));
  if (!pj) return null;
  const dirs = [];
  for (let d = root; ; d = path.dirname(d)) {
    dirs.push(d);
    if (exists(path.join(d, ".git")) || path.dirname(d) === d) break;
  }
  const locks = [];
  for (const d of dirs) for (const [f, m] of Object.entries(LOCKFILES)) if (exists(path.join(d, f))) locks.push({ manager: m, lockfile: path.relative(root, path.join(d, f)) || f });
  const fieldText = pj.packageManager ?? dirs.map((d) => read(path.join(d, "package.json"))?.packageManager).find(Boolean) ?? null;
  const field = typeof fieldText === "string" ? /^(npm|pnpm|yarn|bun)@(.+)$/.exec(fieldText) : null;
  const pick = (field && locks.find((l) => l.manager === field[1])) || locks[0];
  const notes = [];
  if (new Set(locks.map((l) => l.manager)).size > 1) notes.push(`more than one lockfile: ${locks.map((l) => l.lockfile).join(", ")}`);
  if (field && pick && field[1] !== pick.manager) notes.push(`packageManager says ${field[1]} but the lockfile is ${pick.lockfile}`);
  const expected = [];
  for (const d of dirs) {
    const at = (f) => path.relative(root, path.join(d, f)) || f;
    for (const f of [".nvmrc", ".node-version"]) {
      const v = readText(path.join(d, f))?.trim();
      if (v) expected.push({ from: at(f), version: v });
    }
    for (const f of [".tool-versions", "mise.toml", ".mise.toml"]) {
      const m = /^\s*(?:nodejs|node)\s*[= ]\s*["']?([^"'\s#]+)/m.exec(readText(path.join(d, f)) ?? "");
      if (m) expected.push({ from: at(f), version: m[1] });
    }
  }
  if (pj.engines?.node) expected.push({ from: "package.json engines.node", version: pj.engines.node });
  if (pj.volta?.node) expected.push({ from: "package.json volta.node", version: pj.volta.node });
  let running = null;
  try {
    running = execFileSync("node", ["--version"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {}
  return {
    name: pj.name ?? null,
    version: pj.version ?? null,
    type: pj.type ?? "commonjs",
    manager: pick?.manager ?? field?.[1] ?? "npm",
    lockfile: pick?.lockfile ?? null,
    packageManagerField: fieldText,
    ...(notes.length ? { managerNotes: notes } : {}),
    node: { expected, running },
    installed: dirs.some((d) => exists(path.join(d, "node_modules"))),
    typescript: exists(path.join(root, "tsconfig.json")),
  };
}

/** The checks a project defines: [{name, kind, cmd:[...], from, runnable, why?}]. Reads files only. */
export function detect(root) {
  const out = [];
  const add = (name, kind, cmd, from, extra = {}) => {
    if (!kind || out.some((c) => c.name === name)) return;
    const blocked = LONG_RUNNING.test(name) ? "it does not end (a server or watch mode)" : CHANGES.test(name) ? "it changes things" : null;
    out.push({ name, kind, cmd, from, runnable: !blocked, ...(blocked ? { why: blocked } : {}), ...extra });
  };

  const pkg = readText(path.join(root, "package.json"));
  if (pkg) {
    let scripts = {};
    try {
      scripts = JSON.parse(pkg).scripts ?? {};
    } catch {}
    const pm = packageManager(root);
    for (const [name, body] of Object.entries(scripts)) add(name, kindOf(name, String(body)), [pm, "run", name], `package.json scripts.${name}`, { script: String(body).slice(0, 200) });
    if (!scripts.typecheck && !Object.keys(scripts).some((n) => kindOf(n, scripts[n]) === "typecheck") && exists(path.join(root, "tsconfig.json"))) {
      // The package's own TypeScript first; else a tsc on PATH, said so in `from`.
      const local = path.join("node_modules", ".bin", WIN ? "tsc.cmd" : "tsc");
      if (exists(path.join(root, local))) add("tsc", "typecheck", [local, "--noEmit", "--pretty", "false"], "tsconfig.json (no typecheck script)");
      else if (onPath("tsc")) add("tsc", "typecheck", ["tsc", "--noEmit", "--pretty", "false"], "tsconfig.json (no typecheck script; typescript is not installed in the package, so the tsc on PATH)");
    }
  }

  if (exists(path.join(root, "Cargo.toml"))) {
    add("cargo-test", "test", ["cargo", "test", "--no-fail-fast"], "Cargo.toml");
    add("cargo-check", "typecheck", ["cargo", "check", "--all-targets"], "Cargo.toml");
    add("cargo-clippy", "lint", ["cargo", "clippy", "--all-targets"], "Cargo.toml");
    add("cargo-build", "build", ["cargo", "build"], "Cargo.toml");
    add("cargo-fmt", "format", ["cargo", "fmt", "--check"], "Cargo.toml");
  }
  if (exists(path.join(root, "go.mod"))) {
    add("go-test", "test", ["go", "test", "./..."], "go.mod");
    add("go-vet", "lint", ["go", "vet", "./..."], "go.mod");
    add("go-build", "build", ["go", "build", "./..."], "go.mod");
  }

  const pyproject = readText(path.join(root, "pyproject.toml")) ?? "";
  const py = pyproject || ["pytest.ini", "setup.py", "tox.ini", "setup.cfg"].some((f) => exists(path.join(root, f)));
  if (py) {
    const uv = exists(path.join(root, "uv.lock"));
    const poetry = exists(path.join(root, "poetry.lock"));
    const via = (...cmd) => (uv ? ["uv", "run", ...cmd] : poetry ? ["poetry", "run", ...cmd] : cmd);
    const has = (tool) => new RegExp(`\\[tool\\.${tool}[\\].]|["']${tool}\\b`).test(pyproject);
    const tests = has("pytest") || exists(path.join(root, "pytest.ini")) || exists(path.join(root, "tests")) || exists(path.join(root, "test")) || exists(path.join(root, "conftest.py"));
    if (tests) add("pytest", "test", via("pytest", "-q", "-p", "no:cacheprovider"), has("pytest") ? "pyproject.toml [tool.pytest]" : "a tests folder");
    if (has("ruff") || exists(path.join(root, "ruff.toml")) || exists(path.join(root, ".ruff.toml"))) add("ruff", "lint", via("ruff", "check", "--output-format", "concise"), "ruff configuration");
    if (has("mypy") || exists(path.join(root, "mypy.ini"))) add("mypy", "typecheck", via("mypy", "."), "mypy configuration");
    if (has("pyright") || exists(path.join(root, "pyrightconfig.json"))) add("pyright", "typecheck", via("pyright"), "pyright configuration");
  }

  const mk = readText(path.join(root, "Makefile")) ?? readText(path.join(root, "makefile"));
  if (mk) for (const [, t] of mk.matchAll(/^([A-Za-z][\w.-]*):(?!=)/gm)) if (kindOf(t) !== "other" || /^(all|check|ci)$/.test(t)) add(out.some((c) => c.name === t) ? `make-${t}` : t, kindOf(t), ["make", t], `Makefile target ${t}`);
  const jf = readText(path.join(root, "justfile")) ?? readText(path.join(root, "Justfile"));
  if (jf) for (const [, t] of jf.matchAll(/^([A-Za-z][\w-]*)(?:\s+[^:\n]*)?:(?!=)/gm)) if (kindOf(t) !== "other" || /^(check|ci)$/.test(t)) add(out.some((c) => c.name === t) ? `just-${t}` : t, kindOf(t), ["just", t], `justfile recipe ${t}`);

  if (exists(path.join(root, "deno.json"))) add("deno-test", "test", ["deno", "test"], "deno.json");
  if (exists(path.join(root, "mix.exs"))) add("mix-test", "test", ["mix", "test"], "mix.exs");
  if (exists(path.join(root, "Gemfile")) && exists(path.join(root, "spec"))) add("rspec", "test", ["bundle", "exec", "rspec"], "Gemfile and spec/");
  for (const [f, w] of [["build.gradle", "gradlew"], ["build.gradle.kts", "gradlew"]]) if (exists(path.join(root, f))) add("gradle-test", "test", [exists(path.join(root, w)) ? (WIN ? "gradlew.bat" : "./gradlew") : "gradle", "test"], f);
  if (exists(path.join(root, "pom.xml"))) add("mvn-test", "test", ["mvn", "-q", "-B", "test"], "pom.xml");

  return out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

// Lines that carry a credential are not passed on: answers go to a cloud model.
const SECRET_LINE = /((api[_-]?key|secret|token|passw(or)?d|authorization|bearer|private[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi;
const SECRET_URL = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi;
export const scrub = (s) => String(s).replace(SECRET_LINE, "$1<redacted>").replace(SECRET_URL, "$1<redacted>@");

const git = (root, ...args) =>
  new Promise((resolve) => execFile("git", ["-C", root, ...args], { timeout: 5000, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }, (err, out) => resolve(err ? null : out.trim())));

/** One line saying how a run went. */
export function verdictOf(rec, changed) {
  const n = rec.counts ?? {};
  const what = rec.kind === "test" && (n.passed != null || n.failed != null || n.total != null) ? "tests" : rec.kind === "lint" || rec.kind === "typecheck" ? "errors" : "failures";
  if (rec.error) return `${rec.name} could not start: ${rec.error}`;
  if (rec.timedOut) return `${rec.name} did not finish: ${rec.timedOut === true ? `stopped after ${rec.seconds}s` : rec.timedOut}${rec.failures.length ? `; ${rec.failures.length} ${what} had failed by then` : ""}`;
  if (rec.ok) return `${rec.name} passed${n.passed != null ? `: ${n.passed} tests` : ""} in ${rec.seconds}s${n.skipped ? `, ${n.skipped} skipped` : ""}${changed?.fixed?.length ? `; ${changed.fixed.length} that failed last time now pass` : ""}`;
  if (!rec.failures.length) return `${rec.name} failed with exit code ${rec.code} and no failure this kit recognises: read errorLines and tail`;
  const total = n.total ?? (n.passed != null ? n.passed + (n.failed ?? rec.failures.length) : null);
  const one = { tests: "test", errors: "error", failures: "failure" }[what];
  const since = changed ? (changed.newFailures.length ? `; ${changed.newFailures.length} new since the last run` : "; the same as the last run") : "";
  const files = what === "errors" ? new Set(rec.failures.map((f) => f.file).filter(Boolean)).size : 0;
  const inFiles = files ? ` in ${files} file${files === 1 ? "" : "s"}` : "";
  return `${rec.name} failed: ${rec.failures.length}${rec.kind === "test" && total ? ` of ${total}` : ""} ${rec.failures.length === 1 && !(rec.kind === "test" && total) ? one : what}${inFiles}${since}`;
}

export function make({ settings = {}, push = () => {}, act = false }) {
  const workdir = path.resolve(expand(settings.WORKDIR || process.cwd()));
  return bind(workdir, workdir, { push, act });
}

// The API for the project at or above `from`. `at(dir)` gives the same API for another folder.
function bind(from, workdir, { push, act }) {
  const root = findRoot(from);
  const dir = path.join(stateRoot(), "tests", slug(root));
  const runsFile = path.join(dir, "runs.jsonl");

  const readRuns = () =>
    (readText(runsFile) ?? "")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

  const saveRun = (rec) => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const all = [...readRuns(), rec];
    for (const old of all.slice(0, -KEEP_RUNS)) fs.rmSync(path.join(dir, `${old.id}.log`), { force: true });
    fs.writeFileSync(runsFile, all.slice(-KEEP_RUNS).map((r) => JSON.stringify(r)).join("\n") + "\n", { mode: 0o600 });
  };

  const commands = () => detect(root);

  const pick = (name) => {
    const all = commands();
    const want = String(name ?? "test");
    const hit = all.find((c) => c.name === want) ?? all.find((c) => c.kind === want && c.runnable) ?? all.filter((c) => c.name.includes(want))[0];
    if (!hit) throw new Error(`no check "${want}" in ${root}; it has: ${all.map((c) => `${c.name} (${c.kind})`).join(", ") || "none that this kit recognises"}`);
    return hit;
  };

  // Run one command line to the end, output to a log file. Never throws for a failing command.
  const runCmd = (cmd, { timeoutS = 600, env = {}, label }) =>
    new Promise((resolve) => {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const id = `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${slug(label).slice(0, 40)}`;
      const logFile = path.join(dir, `${id}.log`);
      const fd = fs.openSync(logFile, "w", 0o600);
      const started = Date.now();
      const [bin, ...args] = cmd;
      // npm, pnpm and yarn are .cmd files on Windows, which need cmd.exe; elsewhere no shell.
      const child = WIN ? spawn("cmd.exe", ["/d", "/s", "/c", bin, ...args], { cwd: root, stdio: ["ignore", fd, fd], env: childEnv(env), windowsHide: true }) : spawn(bin, args, { cwd: root, stdio: ["ignore", fd, fd], env: childEnv(env), detached: true });
      let timedOut = false;
      let done = false;
      const kill = () => {
        try {
          if (WIN) execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], () => {});
          else process.kill(-child.pid, "SIGKILL");
        } catch {}
      };
      const timer = setTimeout(() => ((timedOut = true), kill()), timeoutS * 1000);
      // A log that grows without end (a test printing in a loop) ends the run too.
      const watch = setInterval(() => {
        try {
          if (fs.fstatSync(fd).size > MAX_LOG) ((timedOut = "log"), kill());
        } catch {}
      }, 2000);
      const finish = (code, error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(watch);
        try {
          fs.closeSync(fd);
        } catch {}
        const ms = Date.now() - started;
        let size = 0;
        try {
          size = fs.statSync(logFile).size;
        } catch {}
        push({ kind: "checks", detail: `run ${cmd.join(" ")}`.slice(0, 200), ms, code: code ?? 1, size });
        resolve({ id, logFile, code, ms, timedOut, error, size });
      };
      child.on("error", (e) => finish(127, e.code === "ENOENT" ? `${bin} is not installed or not on PATH` : e.message));
      child.on("close", (code, signal) => finish(code ?? (signal ? 137 : 1)));
    });

  const childEnv = (extra) => {
    const env = { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0", TERM: "dumb", CARGO_TERM_COLOR: "never", PY_COLORS: "0", npm_config_fund: "false", npm_config_update_notifier: "false", ...extra };
    // The investigator's own variables stay out of the project's processes.
    for (const k of Object.keys(env)) if (/^ASK_KIT_/.test(k)) delete env[k];
    return env;
  };

  // A path inside the project is shown from its root.
  const rel = (file) => {
    const abs = path.isAbsolute(file) ? file : null;
    if (!abs) return file.replace(/^\.\//, "");
    const r = path.relative(root, abs);
    return r && !r.startsWith("..") ? r : file;
  };

  const record = async (check, r, extraArgs) => {
    const text = readText(r.logFile) ?? "";
    const parsed = parse(text);
    const lines = clean(text).split("\n");
    const [head, status] = await Promise.all([git(root, "rev-parse", "--short", "HEAD"), git(root, "status", "--porcelain")]);
    const dirty = head ? (status ?? "").split("\n").filter(Boolean).length : null;
    const ok = r.code === 0 && !r.timedOut;
    const rec = {
      id: r.id,
      at: new Date().toISOString(),
      name: check.name,
      kind: check.kind,
      cmd: [...check.cmd, ...extraArgs].join(" "),
      ok,
      code: r.code,
      seconds: Math.round(r.ms / 100) / 10,
      ...(r.timedOut ? { timedOut: r.timedOut === "log" ? `stopped: the log passed ${MAX_LOG >> 20} MB` : true } : {}),
      ...(r.error ? { error: r.error } : {}),
      counts: parsed.counts,
      failures: parsed.failures.map((f) => ({ ...f, ...(f.file ? { file: rel(f.file) } : {}), message: scrub(f.message ?? "") })),
      ...(head ? { commit: head, uncommittedFiles: dirty } : {}),
      logLines: lines.length,
      ...(extraArgs.length ? { filtered: true } : {}),
    };
    // When the command failed and no reader found a failure, the lines that look like errors and the end of the log say why.
    if (!ok && !rec.failures.length) {
      rec.errorLines = parsed.errorLines.map((l) => scrub(l).slice(0, 300));
      rec.tail = lines.filter((l) => l.trim()).slice(-25).map((l) => scrub(l).slice(0, 300));
    }
    saveRun(rec);
    return rec;
  };

  // What changed against the last run of the same check that was not filtered to a subset.
  const against = (rec, runs) => {
    const prev = [...runs].reverse().find((p) => p.name === rec.name && p.id !== rec.id && !p.filtered);
    if (!prev || rec.filtered) return null;
    const was = new Set(prev.failures.map(keyOf));
    const now = new Set(rec.failures.map(keyOf));
    // A run that broke before its tests ran (a compile error) says nothing about what was fixed.
    const reached = rec.ok || rec.counts.passed > 0 || rec.counts.suitesPassed > 0 || rec.kind !== "test";
    const gone = prev.failures.filter((f) => !now.has(keyOf(f))).map((f) => f.name);
    return {
      previous: { id: prev.id, at: prev.at, ok: prev.ok, failed: prev.failures.length, ...(prev.commit ? { commit: prev.commit } : {}) },
      newFailures: rec.failures.filter((f) => !was.has(keyOf(f))).map((f) => f.name).slice(0, 30),
      ...(reached ? { fixed: gone.slice(0, 30) } : gone.length ? { fixedUnknown: "this run may have stopped before the tests that failed last time" } : {}),
      stillFailing: rec.failures.filter((f) => was.has(keyOf(f))).length,
    };
  };

  const view = (rec, { max = 25 } = {}, changed = null) => {
    const { failures, ...rest } = rec;
    // Compiler and linter errors are counted per file, most first: one bad type often causes the rest of a file's errors.
    const byFile = {};
    if ((rec.kind === "typecheck" || rec.kind === "lint" || rec.kind === "build") && failures.length > 1) {
      const n = new Map();
      for (const f of failures) n.set(f.file ?? "(no file)", (n.get(f.file ?? "(no file)") ?? 0) + 1);
      if (n.size > 1) byFile.byFile = Object.fromEntries([...n].sort((a, b) => b[1] - a[1]).slice(0, 20));
    }
    return { verdict: verdictOf(rec, changed), ...rest, failed: failures.length, ...byFile, failures: failures.slice(0, max), ...(failures.length > max ? { failuresLeftOut: failures.length - max } : {}), ...(changed ? { changed } : {}) };
  };

  const api = {
    /** The project these checks belong to: {root, workdir, stateDir}. */
    project: () => ({ root, workdir, stateDir: dir }),

    /** The same API for another folder (a package of a monorepo, another checkout): at("packages/api").run("test"). Relative to the caller's folder. */
    at(other) {
      const target = path.resolve(workdir, expand(String(other)));
      if (!exists(target)) throw new Error(`no folder ${target}`);
      return bind(target, workdir, { push, act });
    },

    /** The checks the project defines, typecheck and lint first: [{name, kind, cmd, from, runnable, why?, script?}]. */
    commands,

    /** For a package.json project: package manager, lockfile, the Node version expected against the one running. Null otherwise. */
    package: () => packageInfo(root),

    /**
     * Run one of the project's checks to the end: by name ("test", "lint", "cargo-test") or by kind
     * ("test", "build", "lint", "typecheck"). o.args are added after the command (a test file, "-k name");
     * o.timeoutS (default 600). Returns the run: {id, name, kind, cmd, ok, code, seconds, timedOut?, counts,
     * failed, failures:[{name, file?, line?, message}], errorLines?, tail?, commit?, uncommittedFiles?, changed?}.
     */
    async run(name, o = {}) {
      const check = pick(name);
      if (!check.runnable && !act) throw new Error(`not in this ask: ${check.name} (${check.cmd.join(" ")}) is not run as a check because ${check.why}, and the caller did not ask for a change (act: true)`);
      const extra = [].concat(o.args ?? []).map(String);
      // npm, pnpm and yarn pass a script its arguments after "--".
      const sep = extra.length && ["npm", "pnpm", "yarn", "bun"].includes(check.cmd[0]) && check.cmd[1] === "run" ? ["--"] : [];
      const before = readRuns();
      const r = await runCmd([...check.cmd, ...sep, ...extra], { timeoutS: o.timeoutS, env: o.env, label: check.name });
      const rec = await record(check, r, [...sep, ...extra]);
      return view(rec, o, against(rec, before));
    },

    /** Earlier runs, newest first, without their failures: [{id, at, name, kind, ok, seconds, failed, commit?}]. o.name keeps one check; o.limit default 15. */
    runs(o = {}) {
      return readRuns()
        .filter((r) => !o.name || r.name === o.name || r.kind === o.name)
        .reverse()
        .slice(0, o.limit ?? 15)
        .map(({ failures, tail, errorLines, counts, ...r }) => ({ ...r, failed: failures.length }));
    },

    /** One earlier run in full, by id, or the latest run of a check by name or kind, or the latest of all. Null when there is none. */
    last(nameOrId, o = {}) {
      const all = readRuns();
      const rec = nameOrId ? all.find((r) => r.id === nameOrId) ?? [...all].reverse().find((r) => r.name === nameOrId || r.kind === nameOrId) : all.at(-1);
      if (!rec) return null;
      return view(rec, o, against(rec, all.slice(0, all.indexOf(rec))));
    },

    /**
     * Lines of a run's log. o.grep (regex, any case) keeps matching lines with o.around (default 0) lines of context;
     * otherwise o.start and o.lines (default the last 60). Returns {id, total, lines:["<n>: text"], more?}. At most 200 lines.
     */
    log(id, o = {}) {
      const rec = id ? readRuns().find((r) => r.id === id) : readRuns().at(-1);
      if (!rec) throw new Error(`no run ${id ?? ""}; checks.runs() lists them`);
      const text = readText(path.join(dir, `${rec.id}.log`));
      if (text == null) throw new Error(`the log of ${rec.id} is gone (only the last ${KEEP_RUNS} runs keep theirs)`);
      const lines = clean(text).split("\n");
      const cap = Math.min(o.max ?? 200, 200);
      let idx;
      if (o.grep) {
        const re = new RegExp(o.grep, "i");
        const keep = new Set();
        lines.forEach((l, i) => {
          if (re.test(l)) for (let j = Math.max(0, i - (o.around ?? 0)); j <= Math.min(lines.length - 1, i + (o.around ?? 0)); j++) keep.add(j);
        });
        idx = [...keep].sort((a, b) => a - b);
      } else {
        const n = Math.min(o.lines ?? 60, cap);
        const start = o.start != null ? Math.max(0, o.start - 1) : Math.max(0, lines.length - n);
        idx = Array.from({ length: Math.min(n, lines.length - start) }, (_, i) => start + i);
      }
      const shown = idx.slice(0, cap);
      return { id: rec.id, total: lines.length, lines: shown.map((i) => `${i + 1}: ${scrub(lines[i]).slice(0, 400)}`), ...(idx.length > cap ? { more: idx.length - cap } : {}) };
    },
  };

  // Any other command line in the project: only when the caller asked for a change.
  if (act) {
    /** Run any command in the project root, as a check is run (logged, parsed, with a timeout): exec(["npm", "run", "format"]). */
    api.exec = async (cmd, o = {}) => {
      const argv = [].concat(cmd).map(String);
      if (!argv.length) throw new Error('exec needs a command as a list: exec(["npm", "ci"])');
      const check = { name: o.name ?? path.basename(argv[0]), kind: "other", cmd: argv };
      const r = await runCmd(argv, { timeoutS: o.timeoutS, env: o.env, label: check.name });
      return view(await record(check, r, []), o);
    };
  } else {
    api.exec = () => {
      throw new Error("not in this ask: checks.exec runs a command the project does not define as a check, which changes things, and the caller did not ask for a change (act: true)");
    };
  }
  return api;
}
