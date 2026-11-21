Find why a test fails and decide whether the test or the code is wrong

1. Run the failing test alone. Pass its file and the runner's name filter in `args`:
   `await scripts.run("run", { check: "test", args: ["test/roster.test.mjs", "--test-name-pattern=Nobby"] })`
   (`-t name` for jest and vitest, `-k name` for pytest, `-run Name` for go). Read `message`,
   `expected`, `received` and `file:line` of each failure. A test that passes alone and fails in the
   full run depends on shared state or order: say that, and look for a shared fixture, a
   module-level variable, a port, a temp path or the current date.
2. If the message is not enough, `await scripts.run("failure", { find: "<test name>" })` gives the
   lines around it in the log, with the stack and the diff.
3. Read the test: `repo.read(file, { from: line - 15, to: line + 15 })`. Failure paths are relative to
   `checks.project().root`, which is `repo.root` unless the run used `dir`; then the path in `repo`
   is `<dir>/<file>`. Say in one sentence what the test claims.
4. Read the code under test: `repo.rg("<function name>")`, then `repo.read` at the hit. Compare what
   the code does with what the test claims.
5. Decide which is wrong, and quote a line of each:
   - the code is wrong when the test states a behaviour the project documents or other tests rely
     on, and the code does not do it;
   - the test is wrong when it states a behaviour the code was deliberately changed away from
     (`repo.git("log", "-5", "--format=%h %ad %s", "--date=short", "--", "<file>")`), or has a
     stale fixture, a date or an ordering assumption.
6. Failures that are not assertions: `Cannot find module` is a missing dependency or a wrong import
   path (in ESM, check the file extension; `ask.kit("deps", "is <name> installed?")` says whether
   the package is there); a timeout is an unresolved promise or an open handle;
   `ERR_REQUIRE_ESM` or `Unexpected token 'export'` means package.json's `type` and the file
   extension disagree (`scripts.run("commands")` shows `package.type`).
7. Only when the caller asked for a fix: edit the side that is wrong (`repo.edit`), run the same
   file again, then the whole suite once (`scripts.run("run", { check: "test" })`), and report both
   counts. A fix that turns a second test red is not done.
8. Never weaken an assertion to make it pass: no looser matcher, no deleted assertion, no skip, no
   larger timeout as the only change. If the test must change, change what it claims to what is
   now true and say so in the answer.
