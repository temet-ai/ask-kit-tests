import test from "node:test";
import assert from "node:assert/strict";
import { onDuty } from "./roster.mjs";

test("Vimes is on duty at Pseudopolis Yard", () => {
  assert.deepEqual(onDuty("Pseudopolis Yard"), ["Sam Vimes"]);
});

test("Cable Street has two officers", () => {
  assert.equal(onDuty("Cable Street").length, 2);
});

test("an unknown post throws", () => {
  assert.throws(() => onDuty("Unseen University"));
});

test("Angua works nights", () => {
  assert.ok(onDuty("Cable Street").includes("Angua"));
});

test("Nobby is on the roster", () => {
  if (!onDuty("Cable Street").includes("Nobby Nobbs")) throw new TypeError("Nobby is missing from Cable Street");
});
