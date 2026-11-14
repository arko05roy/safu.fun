# safu.fun

**Buy any memecoin on any chain. If it rugs, you get paid back — on any chain you want.**

Built on NEAR: Intents (1Click) for any-chain swaps and payouts, Chain Signatures for contract-controlled addresses on other chains. See [PRD.md](PRD.md) for the full spec.

## Status

| Component | Path | Status |
|---|---|---|
| Cover contract (pool, policies, rug lifecycle, Intents payouts) | `contracts/safu` | ✅ phase 1 |
| Chain Signatures payouts (Rail B, EVM) | `contracts/safu` | ✅ contract-built tx |
| $SAFU token (NEP-141 + burn) | `contracts/safu-token` | ✅ |
| $SAFU staking: premium share + rug burns | `contracts/safu` | ✅ |
| Relayer (Rail A + Rail B) | `services/relayer` | ✅ |
| Rug watcher (R1/R2, NEAR + EVM, UNO snapshots/refunds) | `services/watcher` | ✅ |
| UNO REVERSE launches (NEAR) | `contracts/safu` | ✅ |
| Demo NEP-141 memecoin | `contracts/demo-token` | ✅ |
| End-to-end demo (PRD §8) | `scripts/demo` | ✅ ~3 min on testnet |
| NEAR-direct payouts | `contracts/safu` | ✅ |
| API (rug odds, watch snapshots, signed cover quotes, Intents buys) | `services/api` | ✅ |
| Frontend (Next.js) | `web/` | ⏳ |

## Run the demo

```bash
pnpm install
(cd contracts/demo-token && cargo near build non-reproducible-wasm)
pnpm --filter @safu/demo services   # terminal 1
pnpm --filter @safu/demo demo       # terminal 2: cover → rug → payout
pnpm --filter @safu/demo uno        # terminal 2: UNO REVERSE launch → rug → reverse
```

See [scripts/demo/README.md](scripts/demo/README.md).

## Contract

Requirements: Rust (stable), `wasm32-unknown-unknown` target, [`cargo-near`](https://github.com/near/cargo-near), [`near-cli-rs`](https://github.com/near/near-cli-rs).

```bash
cargo test -p safu                       # unit tests
cd contracts/safu && cargo near build non-reproducible-wasm   # -> target/near/safu/safu.wasm
```

### Lifecycle

1. Pool is funded with NEAR USDC via `ft_transfer_call(msg: "fund" | "premium")`.
2. Cover is sold two ways — **Intents buy** (mainnet, 1Click-listed coins: premium taken via `appFees`, API registers the policy on swap SUCCESS) or **cover-only** (any coin: buyer pays the premium in USDC with `ft_transfer_call` carrying an API-signed quote, which the contract verifies before creating the policy). Premium 1–7% from rug odds; per-token exposure ≤ 10% of pool.
3. Before cover is sold, the API records a **token watch** on-chain (deployer + insiders with baseline balances, locked while cover is live). The allowlisted watcher re-reads those balances, and on R1/R2 calls `report_rug(token, rule, evidence)` with the dump tx hashes → dispute window.
4. Anyone calls `finalize_rug(report_id)` after the window → payouts queued at 80% of cover (pro-rata if pool is short).
5. **Rail A** — relayer calls `request_payout_intents(payout_id, quote, quote_signature)` with a live **1Click-signed quote**. The contract verifies the signature on-chain (`ed25519_verify` against the 1Click manager key) and that the quote pays this payout's amount/asset/recipient and refunds to the contract, then sends USDC to the deposit address in the quote → swapped to the user's asset on the user's chain → `mark_paid(payout_id, dest_tx_hash)`.
6. **NEAR-direct** — payouts on NEAR in pool USDC: anyone calls `request_payout_near(payout_id)` and the contract sends USDC straight to the recipient.
7. **$SAFU underwriters** — stake with `ft_transfer_call(msg: "stake")` to earn 50% of every premium in USDC (`claim_rewards`). When a rug is finalized the staked pot is **burned** by the pool's loss ratio (payout ÷ pool capital, ≤50% per rug) via `ft_burn` — stakers eat the rugs, and $SAFU supply shrinks. Unstaking unbonds for longer than the dispute window and stays slashable while unbonding.
8. **UNO REVERSE** — a dev opts in with `create_uno_launch`, locks their allocation (unlocks in tranches) and seeds a constant-product pool **owned by the contract** — nobody, the dev included, can pull it. UNO coins get ~1% cover. When a rug on the coin is finalized, the launch is reversed: pool frozen, its USDC becomes a refund pot, the dev's locked remainder and the pool's coin are burned (`ft_burn`), the watcher posts the holder snapshot on-chain (dev/insiders excluded) and pro-rata USDC refunds are pushed to every holder. On NEAR the contract is the custodian; on other chains the same role is the Chain Signatures address for path `uno-<id>`.
9. **Rail B** — relayer calls `request_payout_signed(payout_id, max_fee_per_gas, max_priority_fee_per_gas)`. The **contract** builds the EIP-1559 `USDC.transfer(recipient, amount)` tx (chain id, token, recipient, amount and nonce are fixed by contract state; gas price is capped), asks `v1.signer` for an Ecdsa signature on path `pool-<chain>`, **ecrecovers it against the pool's derived address**, and stores the raw signed tx + its hash on the payout. Anyone can broadcast it; `mark_paid` only accepts that exact tx hash. Re-signing (gas bump) reuses the same nonce, so a payout can never land twice.

### Testnet deployment

Contract: [`cover.safufun-d73f3d.testnet`](https://testnet.nearblocks.io/address/cover.safufun-d73f3d.testnet) — accounts in [`deployments/testnet.json`](deployments/testnet.json). Keys live in `~/.near-credentials` (never committed).
