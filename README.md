# safu.fun

**Buy any memecoin on any chain. If it rugs, you get paid back — on any chain you want.**

Built on NEAR: Intents (1Click) for any-chain swaps and payouts, Chain Signatures for contract-controlled addresses on other chains. See [PRD.md](PRD.md) for the full spec.

## Status

| Component | Path | Status |
|---|---|---|
| Cover contract (pool, policies, rug lifecycle, Intents payouts) | `contracts/safu` | ✅ phase 1 |
| Chain Signatures payouts (Rail B) | `contracts/safu` | ⏳ |
| $SAFU token + staking | `contracts/safu-token` | ⏳ |
| API / watcher / relayer | `services/` | ⏳ |
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
5. Relayer calls `request_payout_intents(payout_id, deposit_address)` with a 1Click deposit address → USDC sent → swapped to the user's asset on the user's chain → `mark_paid(payout_id, dest_tx_hash)`.
