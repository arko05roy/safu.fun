# Backend (`src/server`)

The whole safu.fun backend runs inside the Next.js app. There is one process and one deploy.

| Part | Path | Runs as |
|---|---|---|
| API | `src/server/api` | Next.js route handler at `/api/*` ([route.ts](../app/api/[[...route]]/route.ts)), a Hono app |
| Rug watcher | `src/server/watcher` | background job: reads deployer/insider balances, `report_rug` on R1/R2, `finalize_rug` after the dispute window, UNO snapshots/refunds, heartbeat |
| Relayer | `src/server/relayer` | background job: drains the payout queue (NEAR-direct, Rail A Intents, Rail B Chain Signatures) |
| Intents buy settlement | `src/server/api/buys.ts` | background job: registers policies when a 1Click swap reaches SUCCESS |

## Background jobs

[`jobs.ts`](jobs.ts) runs each job one pass at a time.

- **Always-on host** (`next start` on Railway, Fly, a VPS, or `next dev` locally): [`src/instrumentation.ts`](../instrumentation.ts) starts the watcher and relayer every `POLL_MS` (default 15s) and buy settlement every 20s, inside the server process. This is the default (`SAFU_JOBS=on`).
- **Serverless host** (Vercel): set `SAFU_JOBS=off` and have a scheduler call `GET /api/cron/watcher`, `/api/cron/relayer` and `/api/cron/buys` with `Authorization: Bearer $CRON_SECRET`. Each call runs one pass and returns a JSON summary. The dispute window is 60s on testnet, so call the watcher at least every minute.

Intents buys are stored in `data/buys.json` (`DATA_DIR`), so give the host a persistent disk. They only matter on mainnet.

## Configuration

All settings are environment variables, listed in [`web/.env.example`](../../.env.example). Next.js loads `web/.env.local` automatically. Private keys fall back to `~/.near-credentials/<network>/<account>.json`, so set `API_PRIVATE_KEY`, `WATCHER_PRIVATE_KEY` and `RELAYER_PRIVATE_KEY` on a server.

The API caches `/config`, `/staking`, `/wall` and `/uno` for a few seconds and keeps serving the last good value if the NEAR RPC rate-limits. Set `NEARBLOCKS_API_KEY` and a paid `NEAR_RPC` for real traffic.

## API

All paths are under `/api`.

| | |
|---|---|
| `GET /health` | |
| `GET /config` | contract config, pool stats, last watcher heartbeat |
| `GET /tokens` | assets 1Click can route (the pay-with and get-paid-in lists) |
| `GET /token/:chain/:addr` | token profile (deployer, insiders, supply, age, holders), rug odds with each factor, on-chain cover state |
| `GET /odds/:chain/:addr` | rug odds + premium only |
| `POST /cover/quote` | **cover-only** buy (any token we can profile, testnet included) |
| `POST /buy/quote` | **Intents** buy: `dry:true` previews, `dry:false` creates the 1Click swap (mainnet, listed tokens) |
| `GET /buy/:depositAddress` | settlement status of an Intents buy |
| `GET /policy/:id`, `/payout/:id`, `/report/:id` | contract records |
| `GET /wall` | Wall of Rugs: every finalized rug report |
| `GET /staking` | $SAFU pot, premium share, burns, token supply |
| `GET /stake/:account` | one underwriter's stake and claimable USDC |
| `GET /uno`, `/uno/:id` | UNO REVERSE launches and refund snapshots |
| `GET /cron/:job` | run one pass of `watcher`, `relayer` or `buys` (needs `CRON_SECRET`) |

### Cover-only flow
1. `POST /cover/quote {token_chain, token_addr, cover_usdc, payout_chain, payout_asset, recipient, payer}`.
2. If the token has no live watch, the API snapshots the deployer and the top 5 non-contract holders at one block and writes them on-chain (`register_token_watch`). The rug rules are later judged against these baselines.
3. The API returns a `CoverQuote` signed with its ed25519 key, plus the exact `ft_transfer_call` the buyer's wallet signs.
4. The contract checks the signature over the exact quote bytes, the payer, that the amount equals the premium, the quote expiry, that the nonce is unused, and that premium = cover × bps / 10 000. Only then does it create the policy and book the premium into the pool. If any check fails, NEP-141 refunds the buyer in full.

### Intents flow (mainnet)
The 1Click quote takes the premium as `appFees` (fee bps = premium bps, paid to `TREASURY_ACCOUNT`). When 1Click reports `SUCCESS`, the API registers the policy for the USD value bought. Pending buys are stored in `data/buys.json`.

## Rug odds

`premium_bps = clamp(100 + risk × 600, 100, 700)`. `risk` is a weighted sum of four factors:

| Factor | Weight |
|---|---|
| deployer share of supply | 0.35 |
| top-holder concentration | 0.30 |
| token age | 0.20 |
| holder count | 0.15 |

This is a transparent pricing heuristic, not a probability model. Every factor is returned with its value.

## Data sources
- **NEAR:** NearBlocks v3 for metadata, holders, the deployer (the `ft_mint` event in the first deployment tx) and creation time. Balances are re-read over RPC at one block height.
- **EVM:** Blockscout v2 for metadata, holders (contracts excluded), creator and creation time. Balances come from `balanceOf` at one block.
  - Mainnet Blockscout instances are behind a bot challenge, so mainnet chains need `BLOCKSCOUT_API_KEY` (Blockscout PRO API, which has a free tier). Testnets work without a key.
- Explorer responses are cached (immutable data permanently) and retried with backoff on HTTP 429.
