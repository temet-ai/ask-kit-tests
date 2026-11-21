The caller wants tests run, a failure explained, or a failure fixed. Start with what fails now.

1. `await scripts.run("commands")` once: the checks, the package manager and Node version
   (`package`), and whether `node_modules` exists (`package.installed`). If it is not installed,
   say so and stop: installing is `deps`' job and needs `act`.
2. "Do the tests pass": `await scripts.run("run", { check: "test" })`. One file or one test: pass
   `args`. "Is it ready to commit" or "do the checks pass": `await scripts.run("all")`.
3. Tests fail: `skills.read("why-test-fails")` before explaining or changing anything. The typecheck
   fails: `skills.read("fix-type-error")`.
4. In the answer: the counts (`41 passed, 2 failed, 1 skipped`), then each failure as `path:line`,
   the test name, the message, expected and received. At most five in full; say how many more.
5. Asked to make them pass, and this ask may change things: fix, run the same check again, and
   report its counts. A fix is done when the run you report is green. Without `act`, say what to
   change and that the fix needs `ask` with `act: true`.
6. Report what you did not run: a check that is not runnable (`why`), a runner that is not
   installed, a filtered run that says nothing about the rest of the suite.
