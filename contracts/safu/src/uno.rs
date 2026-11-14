//! UNO REVERSE launches (PRD §5.5) — "when the dev rugs, the liquidity rugs the dev."
//!
//! A dev who opts in hands custody of the coin's liquidity and their own
//! allocation to this contract. Nobody — the dev included — can withdraw the
//! pool, and the dev allocation unlocks only in tranches.
//!
//! * `create_uno_launch` registers the coin (contract registers itself on it).
//! * Dev locks their allocation: token `ft_transfer_call` msg `{"uno_lock":id}`.
//! * Dev seeds liquidity with coin + USDC: msg `{"uno_seed":id}` on either token.
//! * Anyone trades against the contract-owned constant-product pool:
//!   USDC msg `{"uno_buy":{"id":..,"min_out":".."}}`, coin msg `{"uno_sell":{..}}`.
//! * `claim_unlock` releases vested tranches to the dev.
//! * When a rug on the coin is finalized, `uno_reverse` freezes the pool, turns
//!   its USDC into a refund pot, and burns the dev's locked remainder plus the
//!   pool's coin. The watcher posts the holder snapshot (on-chain, in full),
//!   and anyone triggers pro-rata USDC refunds with `distribute_uno_refunds`.
//!
//! On NEAR the contract itself is the custodian. On other chains the same role
//! is played by the Chain Signatures address derived for path `uno-<id>`.

use crate::math::mul_div;
use crate::*;
use near_sdk::serde_json::{self, Value};

pub const MAX_SNAPSHOT_HOLDERS: usize = 100;
const GAS_TOKEN_CALL: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum UnoStatus {
    Active,
    Reversed { report_id: u64 },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct UnoLaunch {
    pub id: u64,
    pub token: AccountId,
    pub dev: AccountId,
    /// Dev allocation locked in the contract and when it was locked.
    pub dev_alloc: U128,
    pub dev_claimed: U128,
    pub locked_at_ms: u64,
    /// Unlock schedule: `tranche_bps` of the allocation per `period_ms`.
    pub tranche_bps: u16,
    pub period_ms: u64,
    /// Contract-owned liquidity.
    pub pool_token: U128,
    pub pool_usdc: U128,
    pub status: UnoStatus,
    /// After reverse: USDC owed to holders, coin destroyed.
    pub refund_pot_usdc: U128,
    pub burned_token: U128,
    pub snapshot_total: U128,
    pub refunds_paid_usdc: U128,
    pub created_at_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct UnoHolder {
    pub account_id: AccountId,
    pub amount: U128,
    pub paid: bool,
}

#[ext_contract(ext_coin)]
#[allow(dead_code)]
trait Coin {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
    fn ft_burn(&mut self, amount: U128, memo: Option<String>);
}

impl Safu {
    fn launch_mut(&mut self, id: u64) -> &mut UnoLaunch {
        self.uno_launches.get_mut(&id).unwrap_or_else(|| env::panic_str("no such UNO launch"))
    }

    fn vested(l: &UnoLaunch, now_ms: u64) -> u128 {
        if l.locked_at_ms == 0 || l.period_ms == 0 {
            return 0;
        }
        let periods = (now_ms.saturating_sub(l.locked_at_ms) / l.period_ms) as u128;
        let bps = (periods * l.tranche_bps as u128).min(BPS);
        mul_div(l.dev_alloc.0, bps, BPS)
    }

    /// Send `amount` of `token` to `to`, registering storage first (contract pays).
    fn send_ft(token: &AccountId, to: &AccountId, amount: u128, memo: String) -> Promise {
        ext_coin::ext(token.clone())
            .with_attached_deposit(USDC_STORAGE_DEPOSIT)
            .with_static_gas(GAS_STORAGE_DEPOSIT)
            .storage_deposit(Some(to.clone()), Some(true))
            .then(
                ext_coin::ext(token.clone())
                    .with_attached_deposit(NearToken::from_yoctonear(1))
                    .with_static_gas(GAS_FT_TRANSFER)
                    .ft_transfer(to.clone(), U128(amount), Some(memo)),
            )
    }

    /// `ft_on_transfer` for USDC carrying an UNO message. Returns unused amount.
    pub(crate) fn uno_on_usdc(&mut self, sender: AccountId, amount: u128, msg: &Value) -> u128 {
        if let Some(id) = msg.get("uno_seed").and_then(Value::as_u64) {
            let l = self.launch_mut(id);
            require!(l.status == UnoStatus::Active, "launch reversed");
            require!(sender == l.dev, "only the dev seeds liquidity");
            l.pool_usdc = U128(l.pool_usdc.0 + amount);
            emit("uno_seeded", json!({ "id": id, "usdc": U128(amount) }));
            return 0;
        }
        if let Some(b) = msg.get("uno_buy") {
            let id = b["id"].as_u64().expect("uno_buy.id");
            let min_out: u128 = b["min_out"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0);
            let l = self.launch_mut(id);
            require!(l.status == UnoStatus::Active, "launch reversed — pool frozen");
            require!(l.pool_token.0 > 0 && l.pool_usdc.0 > 0, "pool not seeded");
            let out = mul_div(l.pool_token.0, amount, l.pool_usdc.0 + amount);
            require!(out > 0 && out >= min_out, "slippage: output below min_out");
            l.pool_usdc = U128(l.pool_usdc.0 + amount);
            l.pool_token = U128(l.pool_token.0 - out);
            let token = l.token.clone();
            emit("uno_buy", json!({ "id": id, "buyer": sender, "usdc_in": U128(amount), "token_out": U128(out) }));
            Self::send_ft(&token, &sender, out, format!("UNO launch {id} buy"))
                .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_uno_buy(id, sender, U128(amount), U128(out)))
                .detach();
            return 0;
        }
        env::panic_str("unknown USDC message")
    }

    /// `ft_on_transfer` for a launch's coin. Returns unused amount.
    pub(crate) fn uno_on_coin(&mut self, token: AccountId, sender: AccountId, amount: u128, msg: &str) -> u128 {
        let v: Value = serde_json::from_str(msg).unwrap_or_else(|_| env::panic_str("bad UNO message"));
        let now = env::block_timestamp_ms();
        if let Some(id) = v.get("uno_lock").and_then(Value::as_u64) {
            let l = self.launch_mut(id);
            require!(l.token == token, "wrong token for launch");
            require!(l.status == UnoStatus::Active, "launch reversed");
            require!(sender == l.dev, "only the dev locks their allocation");
            require!(l.locked_at_ms == 0, "allocation already locked");
            l.dev_alloc = U128(amount);
            l.locked_at_ms = now;
            emit("uno_locked", json!({ "id": id, "dev_alloc": U128(amount), "tranche_bps": l.tranche_bps, "period_ms": l.period_ms }));
            return 0;
        }
        if let Some(id) = v.get("uno_seed").and_then(Value::as_u64) {
            let l = self.launch_mut(id);
            require!(l.token == token, "wrong token for launch");
            require!(l.status == UnoStatus::Active, "launch reversed");
            require!(sender == l.dev, "only the dev seeds liquidity");
            l.pool_token = U128(l.pool_token.0 + amount);
            emit("uno_seeded", json!({ "id": id, "token": U128(amount) }));
            return 0;
        }
        if let Some(s) = v.get("uno_sell") {
            let id = s["id"].as_u64().expect("uno_sell.id");
            let min_out: u128 = s["min_out"].as_str().and_then(|x| x.parse().ok()).unwrap_or(0);
            let usdc = self.usdc.clone();
            let l = self.launch_mut(id);
            require!(l.token == token, "wrong token for launch");
            require!(l.status == UnoStatus::Active, "launch reversed — pool frozen");
            require!(l.pool_token.0 > 0 && l.pool_usdc.0 > 0, "pool not seeded");
            let out = mul_div(l.pool_usdc.0, amount, l.pool_token.0 + amount);
            require!(out > 0 && out >= min_out, "slippage: output below min_out");
            l.pool_token = U128(l.pool_token.0 + amount);
            l.pool_usdc = U128(l.pool_usdc.0 - out);
            emit("uno_sell", json!({ "id": id, "seller": sender, "token_in": U128(amount), "usdc_out": U128(out) }));
            Self::send_ft(&usdc, &sender, out, format!("UNO launch {id} sell"))
                .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_uno_sell(id, sender, U128(amount), U128(out)))
                .detach();
            return 0;
        }
        env::panic_str("unknown UNO message")
    }

    /// Called from `finalize_rug`: the liquidity rugs the dev.
    pub(crate) fn uno_reverse(&mut self, token: &str, report_id: u64) {
        let Ok(token_id) = token.parse::<AccountId>() else { return };
        let Some(id) = self.uno_by_token.get(&token_id).copied() else { return };
        let l = self.launch_mut(id);
        if l.status != UnoStatus::Active {
            return;
        }
        let locked_left = l.dev_alloc.0 - l.dev_claimed.0;
        let burn = locked_left + l.pool_token.0;
        l.status = UnoStatus::Reversed { report_id };
        l.refund_pot_usdc = l.pool_usdc;
        l.pool_usdc = U128(0);
        l.pool_token = U128(0);
        l.dev_claimed = l.dev_alloc; // nothing more ever unlocks
        l.burned_token = U128(burn);
        let pot = l.refund_pot_usdc;
        emit(
            "uno_reversed",
            json!({ "id": id, "report_id": report_id, "token": token_id, "refund_pot_usdc": pot, "burned_token": U128(burn), "dev": l.dev }),
        );
        if burn > 0 {
            // Destroy the dev's locked bag and the pool's coin. Coins without
            // `ft_burn` simply stay sealed in this contract forever.
            ext_coin::ext(token_id)
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(GAS_TOKEN_CALL)
                .ft_burn(U128(burn), Some(format!("UNO REVERSE'd: rug report {report_id}")))
                .detach();
        }
    }
}

#[near]
impl Safu {
    /// Dev opts a coin into UNO REVERSE. The contract registers itself on the
    /// coin so it can receive the allocation and liquidity.
    pub fn create_uno_launch(&mut self, token: AccountId, tranche_bps: u16, period_ms: u64) -> Promise {
        require!(!self.uno_by_token.contains_key(&token), "token already has an UNO launch");
        require!(tranche_bps > 0 && (tranche_bps as u128) <= BPS, "bad tranche");
        require!(period_ms > 0, "bad period");
        let dev = env::predecessor_account_id();
        let id = self.next_uno_id;
        self.next_uno_id += 1;
        let launch = UnoLaunch {
            id,
            token: token.clone(),
            dev: dev.clone(),
            dev_alloc: U128(0),
            dev_claimed: U128(0),
            locked_at_ms: 0,
            tranche_bps,
            period_ms,
            pool_token: U128(0),
            pool_usdc: U128(0),
            status: UnoStatus::Active,
            refund_pot_usdc: U128(0),
            burned_token: U128(0),
            snapshot_total: U128(0),
            refunds_paid_usdc: U128(0),
            created_at_ms: env::block_timestamp_ms(),
        };
        emit("uno_launch_created", json!(launch));
        self.uno_launches.insert(id, launch);
        self.uno_by_token.insert(token.clone(), id);
        ext_coin::ext(token)
            .with_attached_deposit(USDC_STORAGE_DEPOSIT)
            .with_static_gas(GAS_STORAGE_DEPOSIT)
            .storage_deposit(Some(env::current_account_id()), Some(true))
    }

    /// Dev claims vested tranches of their locked allocation.
    pub fn claim_unlock(&mut self, launch_id: u64) -> Promise {
        let now = env::block_timestamp_ms();
        let l = self.launch_mut(launch_id);
        require!(env::predecessor_account_id() == l.dev, "dev only");
        require!(l.status == UnoStatus::Active, "launch reversed — allocation burned");
        let vested = Self::vested(l, now);
        let amount = vested - l.dev_claimed.0;
        require!(amount > 0, "nothing unlocked yet");
        l.dev_claimed = U128(vested);
        let (token, dev) = (l.token.clone(), l.dev.clone());
        emit("uno_unlock_claimed", json!({ "id": launch_id, "amount": U128(amount) }));
        ext_coin::ext(token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(dev, U128(amount), Some(format!("UNO launch {launch_id} unlock")))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_uno_unlock(launch_id, U128(amount)))
    }

    /// Watcher posts who held the coin at the rug (dev, insiders and this
    /// contract excluded). Stored in full so anyone can audit the refunds.
    pub fn set_uno_snapshot(&mut self, launch_id: u64, holders: Vec<(AccountId, U128)>) {
        require!(self.watchers.contains(&env::predecessor_account_id()), "watcher only");
        require!(holders.len() <= MAX_SNAPSHOT_HOLDERS, "too many holders");
        require!(!self.uno_snapshots.contains_key(&launch_id), "snapshot already set");
        let me = env::current_account_id();
        let (dev, token, report_id) = {
            let l = self.uno_launches.get(&launch_id).expect("no such UNO launch");
            let UnoStatus::Reversed { report_id } = l.status else { env::panic_str("launch not reversed") };
            (l.dev.clone(), l.token.clone(), report_id)
        };
        let key = token_key("near", token.as_str());
        let excluded: Vec<String> = self
            .watches
            .get(&key)
            .map(|w| w.insiders.iter().map(|h| h.address.clone()).collect())
            .unwrap_or_default();
        let mut total = 0u128;
        let mut list = Vec::with_capacity(holders.len());
        for (a, amt) in holders {
            require!(a != dev && a != me && !excluded.contains(&a.to_string()), "dev, insiders and the pool can't be refunded");
            require!(amt.0 > 0, "zero holder");
            total += amt.0;
            list.push(UnoHolder { account_id: a, amount: amt, paid: false });
        }
        require!(total > 0, "empty snapshot");
        self.launch_mut(launch_id).snapshot_total = U128(total);
        emit("uno_snapshot", json!({ "id": launch_id, "report_id": report_id, "holders": list.len(), "total": U128(total) }));
        self.uno_snapshots.insert(launch_id, list);
    }

    /// Anyone: pay pro-rata USDC refunds to up to `limit` unpaid holders.
    pub fn distribute_uno_refunds(&mut self, launch_id: u64, limit: Option<u32>) -> u32 {
        let usdc = self.usdc.clone();
        let (pot, total) = {
            let l = self.uno_launches.get(&launch_id).expect("no such UNO launch");
            (l.refund_pot_usdc.0, l.snapshot_total.0)
        };
        require!(total > 0, "no snapshot yet");
        let mut holders = self.uno_snapshots.get(&launch_id).cloned().expect("no snapshot");
        let mut sent = 0u32;
        let mut paid_now = 0u128;
        for (idx, h) in holders.iter_mut().enumerate() {
            if sent >= limit.unwrap_or(10) {
                break;
            }
            if h.paid {
                continue;
            }
            let share = mul_div(pot, h.amount.0, total);
            h.paid = true;
            sent += 1;
            if share == 0 {
                continue;
            }
            paid_now += share;
            Self::send_ft(&usdc, &h.account_id, share, format!("UNO REVERSE refund, launch {launch_id}"))
                .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_uno_refund(launch_id, idx as u32, U128(share)))
                .detach();
            emit("uno_refund", json!({ "id": launch_id, "account_id": h.account_id, "usdc": U128(share) }));
        }
        self.uno_snapshots.insert(launch_id, holders);
        let l = self.launch_mut(launch_id);
        l.refunds_paid_usdc = U128(l.refunds_paid_usdc.0 + paid_now);
        sent
    }

    // ───── callbacks: undo on failed transfers ─────

    #[private]
    pub fn on_uno_buy(&mut self, id: u64, buyer: AccountId, usdc_in: U128, token_out: U128) -> bool {
        if env::promise_result_checked(0, 0).is_ok() {
            return true;
        }
        let usdc = self.usdc.clone();
        let l = self.launch_mut(id);
        l.pool_usdc = U128(l.pool_usdc.0 - usdc_in.0);
        l.pool_token = U128(l.pool_token.0 + token_out.0);
        Self::send_ft(&usdc, &buyer, usdc_in.0, format!("UNO launch {id} buy failed: refund")).detach();
        false
    }

    #[private]
    pub fn on_uno_sell(&mut self, id: u64, seller: AccountId, token_in: U128, usdc_out: U128) -> bool {
        if env::promise_result_checked(0, 0).is_ok() {
            return true;
        }
        let l = self.launch_mut(id);
        l.pool_token = U128(l.pool_token.0 - token_in.0);
        l.pool_usdc = U128(l.pool_usdc.0 + usdc_out.0);
        let token = l.token.clone();
        Self::send_ft(&token, &seller, token_in.0, format!("UNO launch {id} sell failed: refund")).detach();
        false
    }

    #[private]
    pub fn on_uno_unlock(&mut self, id: u64, amount: U128) -> bool {
        if env::promise_result_checked(0, 0).is_ok() {
            return true;
        }
        let l = self.launch_mut(id);
        if l.status == UnoStatus::Active {
            l.dev_claimed = U128(l.dev_claimed.0 - amount.0);
        }
        false
    }

    #[private]
    pub fn on_uno_refund(&mut self, id: u64, idx: u32, amount: U128) -> bool {
        if env::promise_result_checked(0, 0).is_ok() {
            return true;
        }
        if let Some(mut hs) = self.uno_snapshots.get(&id).cloned() {
            if let Some(h) = hs.get_mut(idx as usize) {
                h.paid = false; // retried by the next distribute_uno_refunds
            }
            self.uno_snapshots.insert(id, hs);
        }
        let l = self.launch_mut(id);
        l.refunds_paid_usdc = U128(l.refunds_paid_usdc.0 - amount.0);
        false
    }

    // ───── views ─────

    pub fn get_uno_launch(&self, launch_id: u64) -> Option<UnoLaunch> {
        self.uno_launches.get(&launch_id).cloned()
    }

    pub fn get_uno_by_token(&self, token: AccountId) -> Option<UnoLaunch> {
        self.uno_by_token.get(&token).and_then(|id| self.uno_launches.get(id)).cloned()
    }

    pub fn get_uno_snapshot(&self, launch_id: u64) -> Vec<UnoHolder> {
        self.uno_snapshots.get(&launch_id).cloned().unwrap_or_default()
    }

    /// Unlocked-but-unclaimed dev allocation right now.
    pub fn uno_claimable(&self, launch_id: u64) -> U128 {
        let l = self.uno_launches.get(&launch_id).expect("no such UNO launch");
        if l.status != UnoStatus::Active {
            return U128(0);
        }
        U128(Self::vested(l, env::block_timestamp_ms()) - l.dev_claimed.0)
    }

    /// Pool quote: coin out for `usdc_in`, or USDC out for `token_in`.
    pub fn uno_quote(&self, launch_id: u64, usdc_in: Option<U128>, token_in: Option<U128>) -> U128 {
        let l = self.uno_launches.get(&launch_id).expect("no such UNO launch");
        if l.pool_token.0 == 0 || l.pool_usdc.0 == 0 {
            return U128(0);
        }
        match (usdc_in, token_in) {
            (Some(u), None) => U128(mul_div(l.pool_token.0, u.0, l.pool_usdc.0 + u.0)),
            (None, Some(t)) => U128(mul_div(l.pool_usdc.0, t.0, l.pool_token.0 + t.0)),
            _ => env::panic_str("pass exactly one of usdc_in / token_in"),
        }
    }

    pub fn uno_launch_count(&self) -> u64 {
        self.next_uno_id
    }
}
