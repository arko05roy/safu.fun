# @safu/api

Prices cover (rug odds), snapshots what the watcher must watch, signs cover-only quotes, and routes Intents buys.

```bash
pnpm install
cp services/api/.env.example services/api/.env   # set accounts + quote signing key
pnpm --filter @safu/api test     # risk model tests
pnpm --filter @safu/api start    # http://localhost:8787
```

The API account must be the contract's `api`. The quote-signing key's public half must be registered on the contract with `set_api_pubkey`.

## Endpoints

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
