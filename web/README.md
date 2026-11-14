# @safu/web

safu.fun, frontend and backend in one Next.js app (App Router, TypeScript, Tailwind v4, Motion, Lenis, React Three Fiber). The backend (API, rug watcher, relayer) lives in [`src/server`](src/server/README.md): the API is served at `/api/*` and the watcher and relayer run as background jobs in the same server. Users sign with a NEAR wallet through wallet-selector (MyNearWallet).

```bash
pnpm install
cp web/.env.example web/.env.local   # accounts, quote signing key, optional API keys
pnpm --filter @safu/web dev          # site + /api + watcher + relayer on http://localhost:3000
pnpm --filter @safu/web test         # risk model + rug rule unit tests
```

| Route | What it does |
|---|---|
| `/` | Landing: 3D voxel flame field, live pool stats, pinned "how it works", interactive rug-odds model, UNO REVERSE flip card, Wall of Rugs preview |
| `/buy` | Paste any coin → profile + rug odds + watched wallets → signed cover quote → pay the premium with one `ft_transfer_call` |
| `/cover/[id]` | Policy state machine (ACTIVE → REPORTED → FINALIZED → PAID), countdown, rug evidence, payout, and a full-screen payout takeover |
| `/underwrite` | Pool and $SAFU stats, burn grid, stake / claim / unstake / withdraw |
| `/launch` | UNO REVERSE dev console (create → lock → seed coin → seed USDC). Progress is read from the contract. Plus every launch and its refund snapshot |
| `/wall` | Every finalized rug, with dev wallet, dump %, evidence txs and the amount paid back |

Brand assets from `brand-assets/` are served from `public/brand/` (`pixel-flames.png`, `dither-grid.png`).

| Env | Default |
|---|---|
| `NEXT_PUBLIC_SAFU_API` | `/api` (same origin) |
| `NEXT_PUBLIC_NEAR_NETWORK` | `testnet` |
| `NEXT_PUBLIC_SAFU_CONTRACT` | `cover.safufun-d73f3d.testnet` |

## Deploying

- **Always-on host** (Railway, Fly, a VPS): `pnpm --filter @safu/web build && pnpm --filter @safu/web start`. Jobs run in-process. Attach a disk for `data/`.
- **Vercel**: set `SAFU_JOBS=off` and `CRON_SECRET`, and schedule `GET /api/cron/watcher`, `/api/cron/relayer` and `/api/cron/buys`. Vercel Cron's frequency depends on your plan; the watcher needs at least one pass a minute on testnet.

Backend env vars (accounts, private keys, API keys) are in [.env.example](.env.example); see [src/server/README.md](src/server/README.md).
