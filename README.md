# ask-kit-tests

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that lets your coding agent's `ask` tool run
your project's tests, build, lint and typecheck. A cheap model runs the project's own check
commands outside your agent's context and answers with what failed: the test name, `file:line`,
the message and, for an assertion, expected and received; for a type error the TS code and the
whole message. The log stays on disk, not in your agent's context. Asked for a fix, it edits the
failing test or the code and runs the check again.

It does the job people give a test-runner subagent or a "run the checks" skill:

- Do the tests pass? Which fail, and why?
- Is everything green: typecheck, lint, tests and build?
- Did my change break anything that passed in the last run?
- Is the roster test flaky, or does it fail every time?
- What did the last test run say? (answered from the saved run, with no model and no new run)
- Does this package type-check? Each error with `file:line` and TS code.
- What does `npm test` run, and which Node version does the package expect?

## Install

You need [ask-kit](https://github.com/temet-ai/ask-kit#set-it-up) 0.3 or later. The kit has no
dependencies of its own; it runs whatever your project's checks use (npm, pytest, cargo, go, make).

Paste this into your agent:

```
Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-tests
```

Or run it yourself:

```sh
ask-kit kit install temet-ai/ask-kit-tests        # shows what it reads, changes and runs
ask-kit kit install temet-ai/ask-kit-tests --yes  # installs and enables it
```

Restart your agents so `ask` lists `tests`. Its two settings are found for you: `WORKDIR`, the
folder whose project is checked (the folder your agent runs in), and `PROJECT_ROOT`, the
project's top folder that the `repo` source reads.

## What it finds and reads

| Project | Checks it finds |
|---|---|
| `package.json` | every script, run with npm, pnpm, yarn or bun by the lockfile; `tsc --noEmit` when there is a `tsconfig.json` and no typecheck script |
| `Cargo.toml` | `cargo test`, `check`, `clippy`, `build`, `fmt --check` |
| `go.mod` | `go test ./...`, `go vet ./...`, `go build ./...` |
| `pyproject.toml`, `pytest.ini`, `tests/` | `pytest`, and `ruff`, `mypy` or `pyright` when configured; through `uv run` or `poetry run` by the lockfile |
| `Makefile`, `justfile` | targets named like a test, lint, build or check |
| `deno.json`, `mix.exs`, `Gemfile` with `spec/`, `build.gradle`, `pom.xml` | the usual test command |

It reads failures from node:test (TAP and spec, with expected, received and the operator), jest,
vitest, pytest, cargo test and rustc, go test and the go compiler, tsc and vue-tsc (file, line,
column, TS code and the whole message, in plain and pretty output, file names with spaces),
svelte-check, eslint, ruff, mypy, and any tool that prints `path:line: error:`. Compiler and
linter errors are also counted per file (`byFile`). For anything else it returns the lines that
look like errors and the end of the log.

For a `package.json` project, `commands` also gives the package manager (from the lockfile and
the `packageManager` field, with a note when they disagree), the Node version the package expects
(`.nvmrc`, `.node-version`, `.tool-versions`, mise, `engines`, `volta`) and the one running.

Questions about a Rust workspace (cargo, clippy, crates) belong to the rust kit, and which
packages are installed, why, and adding one, to the deps kit. The tests kit still runs cargo's
checks in a project that mixes Rust with something else.

## What it can change

Running a check runs your project's code, as you. Without being asked for a change it runs only
the checks the project defines, and not the scripts that do not end (`dev`, `start`, `watch`) or
that change things (`deploy`, `release`, `publish`, `format`). When the caller asks for a change
(`act: true`), `checks.exec` runs any command line in the project root, and the investigator
edits files through the `repo` source to fix a failing test or a type error. A question never
edits.

- Every run has a timeout (600 seconds unless told otherwise) and its process group is killed
  when the time is up. `CI=1` is set, so test runners do not start a watch mode. A log that
  passes 20 MB ends the run.
- The whole output goes to a log under ask-kit's state folder (`tests/<project>/`), which keeps
  the last 40 runs. The model sees the failures and the lines it asks for, at most 200 at a time.
- Lines that carry a key, token or password, and URLs with a password in them, are shown with
  the value redacted. Test output is otherwise passed on as the tool printed it.
- The `repo` source never searches or reads `.env` files, `.npmrc`, key and credential files,
  lockfiles, `node_modules`, virtual environments or build output.

## How well it works

`bench/questions.json` holds eleven shots that run with no model against `bench/fixture/watch`, a
small project whose tests fail on purpose, `bench/fixture/typecheck`, a TypeScript package with
five type errors. Run from the kit's folder on 2026-11-21 with
`ask-kit run`, one shot at a time: 11/11 passed. The readers were also run against real failing
output of node:test, vitest, jest, pytest, cargo test, go test, tsc 7, eslint, ruff and mypy.

Three questions for a model (`q`) came from the npm kit, which this kit took over: the tests,
typecheck and scripts questions of kinds agents answer by hand. They have not been run on a
model, so there is no score for an investigator model yet. Windows is written for (commands run through `cmd.exe`) and not
tested.

## What is in it

`checks.mjs` finds the project's checks, runs one to the end and records the run; `parse.mjs`
reads the failures out of the output. Its scripts are `run` (one check: verdict, failures, what
changed since the run before), `all` (typecheck, lint, test and build in turn), `commands` (what
checks exist), `last` (the last run of each check, and whether the code changed since),
`failure` (one failure in full from the log) and `flaky` (one check several times: what fails
always and what fails sometimes). The skills `why-test-fails` and `fix-type-error` are playbooks
the investigator loads for those jobs, and the `tester` role covers requests to run, explain or
fix tests. [RECIPE.md](RECIPE.md) says what it reads and runs, and how to rebuild it.

MIT licence.
