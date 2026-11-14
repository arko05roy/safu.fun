# safu.fun demo

The PRD §8 demo, run for real on NEAR testnet. It takes about 3–4 minutes, most of it the 60-second dispute window and indexer catch-up.

```bash
# once
pnpm install
(cd contracts/demo-token && cargo near build non-reproducible-wasm)

# terminal 1: api + watcher + relayer (5s polling)
pnpm --filter @safu/demo services

# terminal 2: the demo
pnpm --filter @safu/demo demo
```

## What happens

1. **A dev launches a coin.** A fresh faucet-funded dev wallet deploys and initializes a NEP-141 memecoin in one transaction (1B supply to the dev), then sends 20% to an insider wallet.
2. **Rug odds.** The API profiles the coin (dev share, insider concentration, age, holders) and prices the premium.
3. **The buyer buys cover twice.** Both purchases are paid in USDC with API-signed quotes:
   - payout on **NEAR** to the buyer's own account;
   - payout on **Base Sepolia** to `DEMO_RECIPIENT_ADDRESS` (from `scripts/demo/.env`).

   Buying the first quote records the dev and insider balances on-chain for the watcher.
4. **The dev dumps** 75% of their bag.
5. **The watcher** reports rule R1, with the dump transaction hashes as evidence. After the dispute window it finalizes the report, which queues the payouts.
6. **The relayer pays out:**
   - the NEAR leg goes straight from the pool to the buyer (the USDC lands);
   - the Base Sepolia leg is built by the contract and signed by NEAR Chain Signatures (MPC). The signed tx is stored on-chain, ready to broadcast once the pool address has gas.

## Config

| env | default |
|---|---|
| `SAFU_CONTRACT` | `cover.safufun-d73f3d.testnet` |
| `API_URL` | `http://localhost:8787` |
| `DEMO_BUYER` | `buyer.safudemo-81cf1a.testnet`. Must hold testnet USDC, and its key must be in `~/.near-credentials/testnet/`. |
| `DEMO_RECIPIENT_ADDRESS` | EVM address for the Base Sepolia leg. Leave unset to skip that leg. |
| `DEMO_DEV` | reuse an existing dev account instead of creating one from the faucet |

The keys of new accounts are saved in near-cli's keychain (`~/.near-credentials/testnet/`).

## A real run (testnet, 2026-11-14)

```
[  0s] 1. a fresh dev launches a memecoin
[ 10s]    $PEPERUG deployed at coin-1d3483.rugdev-9a21e0.testnet — 1B supply minted to the dev
[ 22s]    dev keeps 80%, insider wallet gets 20%
[ 42s] 2. RUG ODDS 82% → cover premium 5.92%
[ 52s] 3. policy #10: 0.7348 USDC cover → paid on NEAR to buyer.safudemo-81cf1a.testnet
[ 66s]    policy #11: 0.4676 USDC cover → paid on Base Sepolia to 0x7A69…8d0d
[ 95s] 4. dev dumped 600M of 800M (75%)
[101s] 5. RUGGED — rule R1 · report #6 · evidence: the 2 dump txs + balance 800M→200M
[162s]    finalized → 2 payouts queued (cover × 80%)
[175s] 6. 🔄 $0.5879 SENT on NEAR → buyer.safudemo-81cf1a.testnet
[188s]    🔄 $0.3741 payout on base-sepolia signed by NEAR Chain Signatures (MPC), tx 0x3cb5…c145
       buyer USDC on NEAR: 21.7477 → 22.2644
```

## Operational notes
- Public NEAR RPCs rate-limit, so every service and the demo rotate across several endpoints (`NEAR_RPCS`; the default is FastNEAR + dRPC).
- The free NearBlocks tier rate-limits too. The API caches its responses and returns a retryable `503` while a brand-new coin isn't fully indexed yet. It checks the indexer's dev balance against chain state, so a stale holder list can't produce a wrong insider snapshot.
- The testnet faucet rate-limits new accounts. Set `DEMO_DEV` to reuse an earlier dev wallet; each run uses fresh `coin-<tag>` subaccounts.

## UNO REVERSE demo (`pnpm --filter @safu/demo uno`)

A real run (testnet, 2026-11-14, 165s, unattended):

```
[ 15s] UNO REVERSE launch #0 — custody: cover.safufun-d73f3d.testnet
[ 20s] dev allocation 500M locked in the contract — unlocks 10% every 20s
[ 49s] pool seeded with 400M $TRUSTME + 1 USDC — owned by the contract
[ 52s] rug odds 42% — but UNO REVERSE launch #0 → cover premium 1.00%
[ 61s] buyer covered 0.6963 USDC for 0.0070 USDC premium (policy #14)
[ 68s] buyer bought 133.33M $TRUSTME for 0.5 USDC · fan bought 44.44M for 0.3 USDC
[ 87s] dev dumped 200M $TRUSTME into the pool for 0.8526 USDC
[ 90s] RUGGED — rule R1 · report #8
[151s] 🔄 UNO REVERSE'd — pool frozen, 0.9474 USDC → refund pot
[151s] 🔥 822.22M $TRUSTME burned — supply 1,000M → 177.78M
[165s] refund → buyer 0.7105 USDC · fan 0.2368 USDC · + cover payout 0.5570 USDC
```

**Known limit:** the reverse claws back what's still in the pool. A dev who sells their *unlocked* tranches before the watcher fires gets that USDC out first; in this run it was 0.85 USDC. The tranche schedule is what bounds this.
