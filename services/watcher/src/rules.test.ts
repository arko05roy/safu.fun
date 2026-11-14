import { test } from "node:test";
import assert from "node:assert/strict";
import { checkR1, checkR2, evaluate } from "./rules.js";

const h = (address: string, baseline: bigint, current: bigint) => ({ address, baseline, current });

test("R1 triggers at exactly 50% out", () => {
  assert.equal(checkR1(h("dev", 1000n, 501n), 5000), null);
  const hit = checkR1(h("dev", 1000n, 500n), 5000);
  assert.equal(hit?.rule, "R1");
  assert.equal(hit?.outflow, 500n);
});

test("R1 ignores a deployer who bought more", () => {
  assert.equal(checkR1(h("dev", 1000n, 5000n), 5000), null);
});

test("R1 ignores zero-baseline deployer", () => {
  assert.equal(checkR1(h("dev", 0n, 0n), 5000), null);
});

test("R2 nets transfers between insiders", () => {
  // a sends 400 to b: combined balance unchanged
  assert.equal(checkR2([h("a", 500n, 100n), h("b", 500n, 900n)], 5000), null);
});

test("R2 triggers on collective dump and lists sellers", () => {
  const hit = checkR2([h("a", 500n, 0n), h("b", 300n, 300n), h("c", 200n, 100n)], 5000);
  assert.equal(hit?.rule, "R2");
  assert.equal(hit?.outflow, 600n);
  assert.deepEqual(hit?.sellers.map((s) => s.address), ["a", "c"]);
});

test("R2: one insider's gains cannot hide another's dump", () => {
  // b over-baseline is capped at baseline, so a's 100% dump still counts
  const hit = checkR2([h("a", 500n, 0n), h("b", 500n, 5000n)], 5000);
  assert.equal(hit?.outflow, 500n);
});

test("evaluate prefers R1", () => {
  const hit = evaluate(h("dev", 100n, 0n), [h("a", 100n, 0n)], 5000, 5000);
  assert.equal(hit?.rule, "R1");
});
