import { test } from "node:test";
import assert from "node:assert/strict";
import { assessRisk } from "./risk";
import type { TokenProfile } from "./explorers";

const base: TokenProfile = {
  chain: "near",
  address: "t",
  name: "T",
  symbol: "T",
  decimals: 18,
  totalSupply: 1000n,
  holderCount: 10_000,
  createdAtMs: 0,
  deployer: "dev",
  deployerBalance: 0n,
  insiders: [],
  snapshotBlock: 1n,
};
const NOW = 400 * 86_400_000;

test("old, wide, dev-less token gets the floor premium", () => {
  const r = assessRisk(base, NOW);
  assert.ok(r.premiumBps <= 120, `got ${r.premiumBps}`);
});

test("fresh token with dev holding 85% prices in the top band", () => {
  const r = assessRisk(
    { ...base, createdAtMs: NOW - 3_600_000, holderCount: 4, deployerBalance: 850n, insiders: [{ address: "a", balance: 100n, isContract: false }] },
    NOW,
  );
  assert.ok(r.premiumBps >= 500, `got ${r.premiumBps}`);
  assert.ok(r.premiumBps <= 700);
});

test("premium always within 100..=700 and odds match score", () => {
  for (const dev of [0n, 250n, 500n, 1000n]) {
    const r = assessRisk({ ...base, deployerBalance: dev, holderCount: null, createdAtMs: null }, NOW);
    assert.ok(r.premiumBps >= 100 && r.premiumBps <= 700);
    assert.equal(r.rugOddsPct, Math.round(r.score * 1000) / 10);
  }
});
