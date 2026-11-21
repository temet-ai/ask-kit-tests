# Recipe: the tests kit

## What it answers

Whether a project's tests, build, lint and typecheck pass, which tests fail and why (name, file,
line, message, expected and received), each type error (file, line, column, TS code, message),
whether a failure is new since the last run, whether a test is flaky over repeated local runs,
what the last run said, which scripts the project has, and for a JavaScript package its package
manager and expected Node version. With `act`, it fixes a failing test or a type error and runs
any other command in the project. It took over the npm kit's test, typecheck, lint, build and
scripts questions on 2026-11-21.

## What it needs

- ask-kit 0.3 or later (`min_ask_kit = "0.3.0"`).
- The programs the project's own checks use. The kit has none of its own.
- Two settings, both detected: `WORKDIR` (the folder the agent runs in) and `PROJECT_ROOT` (the
  nearest folder at or above it with a project manifest), which the `repo` folder source reads.

## What it reads and runs

It reads `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Makefile`, `justfile` and a
few lockfile names, in the nearest folder at or above `WORKDIR` that has one, to find the checks.
It runs the check asked for (no shell, each argument separate; through `cmd.exe` on Windows),
with `CI=1`, `NO_COLOR=1` and a timeout, in its own process group, with stdout and stderr in a
log file under `<ask-kit state>/tests/<project>/`. It runs `git rev-parse --short HEAD` and
`git status --porcelain` to record the state a run saw. `runs.jsonl` there holds the last 40
runs with their failures.

Not run as a check: scripts that do not end (`dev`, `start`, `serve`, `watch`, `preview`) or that
change things (`deploy`, `release`, `publish`, `migrate`, `clean`, `install`, `format`, names
ending in `:fix` or `:write`). `checks.exec`, which runs any command line, exists only with `act`.

Returned lines have keys, tokens, passwords and URL passwords redacted. The `repo` source excludes
`.env*`, `.npmrc`, `.yarnrc*`, `.netrc`, `.pypirc`, key and credential files, lockfiles,
`node_modules`, virtual environments and build output; it edits and writes only with `act`.

## Brief to rebuild it from an empty folder

Make a folder with `ask-kit.toml` (id `temet.tests`, name `tests`, `says`, `keywords`,
`route_hint`, `cite`, `state_key = "${WORKDIR}"`, `acts = ["checks.exec", "repo.edit",
"repo.write"]`, a `WORKDIR` setting whose `detect` prints the current folder, a `PROJECT_ROOT`
setting whose `detect` walks up to the nearest project manifest, a `[[sources]]` of kind `module`,
name `checks`, module `checks.mjs`, api `api.d.ts`, a `[[sources]]` of kind `folder`, name `repo`,
path `${PROJECT_ROOT}` with credentials, lockfiles and build output excluded, a `[[roles]]`
`tester`, and two `[[actions]]`: `commands` for "how do I run the tests" and `last` for "what did
the last test run say") and `instructions = "instructions.md"`. The keywords leave cargo and
clippy to the rust kit.

`parse.mjs` exports `parse(text)` returning `{failures:[{name, file, line, message}], counts,
errorLines}`. It strips ANSI codes and runs one reader per format over the lines: TAP (`not ok`
with its YAML block; the line comes from the first stack frame in the project's own code, else
from `location`; a wrapper with `failureType: subtestsFailed` is skipped), the node:test spec
reporter's "failing tests:" section (with `actual`, `expected` and `operator` from the error's
properties, which TAP gives as YAML keys), jest (`● suite › test` blocks), vitest (`FAIL file > suite >
test` blocks), pytest (the `FAILED path::test - message` summary, with lines from the test's
section), cargo test (`---- name stdout ----` with `panicked at`, cut at the backtrace) and
rustc (`error[E...]` with its `-->` line), go test (`--- FAIL:` with its indented lines; a parent
of failing subtests is skipped) and the go compiler, tsc and vue-tsc (`file(line,col): error
TSxxxx:` and the pretty `file:line:col - error TSxxxx:`, a file name may hold spaces, the indented
lines under an error join its message, `error TSxxxx:` with no file for tsconfig errors; `name` and
`code` are the TS code, `col` is set), svelte-check's machine output, and diagnostics in the forms
mypy, ruff, eslint and gcc print. Counts come from each tool's summary line. The same failure from
two readers is kept once. `keyOf(failure)` is its identity across runs: file and name, and for a
compiler error also the first line of its message.

`checks.mjs` exports `make({settings, push, act})` returning the `checks` global bound to the
project at or above `WORKDIR`: `project()`, `at(dir)` (the same API for another folder),
`commands()` (the detection above; `runnable: false` with `why` for scripts that do not end or
that change things), `run(name, {args, timeoutS, max})` (spawn, log to a file, kill the process
group on timeout or a 20 MB log, parse, record, compare with the last unfiltered run of the same
check: `newFailures`, `fixed`, `stillFailing`; `fixed` is left out when the run failed before any
test passed), `runs()`, `last(nameOrId)`, `log(id, {grep, around, start, lines})`, `package()`
(manager, lockfile, notes, Node expected and running, for a package.json project) and `exec(cmd)`
(built only with `act`). Every run carries a one-line `verdict` ("typecheck failed: 5 errors in 3
files"), and a typecheck, lint or build run with errors in several files carries `byFile`. With no
typecheck script and a `tsconfig.json`, `tsc --noEmit` comes from `node_modules/.bin`, else from
PATH, and `from` says which.

Scripts in `scripts/` (each `export const meta = {purpose, params, returns, example}` and
`export default async function ({checks}, params)`; each takes `dir` for another folder): `run`,
`all` (one command of each kind in the order typecheck, lint, test, build), `commands` (adds
`package()`), `last`
(adds each run's age and whether HEAD moved since), `failure` (the newest of the last runs whose
log holds the text, with the lines around it), `flaky` (a check 2 to 10 times: failures in every
run and failures in some).

`instructions.md` has the docker kit's structure: how to work (scripts first; a question about
passing is answered by running now; filters; the verdict comes from the exit code; read the test
and the code before saying which is wrong; edit only when a fix was asked for, and never weaken
an assertion; never run a slow check twice for the same result; which neighbouring kit owns
packages, Rust and CI cost) and the answer format (result first, then failures as test name,
`path:line` and message). Skills: `why-test-fails`, `fix-type-error`. Role: `tester`.

`bench/fixture/watch` is a small npm project with node:test tests, two of which fail on purpose,
a test that fails every second run, a stand-in linter that prints two errors, and `dev` and
`deploy` scripts that must not run. `bench/fixture/typecheck` is a TypeScript package with five
type errors on purpose, one with a three-line message and one in `src/night watch/`.
`bench/questions.json` holds `do` questions against both and against ask-kit's `package.json`, and
three `q` questions of the kinds the npm kit's bench held.

## Bench

Run it from the kit's folder, because the fixture path is relative: `ask-kit kit test tests`.
Eleven questions are shots (`do`), which call no model. The three `q` questions call one: the
failing tests, the type errors and the scripts and Node version, of kinds agents answer by hand.

## Results

ask-kit `kit test` on 2026-11-20: 8/8, all answered with no model. On 2026-11-21 the eleven shots
were run one at a time with `ask-kit run`: 11/11. The `q` questions have not been run on a model.
