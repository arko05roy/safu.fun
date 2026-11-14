# safu.fun

**Buy any memecoin on any chain. If it rugs, you get paid back — on any chain you want.**

Built on NEAR: Intents (1Click) for any-chain swaps and payouts, Chain Signatures for contract-controlled addresses on other chains. See [PRD.md](PRD.md) for the full spec.

## Status

| Component | Path | Status |
|---|---|---|
| Cover contract (pool, policies, rug lifecycle, Intents payouts) | `contracts/safu` | ✅ phase 1 |
| Chain Signatures payouts (Rail B, EVM) | `contracts/safu` | ✅ contract-built tx |
| $SAFU token + staking | `contracts/safu-token` | ⏳ |
| Relayer (Rail A + Rail B) | `services/relayer` | ✅ |
| API / watcher | `services/` | ⏳ |
| Frontend (Next.js) | `web/` | ⏳ |

## Contract

Requirements: Rust (stable), `wasm32-unknown-unknown` target, [`cargo-near`](https://github.com/near/cargo-near), [`near-cli-rs`](https://github.com/near/near-cli-rs).

```bash
cargo test -p safu                       # unit tests
cd contracts/safu && cargo near build non-reproducible-wasm   # -> target/near/safu/safu.wasm
```

### Lifecycle

1. Pool is funded with NEAR USDC via `ft_transfer_call(msg: "fund" | "premium")`.
2. API registers a policy per protected buy (`register_policy`) — premium 1–7%, per-token exposure ≤ 10% of pool.
3. Allowlisted watcher calls `report_rug(token, rule, evidence)` → dispute window.
4. Anyone calls `finalize_rug(report_id)` after the window → payouts queued at 80% of cover (pro-rata if pool is short).
5. **Rail A** — relayer calls `request_payout_intents(payout_id, quote, quote_signature)` with a live **1Click-signed quote**. The contract verifies the signature on-chain (`ed25519_verify` against the 1Click manager key) and that the quote pays this payout's amount/asset/recipient and refunds to the contract, then sends USDC to the deposit address in the quote → swapped to the user's asset on the user's chain → `mark_paid(payout_id, dest_tx_hash)`.
6. **Rail B** — relayer calls `request_payout_signed(payout_id, max_fee_per_gas, max_priority_fee_per_gas)`. The **contract** builds the EIP-1559 `USDC.transfer(recipient, amount)` tx (chain id, token, recipient, amount and nonce are fixed by contract state; gas price is capped), asks `v1.signer` for an Ecdsa signature on path `pool-<chain>`, **ecrecovers it against the pool's derived address**, and stores the raw signed tx + its hash on the payout. Anyone can broadcast it; `mark_paid` only accepts that exact tx hash. Re-signing (gas bump) reuses the same nonce, so a payout can never land twice.

### Testnet deployment

Contract: [`cover.safufun-d73f3d.testnet`](https://testnet.nearblocks.io/address/cover.safufun-d73f3d.testnet) — accounts in [`deployments/testnet.json`](deployments/testnet.json). Keys live in `~/.near-credentials` (never committed).
