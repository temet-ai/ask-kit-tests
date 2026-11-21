// A test that fails on every second run, to prove the flaky script. The count is kept outside the
// repository so a run leaves no change behind.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const file = path.join(os.tmpdir(), "ask-kit-tests-fixture-clacks.count");
let n = 0;
try {
  n = Number(fs.readFileSync(file, "utf8")) || 0;
} catch {}
fs.writeFileSync(file, String(n + 1));

test("the clacks message arrives", () => {
  assert.equal(n % 2, 0, "the message was lost at tower 14");
});

test("the tower is manned", () => {
  assert.ok(true);
});
