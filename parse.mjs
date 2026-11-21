// Failures and counts out of a test, build, lint or typecheck run's output. Every reader below
// looks for one tool's format and adds what it finds; an output nothing recognises still gets its
// `path:line` error lines and its last lines. Nothing here runs anything.

const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07]*\x07/g;
export const clean = (text) => String(text ?? "").replace(ANSI, "").replace(/\r\n?/g, "\n");

const clip = (s, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);
const loc = (s) => {
  // file:line[:col] with an optional file:// prefix and parentheses around it.
  const m = /(?:file:\/\/)?((?:[A-Za-z]:)?[^\s():'"]+\.[A-Za-z0-9]+):(\d+)(?::\d+)?/.exec(s ?? "");
  return m ? { file: m[1], line: Number(m[2]) } : {};
};
const mine = (file) => file && !/node_modules|node:internal|^node:|site-packages|\/rustc\/|\.cargo\/registry|\/go\/src\/(testing|runtime)\//.test(file);
// The first stack frame in the project's own code.
const firstOwn = (lines) => {
  for (const l of lines) {
    const p = loc(l);
    if (p.file && mine(p.file)) return p;
  }
  return {};
};

// ---- node:test and other TAP ----
function tap(lines, out) {
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)not ok \d+ (?:- )?(.*)$/.exec(lines[i]);
    if (!m || /# (SKIP|TODO)/i.test(m[2])) continue;
    const block = [];
    if (/^\s*---\s*$/.test(lines[i + 1] ?? "")) for (let j = i + 2; j < lines.length && !/^\s*\.\.\.\s*$/.test(lines[j]); j++) block.push(lines[j]);
    const text = block.join("\n");
    if (/failureType: '?subtestsFailed/.test(text)) continue; // a file or suite wrapper: its subtests are listed themselves
    const at = /location: '?([^'\n]+)'?/.exec(text)?.[1];
    const ei = block.findIndex((l) => /^\s*error:/.test(l));
    let message = "";
    if (ei >= 0) {
      const same = block[ei].replace(/^\s*error:\s*/, "").replace(/^['"]|['"]$/g, "");
      if (same && !/^[|>][-+]?$/.test(same)) message = same;
      else for (let j = ei + 1; j < block.length && /^\s{4,}\S|^\s*$/.test(block[j]) && !/^\s{2}\w+:/.test(block[j]); j++) message += (message ? "\n" : "") + block[j].trim();
    }
    const si = block.findIndex((l) => /^\s*stack:/.test(l));
    const stack = si < 0 ? [] : block.slice(si + 1).filter((l) => /:\d+:\d+/.test(l));
    const own = firstOwn(stack);
    // `expected: 7`, `actual: 6` and `operator: 'strictEqual'` are one-line keys of the YAML block.
    const key = (k) => new RegExp(`^\\s*${k}: (?![|>][-+]?$)(.+)$`, "m").exec(text)?.[1]?.replace(/^'(.*)'$/, "$1");
    const [expected, received, operator] = ["expected", "actual", "operator"].map(key);
    out.push({ name: m[2].replace(/\s+#.*$/, "").trim(), ...(own.file ? own : loc(at)), message: clip(message.replace(/\n{2,}/g, "\n").trim()), ...(expected != null ? { expected: clip(expected, 200) } : {}), ...(received != null ? { received: clip(received, 200) } : {}), ...(operator ? { operator } : {}) });
  }
}

// ---- node:test spec reporter: the "failing tests:" section ----
function nodeSpec(lines, out) {
  const start = lines.findIndex((l) => /^✖ failing tests:/.test(l));
  if (start < 0) return;
  for (let i = start + 1; i < lines.length; i++) {
    const at = /^test at (.+)$/.exec(lines[i]);
    if (!at) continue;
    const name = /^✖ (.*?)(?: \([\d.]+ms\))?$/.exec(lines[i + 1] ?? "")?.[1];
    if (!name) continue;
    const body = [];
    for (let j = i + 2; j < lines.length && !/^test at /.test(lines[j]); j++) body.push(lines[j]);
    const text = body.filter((l) => l.trim() && !/^\s+at /.test(l)).map((l) => l.trim());
    // The error's own properties follow its stack: `actual: 6`, `expected: 7`, `operator: 'strictEqual'`.
    const end = text.findIndex((l) => /^(generatedMessage|code|actual|expected|operator|diff): /.test(l));
    const msg = text.slice(0, end < 0 ? 12 : Math.min(end, 12)).join("\n").replace(/ \{$/, "");
    const prop = (k) => text.slice(end < 0 ? text.length : end).map((l) => new RegExp(`^${k}: (.+?),?$`).exec(l)?.[1]).find(Boolean);
    const own = firstOwn(body.filter((l) => /^\s+at /.test(l)));
    if (/subtest.*failed|test failed/i.test(msg) && !own.file && out.some((f) => loc(at[1]).file === f.file)) continue;
    const [expected, received, operator] = ["expected", "actual", "operator"].map(prop);
    out.push({ name, ...(own.file ? own : loc(at[1])), message: clip(msg), ...(expected != null ? { expected: clip(expected, 200) } : {}), ...(received != null ? { received: clip(received, 200) } : {}), ...(operator ? { operator: operator.replace(/^'|'$/g, "") } : {}) });
  }
}

// ---- jest ----
function jest(lines, out) {
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s+● (.+)$/.exec(lines[i]);
    if (!m || /^Console$|Test suite failed to run/.test(m[1])) {
      if (m && /Test suite failed to run/.test(m[1])) {
        const body = lines.slice(i + 1, i + 12).filter((l) => l.trim());
        out.push({ name: "test suite failed to run", ...firstOwn(body), message: clip(body.slice(0, 4).map((l) => l.trim()).join("\n")) });
      }
      continue;
    }
    const body = [];
    for (let j = i + 1; j < lines.length && !/^\s+● /.test(lines[j]) && !/^(Test Suites:|PASS|FAIL) /.test(lines[j]); j++) body.push(lines[j]);
    const msg = body.filter((l) => l.trim() && !/^\s+at |^\s+\d* ?[|>]|^\s+\^/.test(l)).slice(0, 6).map((l) => l.trim()).join("\n");
    out.push({ name: m[1].trim(), ...firstOwn(body.filter((l) => /^\s+at /.test(l))), message: clip(msg) });
  }
}

// ---- vitest ----
function vitest(lines, out) {
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:FAIL|×|✗)\s+(\S+\.[cm]?[jt]sx?)(?:\s*\[[^\]]*\])?\s+>\s+(.+?)(?:\s+\d+ms)?$/.exec(lines[i]);
    if (!m) continue;
    const body = [];
    for (let j = i + 1; j < lines.length && j < i + 40 && !/^\s*(FAIL|×|✗)\s+\S+ > |^⎯+\[\d+\/\d+\]⎯+$/.test(lines[j]); j++) body.push(lines[j]);
    const msg = body.filter((l) => l.trim() && !/^\s*(❯|at |\d+\||\^|\|)/.test(l)).slice(0, 5).map((l) => l.trim()).join("\n");
    const at = body.find((l) => /^\s*❯ .*:\d+:\d+/.test(l) && mine(loc(l).file));
    const f = { name: m[2].trim(), ...(at ? loc(at) : { file: m[1] }), message: clip(msg) };
    if (!out.some((o) => o.name === f.name && o.file === f.file)) out.push(f);
  }
}

// ---- pytest ----
function pytest(lines, out) {
  const seen = new Map();
  for (const l of lines) {
    const m = /^(FAILED|ERROR) (\S+?)(?:::(\S.*?))?(?: - (.*))?$/.exec(l);
    if (!m) continue;
    const f = { name: m[3] ? m[3] : m[2], file: m[2], message: clip(m[4] ?? (m[1] === "ERROR" ? "error while collecting or setting up" : "")) };
    seen.set(`${m[2]}::${m[3] ?? ""}`, f);
    out.push(f);
  }
  // The line of the failure: "path.py:12: AssertionError" inside the test's section.
  let cur = null;
  for (const l of lines) {
    const h = /^_{3,} (.+?) _{3,}$/.exec(l);
    if (h) {
      cur = h[1].trim();
      continue;
    }
    const e = /^E\s+(.+)$/.exec(l);
    if (e && cur) {
      const file = /^ERROR collecting (\S+)/.exec(cur)?.[1];
      for (const f of out) if (file && f.file === file && /^error while collecting/.test(f.message)) f.message = clip(e[1]);
      continue;
    }
    const m = /^(\S+\.py):(\d+): ?(in \S+|\w[\w.]*)?\s*$/.exec(l);
    if (!m || !cur) continue;
    const short = cur.replace(/^.*\./, "");
    for (const f of out) if (f.file === m[1] && !f.line && (f.name === cur || f.name.endsWith(`::${short}`) || f.name === short || f.name.replace(/\[.*$/, "") === short)) f.line = Number(m[2]);
  }
}

// ---- cargo test, and rustc errors ----
const untilBacktrace = (lines) => {
  const i = lines.findIndex((l) => /^stack backtrace:/.test(l.trim()));
  return i < 0 ? lines : lines.slice(0, i);
};
function cargo(lines, out) {
  for (let i = 0; i < lines.length; i++) {
    const m = /^---- (\S+) stdout ----$/.exec(lines[i]);
    if (m) {
      const body = [];
      for (let j = i + 1; j < lines.length && !/^---- \S+ stdout ----$|^failures:$/.test(lines[j]); j++) body.push(lines[j]);
      const pi = body.findIndex((l) => /panicked at/.test(l));
      const at = pi >= 0 ? loc(body[pi]) : {};
      const inline = pi >= 0 ? /panicked at '(.*)', /.exec(body[pi])?.[1] : null;
      const msg = inline ?? untilBacktrace(body.slice(pi + 1)).filter((l) => l.trim() && !/^note: run with/.test(l)).slice(0, 5).map((l) => l.trim()).join("\n");
      out.push({ name: m[1], ...at, message: clip(msg) });
      continue;
    }
    const e = /^(error(?:\[E\d+\])?): (.+)$/.exec(lines[i]);
    if (e && !/aborting due to|could not compile|test failed|process didn't exit successfully/.test(e[2])) {
      const at = lines.slice(i + 1, i + 4).map((l) => /^\s*--> (.+)$/.exec(l)?.[1]).find(Boolean);
      if (at) out.push({ name: e[1], ...loc(at), message: clip(e[2]) });
    }
  }
}

// ---- go test ----
function gotest(lines, out) {
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)--- FAIL: (\S+)/.exec(lines[i]);
    if (!m) continue;
    const body = [];
    for (let j = i + 1; j < lines.length && /^\s{4,}/.test(lines[j]) && !/^\s*--- (FAIL|PASS|SKIP)/.test(lines[j]); j++) body.push(lines[j]);
    // A parent test whose only content is failing subtests is a wrapper.
    if (!body.length && /^\s*--- FAIL: /.test(lines[i + 1] ?? "") && (lines[i + 1].match(/^\s*/)[0].length > m[1].length)) continue;
    const first = body.find((l) => /\S+\.go:\d+:/.test(l));
    const msg = body.map((l) => l.trim().replace(/^\S+\.go:\d+: /, "")).slice(0, 5).join("\n");
    out.push({ name: m[2], ...(first ? loc(first) : {}), message: clip(msg) });
  }
  for (const l of lines) {
    const b = /^(\S+\.go):(\d+):\d+: (.+)$/.exec(l);
    if (b) out.push({ name: "build", file: b[1], line: Number(b[2]), message: clip(b[3]) });
  }
}

// ---- tsc, vue-tsc and svelte-check ----
// tsc prints `file(line,col): error TS2322: message` (--pretty false, and whenever stdout is not a
// terminal) or `file:line:col - error TS2322: message` (pretty, colours stripped by clean()). A file
// may hold spaces. The lines indented under an error, up to a blank line, are the rest of its message
// ("Types of parameters 'a' and 'a' are incompatible."). An error with no file (an older tsc's
// tsconfig errors) is `error TS5023: message`. svelte-check --output machine prints
// `1700000000000 ERROR "src/App.svelte" 3:5 "message"`.
function tsc(lines, out) {
  let cur = null;
  for (const l of lines) {
    let m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(l) || /^(.+?):(\d+):(\d+) - error (TS\d+): (.*)$/.exec(l);
    if (m) {
      cur = { name: m[4], code: m[4], file: m[1].trim(), line: Number(m[2]), col: Number(m[3]), message: m[5].trim() };
      out.push(cur);
      continue;
    }
    if ((m = /^error (TS\d+): (.*)$/.exec(l))) {
      cur = { name: m[1], code: m[1], message: m[2].trim() };
      out.push(cur);
      continue;
    }
    if ((m = /^\d+ ERROR "(.+?)" (\d+):(\d+) "(.*)"$/.exec(l))) {
      out.push({ name: "svelte-check", code: "svelte-check", file: m[1], line: Number(m[2]), col: Number(m[3]), message: clip(m[4]) });
      cur = null;
      continue;
    }
    if (cur && /^\s{2,}\S/.test(l) && !/^\s+\S.*:\d+:\d+ - /.test(l)) cur.message += `\n${l.trim()}`;
    else cur = null;
  }
  for (const f of out) if (f.code && f.message) f.message = clip(f.message, 600);
}

// ---- compilers, type checkers and linters that print path:line ----
function diagnostics(lines, out) {
  let file = null; // eslint's stylish format names the file on its own line
  for (const l of lines) {
    let m;
    if (/^(.+?)\(\d+,\d+\): error TS\d+: |^(.+?):\d+:\d+ - error TS\d+: /.test(l)) continue; // tsc(), above
    else if ((m = /^(\S+\.pyi?):(\d+)(?::\d+)?: error: (.+?)(?:\s+\[([\w-]+)\])?$/.exec(l))) out.push({ name: m[4] ?? "mypy", file: m[1], line: Number(m[2]), message: clip(m[3]) });
    else if ((m = /^(\S+\.pyi?):(\d+):\d+: ([A-Z]+\d+) (.+)$/.exec(l))) out.push({ name: m[3], file: m[1], line: Number(m[2]), message: clip(m[4]) });
    else if ((m = /^((?:[A-Za-z]:)?[^\s:]+\.\w+):(\d+):(?:\d+:)? (?:fatal )?error: (.+)$/.exec(l))) out.push({ name: "error", file: m[1], line: Number(m[2]), message: clip(m[3]) });
    else if (/^(\/|[A-Za-z]:\\|\.{0,2}\/)?[^\s:]+\.\w+$/.test(l.trim()) && !/^\s/.test(l)) file = l.trim();
    else if (file && (m = /^\s+(\d+):\d+\s+error\s+(.+?)\s{2,}(\S+)$/.exec(l))) out.push({ name: m[3], file, line: Number(m[1]), message: clip(m[2]) });
    else if (l.trim() === "") file = /^\s+\d+:\d+/.test(l) ? file : file;
  }
}

// ---- counts from the summary lines ----
function counts(lines) {
  const c = {};
  const set = (k, v) => (c[k] = (c[k] ?? 0) + Number(v));
  const put = (k, v) => (c[k] = Number(v));
  for (const l of lines) {
    let m;
    if ((m = /^[#ℹ] (tests|pass|fail|skipped|cancelled|todo) (\d+)$/.exec(l))) put({ tests: "total", pass: "passed", fail: "failed", skipped: "skipped", cancelled: "cancelled", todo: "todo" }[m[1]], m[2]);
    else if (/^Tests:\s/.test(l)) for (const [, n, k] of l.matchAll(/(\d+) (failed|passed|skipped|todo|total)/g)) put(k, n);
    else if (/^\s*Tests\s+\d/.test(l) || /^\s*Tests\s+.*\(\d+\)/.test(l)) {
      for (const [, n, k] of l.matchAll(/(\d+) (failed|passed|skipped|todo)/g)) put(k, n);
      if ((m = /\((\d+)\)\s*$/.exec(l))) put("total", m[1]);
    } else if (/^(=+ )?\d+ \w+(, \d+ \w+)* in [\d.]+s( \([\d:]+\))?( =+)?$/.test(l) && /\d+ (passed|failed|error)/.test(l)) for (const [, n, k] of l.matchAll(/(\d+) (failed|passed|skipped|errors?|xfailed|xpassed|deselected)/g)) put(k.replace(/^errors?$/, "errors"), n);
    else if ((m = /^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/.exec(l))) (set("passed", m[1]), set("failed", m[2]), set("skipped", m[3]));
    else if ((m = /^✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)/.exec(l))) (put("errors", m[2]), put("warnings", m[3]));
    else if ((m = /^Found (\d+) errors?/.exec(l))) put("errors", m[1]);
    else if (/^ok\s+\S+\s+[\d.]+s|^ok\s+\S+\s+\(cached\)/.test(l)) set("suitesPassed", 1);
    else if (/^FAIL\s+\S+\s+([\d.]+s|\[build failed\])/.test(l)) set("suitesFailed", 1);
  }
  return c;
}

const ERRORISH = /\b(error|failed|failure|fatal|panic|exception|traceback|cannot find|not found|undefined|denied|refused|timed out|ELIFECYCLE|ERR_[A-Z_]+|exit (code|status) [1-9])\b/i;

/**
 * Read a run's output. Returns {failures:[{name, file?, line?, message}], counts:{...}, errorLines:[...]}:
 * `errorLines` are the last lines that look like errors, for output no reader recognised.
 */
export function parse(text, { maxFailures = 500 } = {}) {
  const lines = clean(text).split("\n");
  const found = [];
  tap(lines, found);
  nodeSpec(lines, found);
  jest(lines, found);
  vitest(lines, found);
  pytest(lines, found);
  cargo(lines, found);
  gotest(lines, found);
  tsc(lines, found);
  diagnostics(lines, found);
  const seen = new Set();
  const failures = [];
  for (const f of found) {
    const k = `${f.name}|${f.file ?? ""}|${f.line ?? ""}`;
    if (seen.has(k) || (!f.name && !f.message)) continue;
    // The same test reported by two readers (the spec reporter prints a failure twice): keep the first.
    if (failures.some((o) => o.name === f.name && (o.file ?? f.file) === (f.file ?? o.file) && (o.line == null || f.line == null || o.line === f.line) && (o.col == null || f.col == null || o.col === f.col))) continue;
    seen.add(k);
    failures.push(f);
    if (failures.length >= maxFailures) break;
  }
  const errorLines = failures.length ? [] : [...new Set(lines.filter((l) => ERRORISH.test(l) && l.trim().length < 400).map((l) => l.trim()))].slice(-15);
  return { failures, counts: counts(lines), errorLines };
}

/**
 * A failure's identity across runs: its name and file, without line numbers or timings. A compiler
 * error (one with a `code`) adds its message's first line, because one file often holds several
 * errors with the same code and their lines move as the file is edited.
 */
export const keyOf = (f) => `${f.file ?? ""}::${f.name}${f.code ? `::${String(f.message ?? "").split("\n")[0].slice(0, 120)}` : ""}`.replace(/\s+\([\d.]+ ?m?s\)/, "");
