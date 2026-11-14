//! safu.fun — rug cover on NEAR.
//!
//! This crate (phase 1) implements:
//! - USDC (NEP-141) underwriting pool, funded via `ft_transfer_call`
//! - policy registration by the safu API (one policy per protected buy)
//! - rug lifecycle: watcher `report_rug` -> dispute window -> `finalize_rug`
//! - payout queue + Rail A (USDC -> 1Click deposit address -> any chain)
//!
//! Rail B (Chain Signatures signed payouts), $SAFU staking and UNO REVERSE
//! launches land in later phases.

mod events;
mod types;

#[cfg(test)]
mod tests;

pub use types::*;

use events::emit;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{
    env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
const GAS_CALLBACK: Gas = Gas::from_tgas(10);
/// NEP-145 registration cost for the NEAR USDC contract (0.00125 NEAR).
const USDC_STORAGE_DEPOSIT: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Safu {
    owner: AccountId,
    /// NEP-141 USDC contract the pool is denominated in.
    usdc: AccountId,
    /// safu API account allowed to register policies.
    api: AccountId,
    watchers: IterableSet<AccountId>,
    relayers: IterableSet<AccountId>,

    dispute_window_ms: u64,
    waiting_period_ms: u64,
    deductible_bps: u16,
    max_token_exposure_bps: u16,

    pool_available: u128,
    pool_reserved: u128,
    premiums_earned: u128,
    total_paid_out: u128,

    policies: LookupMap<u64, Policy>,
    next_policy_id: u64,
    /// token_key -> ids of policies not yet resolved (Active).
    token_policies: LookupMap<String, Vec<u64>>,
    /// token_key -> sum of cover_usdc of Active policies.
    token_exposure: LookupMap<String, u128>,
    /// token_key -> report id that finalized it as rugged.
    rugged: LookupMap<String, u64>,

    reports: LookupMap<u64, Report>,
    next_report_id: u64,
    /// token_key -> report id currently Pending/Disputed.
    open_report: LookupMap<String, u64>,

    payouts: LookupMap<u64, Payout>,
    next_payout_id: u64,
    /// Payouts in Queued/Processing/Sent state (relayer work list).
    pending_payouts: IterableSet<u64>,
}

#[near]
impl Safu {
    #[init]
    pub fn new(
        owner: AccountId,
        usdc: AccountId,
        api: AccountId,
        dispute_window_ms: u64,
        waiting_period_ms: u64,
    ) -> Self {
        Self {
            owner,
            usdc,
            api,
            watchers: IterableSet::new(b"w"),
            relayers: IterableSet::new(b"r"),
            dispute_window_ms,
            waiting_period_ms,
            deductible_bps: 2_000,
            max_token_exposure_bps: 1_000,
            pool_available: 0,
            pool_reserved: 0,
            premiums_earned: 0,
            total_paid_out: 0,
            policies: LookupMap::new(b"p"),
            next_policy_id: 0,
            token_policies: LookupMap::new(b"t"),
            token_exposure: LookupMap::new(b"e"),
            rugged: LookupMap::new(b"g"),
            reports: LookupMap::new(b"R"),
            next_report_id: 0,
            open_report: LookupMap::new(b"o"),
            payouts: LookupMap::new(b"P"),
            next_payout_id: 0,
            pending_payouts: IterableSet::new(b"q"),
        }
    }

    // ───────────────────────── admin ─────────────────────────

    pub fn set_api(&mut self, api: AccountId) {
        self.assert_owner();
        self.api = api;
    }

    pub fn add_watcher(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.watchers.insert(account_id);
    }

    pub fn remove_watcher(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.watchers.remove(&account_id);
    }

    pub fn add_relayer(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.relayers.insert(account_id);
    }

    pub fn remove_relayer(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.relayers.remove(&account_id);
    }

    pub fn set_params(
        &mut self,
        dispute_window_ms: Option<u64>,
        waiting_period_ms: Option<u64>,
        deductible_bps: Option<u16>,
        max_token_exposure_bps: Option<u16>,
    ) {
        self.assert_owner();
        if let Some(v) = dispute_window_ms {
            self.dispute_window_ms = v;
        }
        if let Some(v) = waiting_period_ms {
            self.waiting_period_ms = v;
        }
        if let Some(v) = deductible_bps {
            require!((v as u128) < BPS, "deductible must be < 100%");
            self.deductible_bps = v;
        }
        if let Some(v) = max_token_exposure_bps {
            require!(v > 0 && (v as u128) <= BPS, "bad exposure cap");
            self.max_token_exposure_bps = v;
        }
    }

    pub fn transfer_ownership(&mut self, new_owner: AccountId) {
        self.assert_owner();
        self.owner = new_owner;
    }

    // ───────────────────────── pool funding (NEP-141 receiver) ─────────────────────────

    /// `msg`: `"fund"` (underwriting capital) or `"premium"` (swept cover premiums).
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.usdc,
            "only the pool USDC token is accepted"
        );
        let amount = amount.0;
        require!(amount > 0, "zero amount");
        match msg.as_str() {
            "fund" => {}
            "premium" => self.premiums_earned += amount,
            _ => env::panic_str("msg must be \"fund\" or \"premium\""),
        }
        self.pool_available += amount;
        emit(
            "pool_deposit",
            json!({ "sender": sender_id, "amount": U128(amount), "kind": msg }),
        );
        PromiseOrValue::Value(U128(0))
    }

    // ───────────────────────── policies ─────────────────────────

    /// Called by the safu API after a protected buy's 1Click swap is created.
    #[allow(clippy::too_many_arguments)]
    pub fn register_policy(
        &mut self,
        token_chain: String,
        token_addr: String,
        payout_chain: String,
        payout_asset: String,
        recipient: String,
        cover_usdc: U128,
        premium_bps: u16,
        insiders_root: String,
        buy_ref: String,
        expires_at_ms: u64,
    ) -> u64 {
        require!(env::predecessor_account_id() == self.api, "api only");
        let now = env::block_timestamp_ms();
        let key = token_key(&token_chain, &token_addr);
        require!(!self.rugged.contains_key(&key), "token already rugged");
        require!(
            !self.open_report.contains_key(&key),
            "token has an open rug report"
        );
        require!(expires_at_ms > now, "expiry in the past");
        require!(cover_usdc.0 > 0, "zero cover");
        require!((100..=700).contains(&premium_bps), "premium must be 100..=700 bps");
        require!(!recipient.is_empty() && !payout_asset.is_empty(), "missing payout target");

        let exposure = self.token_exposure.get(&key).copied().unwrap_or(0);
        let cap = self.pool_available * self.max_token_exposure_bps as u128 / BPS;
        require!(
            exposure + cover_usdc.0 <= cap,
            "per-token exposure cap reached"
        );

        let ids = self.token_policies.entry(key.clone()).or_default();
        require!(
            ids.len() < MAX_POLICIES_PER_TOKEN,
            "token policy cap reached; call prune_expired"
        );

        let id = self.next_policy_id;
        self.next_policy_id += 1;
        ids.push(id);
        self.token_exposure.insert(key.clone(), exposure + cover_usdc.0);

        let policy = Policy {
            id,
            token_key: key,
            token_chain,
            token_addr,
            payout_chain,
            payout_asset,
            recipient,
            cover_usdc,
            premium_bps,
            insiders_root,
            buy_ref,
            created_at_ms: now,
            starts_at_ms: now + self.waiting_period_ms,
            expires_at_ms,
            status: PolicyStatus::Active,
        };
        emit("policy_registered", json!(policy));
        self.policies.insert(id, policy);
        id
    }

    /// Mark expired policies of a token and release their exposure. Callable by anyone.
    pub fn prune_expired(&mut self, token_chain: String, token_addr: String) -> u32 {
        let key = token_key(&token_chain, &token_addr);
        let now = env::block_timestamp_ms();
        let Some(ids) = self.token_policies.get(&key).cloned() else {
            return 0;
        };
        let mut keep = Vec::with_capacity(ids.len());
        let mut released: u128 = 0;
        let mut pruned = 0u32;
        for id in ids {
            let p = self.policies.get_mut(&id).expect("policy");
            if p.status == PolicyStatus::Active && p.expires_at_ms <= now {
                p.status = PolicyStatus::Expired;
                released += p.cover_usdc.0;
                pruned += 1;
            } else {
                keep.push(id);
            }
        }
        self.token_policies.insert(key.clone(), keep);
        let exp = self.token_exposure.get(&key).copied().unwrap_or(0);
        self.token_exposure.insert(key, exp.saturating_sub(released));
        pruned
    }

    // ───────────────────────── rug lifecycle ─────────────────────────

    /// Watcher reports a rug. Opens the dispute window.
    pub fn report_rug(
        &mut self,
        token_chain: String,
        token_addr: String,
        rule: String,
        evidence: Vec<String>,
    ) -> u64 {
        let reporter = env::predecessor_account_id();
        require!(self.watchers.contains(&reporter), "watcher only");
        require!(!evidence.is_empty(), "evidence required");
        let key = token_key(&token_chain, &token_addr);
        require!(!self.rugged.contains_key(&key), "token already rugged");
        require!(!self.open_report.contains_key(&key), "report already open");

        let now = env::block_timestamp_ms();
        let id = self.next_report_id;
        self.next_report_id += 1;
        let report = Report {
            id,
            token_key: key.clone(),
            reporter,
            rule,
            evidence,
            reported_at_ms: now,
            dispute_deadline_ms: now + self.dispute_window_ms,
            status: ReportStatus::Pending,
            payout_ids: vec![],
            total_payout_usdc: U128(0),
        };
        emit("rug_reported", json!(report));
        self.reports.insert(id, report);
        self.open_report.insert(key, id);
        id
    }

    /// Owner freezes a pending report during its dispute window (MVP: owner-only).
    pub fn dispute(&mut self, report_id: u64) {
        self.assert_owner();
        let r = self.reports.get_mut(&report_id).expect("no such report");
        require!(r.status == ReportStatus::Pending, "not pending");
        require!(
            env::block_timestamp_ms() < r.dispute_deadline_ms,
            "dispute window closed"
        );
        r.status = ReportStatus::Disputed;
        emit("rug_disputed", json!({ "report_id": report_id }));
    }

    /// Owner resolves a dispute: `uphold = true` lets the report be finalized now,
    /// `false` rejects it and re-opens the token for reporting/cover.
    pub fn resolve_dispute(&mut self, report_id: u64, uphold: bool) {
        self.assert_owner();
        let r = self.reports.get_mut(&report_id).expect("no such report");
        require!(r.status == ReportStatus::Disputed, "not disputed");
        if uphold {
            r.status = ReportStatus::Pending;
            r.dispute_deadline_ms = env::block_timestamp_ms();
        } else {
            r.status = ReportStatus::Rejected;
            let key = r.token_key.clone();
            self.open_report.remove(&key);
        }
        emit(
            "rug_dispute_resolved",
            json!({ "report_id": report_id, "upheld": uphold }),
        );
    }

    /// After the dispute window: mark the token rugged and queue payouts for every
    /// policy active at report time. Payout = cover × (1 − deductible), scaled
    /// pro-rata if the pool can't cover them all. Callable by anyone.
    pub fn finalize_rug(&mut self, report_id: u64) -> Vec<u64> {
        let now = env::block_timestamp_ms();
        let (key, reported_at) = {
            let r = self.reports.get(&report_id).expect("no such report");
            require!(r.status == ReportStatus::Pending, "report not pending");
            require!(now >= r.dispute_deadline_ms, "dispute window still open");
            (r.token_key.clone(), r.reported_at_ms)
        };

        let ids = self.token_policies.remove(&key).unwrap_or_default();
        self.token_exposure.remove(&key);

        // Pass 1: eligible gross payouts.
        let keep_bps = BPS - self.deductible_bps as u128;
        let mut eligible: Vec<(u64, u128)> = Vec::new();
        let mut gross_total: u128 = 0;
        for id in &ids {
            let p = self.policies.get_mut(id).expect("policy");
            if p.status != PolicyStatus::Active {
                continue;
            }
            if p.starts_at_ms <= reported_at && reported_at < p.expires_at_ms {
                let gross = p.cover_usdc.0 * keep_bps / BPS;
                gross_total += gross;
                eligible.push((*id, gross));
            } else if p.expires_at_ms <= reported_at {
                p.status = PolicyStatus::Expired;
            } else {
                p.status = PolicyStatus::NotEligible;
            }
        }

        // Pass 2: pro-rata against available pool.
        let available = self.pool_available;
        let mut payout_ids = Vec::with_capacity(eligible.len());
        let mut total: u128 = 0;
        for (policy_id, gross) in eligible {
            let amount = if gross_total <= available {
                gross
            } else {
                gross * available / gross_total
            };
            let pid = self.next_payout_id;
            self.next_payout_id += 1;
            let p = self.policies.get_mut(&policy_id).expect("policy");
            p.status = PolicyStatus::Claimed { payout_id: pid };
            let payout = Payout {
                id: pid,
                policy_id,
                report_id,
                amount_usdc: U128(amount),
                payout_chain: p.payout_chain.clone(),
                payout_asset: p.payout_asset.clone(),
                recipient: p.recipient.clone(),
                status: PayoutStatus::Queued,
                rail: None,
                deposit_address: None,
                dest_tx_hash: None,
            };
            emit("payout_queued", json!(payout));
            self.payouts.insert(pid, payout);
            self.pending_payouts.insert(pid);
            payout_ids.push(pid);
            total += amount;
        }

        self.pool_available -= total;
        self.pool_reserved += total;
        self.open_report.remove(&key);
        self.rugged.insert(key.clone(), report_id);

        let r = self.reports.get_mut(&report_id).expect("report");
        r.status = ReportStatus::Finalized;
        r.payout_ids = payout_ids.clone();
        r.total_payout_usdc = U128(total);
        emit(
            "rug_finalized",
            json!({ "report_id": report_id, "token_key": key, "payouts": payout_ids.len(), "total_usdc": U128(total) }),
        );
        payout_ids
    }

    // ───────────────────────── payouts: Rail A (NEAR Intents) ─────────────────────────

    /// Relayer obtained a 1Click quote (origin = NEAR USDC, destination = the
    /// payout asset on the user's chain, recipient = user) and passes its
    /// deposit address. The contract registers storage for it and transfers
    /// exactly the payout amount.
    pub fn request_payout_intents(&mut self, payout_id: u64, deposit_address: AccountId) -> Promise {
        self.assert_relayer();
        let p = self.payouts.get_mut(&payout_id).expect("no such payout");
        require!(p.status == PayoutStatus::Queued, "payout not queued");
        p.status = PayoutStatus::Processing;
        p.rail = Some(PayoutRail::Intents);
        p.deposit_address = Some(deposit_address.clone());
        let amount = p.amount_usdc;
        emit(
            "payout_processing",
            json!({ "payout_id": payout_id, "rail": "Intents", "deposit_address": deposit_address }),
        );

        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(USDC_STORAGE_DEPOSIT)
            .with_static_gas(GAS_STORAGE_DEPOSIT)
            .storage_deposit(Some(deposit_address.clone()), Some(true))
            .then(
                ext_ft::ext(self.usdc.clone())
                    .with_attached_deposit(NearToken::from_yoctonear(1))
                    .with_static_gas(GAS_FT_TRANSFER)
                    .ft_transfer(deposit_address, amount, Some(format!("safu payout {payout_id}"))),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_payout_intents(payout_id),
            )
    }

    #[private]
    pub fn on_payout_intents(&mut self, payout_id: u64) -> bool {
        // ft_transfer returns no value; we only need success/failure.
        let ok = env::promise_result_checked(0, 0).is_ok();
        let p = self.payouts.get_mut(&payout_id).expect("payout");
        if ok {
            p.status = PayoutStatus::Sent;
            let amount = p.amount_usdc.0;
            self.pool_reserved -= amount;
            self.total_paid_out += amount;
            emit("payout_sent", json!({ "payout_id": payout_id }));
        } else {
            p.status = PayoutStatus::Queued;
            p.rail = None;
            p.deposit_address = None;
            emit("payout_retry", json!({ "payout_id": payout_id }));
        }
        ok
    }

    /// Relayer confirms destination-chain delivery (1Click status SUCCESS tx hash).
    pub fn mark_paid(&mut self, payout_id: u64, dest_tx_hash: String) {
        self.assert_relayer();
        let p = self.payouts.get_mut(&payout_id).expect("no such payout");
        require!(p.status == PayoutStatus::Sent, "payout not sent");
        p.status = PayoutStatus::Paid;
        p.dest_tx_hash = Some(dest_tx_hash.clone());
        self.pending_payouts.remove(&payout_id);
        emit(
            "payout_paid",
            json!({ "payout_id": payout_id, "dest_tx_hash": dest_tx_hash }),
        );
    }

    // ───────────────────────── views ─────────────────────────

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            usdc: self.usdc.clone(),
            api: self.api.clone(),
            watchers: self.watchers.iter().cloned().collect(),
            relayers: self.relayers.iter().cloned().collect(),
            dispute_window_ms: self.dispute_window_ms,
            waiting_period_ms: self.waiting_period_ms,
            deductible_bps: self.deductible_bps,
            max_token_exposure_bps: self.max_token_exposure_bps,
        }
    }

    pub fn pool_stats(&self) -> PoolStats {
        PoolStats {
            available_usdc: U128(self.pool_available),
            reserved_usdc: U128(self.pool_reserved),
            premiums_earned_usdc: U128(self.premiums_earned),
            total_paid_out_usdc: U128(self.total_paid_out),
            policies: self.next_policy_id,
            reports: self.next_report_id,
            payouts: self.next_payout_id,
        }
    }

    pub fn get_policy(&self, policy_id: u64) -> Option<Policy> {
        self.policies.get(&policy_id).cloned()
    }

    pub fn get_report(&self, report_id: u64) -> Option<Report> {
        self.reports.get(&report_id).cloned()
    }

    pub fn get_payout(&self, payout_id: u64) -> Option<Payout> {
        self.payouts.get(&payout_id).cloned()
    }

    /// Active (unresolved) policies on a token + total exposure.
    pub fn get_token(&self, token_chain: String, token_addr: String) -> near_sdk::serde_json::Value {
        let key = token_key(&token_chain, &token_addr);
        let ids = self.token_policies.get(&key).cloned().unwrap_or_default();
        json!({
            "token_key": key,
            "active_policy_ids": ids,
            "exposure_usdc": U128(self.token_exposure.get(&key).copied().unwrap_or(0)),
            "open_report_id": self.open_report.get(&key),
            "rugged_report_id": self.rugged.get(&key),
        })
    }

    pub fn list_pending_payouts(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Payout> {
        self.pending_payouts
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50) as usize)
            .filter_map(|id| self.payouts.get(id).cloned())
            .collect()
    }

    // ───────────────────────── internal ─────────────────────────

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    fn assert_relayer(&self) {
        require!(
            self.relayers.contains(&env::predecessor_account_id()),
            "relayer only"
        );
    }
}
