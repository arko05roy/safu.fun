# @safu/watcher

Watches every token with live cover and reports rugs to the `safu` contract. Stateless: the work list, baselines and report state all live on-chain.

```bash
pnpm install
cp services/watcher/.env.example services/watcher/.env
pnpm --filter @safu/watcher test    # rule unit tests
pnpm --filter @safu/watcher once    # one pass
pnpm --filter @safu/watcher start   # loop (POLL_MS)
```

The watcher account must be allowlisted with `add_watcher`. Its key comes from `WATCHER_PRIVATE_KEY` or near-cli's keychain.

## Loop

For each token in `list_watched`:

- **No open report:** read the deployer's and insiders' balances on the token's chain and evaluate the rules against the **on-chain baselines** in the token's `TokenWatch`. The API writes that record once, before selling cover, and it can't be changed while cover is live.
  - **R1:** the deployer has moved out at least 50% of its baseline.
  - **R2:** the insiders together have moved out at least 50% of their combined baseline. Transfers between insiders cancel out.
- **On a hit:** call `report_rug(chain, token, rule, evidence)`. The evidence is the outgoing transfer tx hashes plus the balance reading (`<chain>:balance:<holder>:<baseline>-><current>@<block>`).
- **Open report:** once the dispute window has closed, call `finalize_rug`, which queues payouts for the relayer.
- **Every `HEARTBEAT_MS`:** call `heartbeat()`. The UI shows this as "watcher heartbeat".

## Chains

| `token_chain` | Balances | Evidence |
|---|---|---|
| `near` | RPC `ft_balance_of` | NearBlocks v3 `/v3/accounts/{holder}/ft-txns` |
| EVM (`base-sepolia`, `sepolia`, `base`, `eth`, or any `EVM_RPC_<CHAIN>`) | `balanceOf` | `Transfer(from=holder)` logs, scanned backwards in `EVM_LOG_CHUNK`-block windows |

Base Sepolia uses publicnode by default, because `sepolia.base.org` caps `eth_getLogs` at 200 blocks.

## Limits (MVP)
- Detection uses balances. A deployer who receives new tokens and then dumps them may stay above the threshold.
- R3 (LP liquidity drop) is not implemented.
- One allowlisted watcher key plus a dispute window. The roadmap is several independent watchers with a quorum.
