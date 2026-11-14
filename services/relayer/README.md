# @safu/relayer

Drains the `safu` contract's payout queue. Stateless — every step can be resumed from the on-chain payout record.

```bash
pnpm install
cp services/relayer/.env.example services/relayer/.env   # set accounts
pnpm --filter @safu/relayer once    # one pass
pnpm --filter @safu/relayer start   # loop (POLL_MS)
```

The relayer key is read from `RELAYER_PRIVATE_KEY` or near-cli's keychain (`~/.near-credentials/<network>/<account>.json`). The account must be allowlisted with `add_relayer`.

## Rails

| Payout state | Rail A — NEAR Intents (mainnet) | Rail B — Chain Signatures (EVM) |
|---|---|---|
| `Queued` | live 1Click quote (pool USDC → `payout_asset`, recipient = buyer) → `request_payout_intents(deposit_address)` → `/v0/deposit/submit` | fetch fees (2×base + tip, clamped to contract cap) → `request_payout_signed` — the **contract** builds + MPC-signs the tx |
| `Sent` / `Signed` | poll `/v0/status` → on `SUCCESS` `mark_paid(destination tx hash)` | broadcast stored `signed_tx` → wait for receipt → `mark_paid(evm_tx_hash)`; on underpriced fees re-sign the **same nonce** |

Rail choice: payouts already bound to a rail stay on it; otherwise Rail A if enabled (`RAIL_A_ENABLED`, default on for mainnet only — Intents has no testnet), else Rail B if the payout chain has a Rail B config and an EVM recipient. `RAIL_PREFERENCE` breaks ties.

## Trust

Rail B: the relayer cannot change recipient, token, amount, chain or nonce, and `mark_paid` only accepts the exact tx hash the contract signed. Worst case it withholds liveness.
Rail A: the relayer picks the 1Click deposit address, so it is trusted to request a quote for the policy's own `payout_asset`/`recipient` (verifiable after the fact via `/v0/status`). Hardening this is on the roadmap.

## Known gaps
- 1Click `REFUNDED`/`FAILED` returns USDC to the contract outside pool accounting — logged for the operator; no automatic recovery yet.
- A reverted Rail B tx (pool address short on USDC) consumes the nonce — logged; needs operator action.
