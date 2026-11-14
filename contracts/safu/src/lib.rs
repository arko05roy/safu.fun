//! safu.fun — rug cover on NEAR.
//!
//! This crate (phase 1) implements:
//! - USDC (NEP-141) underwriting pool, funded via `ft_transfer_call`
//! - policy registration by the safu API (one policy per protected buy)
//! - rug lifecycle: watcher `report_rug` -> dispute window -> `finalize_rug`
//! - payout queue + Rail A (USDC -> 1Click deposit address -> any chain)
//! - Rail B: the contract builds an EVM USDC transfer itself, gets it signed by
//!   the NEAR MPC network (Chain Signatures), ecrecover-verifies it and stores
//!   the raw tx for anyone to broadcast
//!
//! $SAFU staking and UNO REVERSE launches land in later phases.

mod events;
mod evm;
mod intents;
mod migrate;
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
const GAS_MPC_SIGN: Gas = Gas::from_tgas(50);
const GAS_SIGN_CALLBACK: Gas = Gas::from_tgas(30);
/// Chain Signatures domain 0 = secp256k1 (Ecdsa).
const DOMAIN_ECDSA: u32 = 0;
/// NEP-145 registration cost for the NEAR USDC contract (0.00125 NEAR).
const USDC_STORAGE_DEPOSIT: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
}

#[ext_contract(ext_mpc)]
#[allow(dead_code)]
trait MpcSigner {
    fn sign(&mut self, request: near_sdk::serde_json::Value);
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

    /// Chain Signatures MPC contract (`v1.signer` / `v1.signer-prod.testnet`).
    mpc_signer: AccountId,
    /// Rail B EVM chains, keyed by payout_chain id (e.g. "base-sepolia").
    evm_chains: LookupMap<String, EvmChain>,

    /// 1Click manager ed25519 key; Rail A quotes must be signed by it.
    oneclick_pubkey: [u8; 32],
    /// Max slippage a Rail A quote may carry.
    max_slippage_bps: u16,
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
        mpc_signer: AccountId,
        oneclick_pubkey: Option<String>,
    ) -> Self {
        let oneclick_pubkey = intents::parse_pubkey(
            oneclick_pubkey.as_deref().unwrap_or(intents::DEFAULT_ONECLICK_PUBKEY),
        )
        .expect("bad oneclick_pubkey");
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
            mpc_signer,
            evm_chains: LookupMap::new(b"c"),
            oneclick_pubkey,
            max_slippage_bps: 300,
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

    /// Rotate the 1Click quote-signing key (`ed25519:<base58>`).
    pub fn set_oneclick_pubkey(&mut self, public_key: String) {
        self.assert_owner();
        self.oneclick_pubkey = intents::parse_pubkey(&public_key).expect("bad public key");
    }

    pub fn set_max_slippage_bps(&mut self, bps: u16) {
        self.assert_owner();
        require!((bps as u128) < BPS, "bad slippage");
        self.max_slippage_bps = bps;
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
                evm_nonce: None,
                signed_tx: None,
                evm_tx_hash: None,
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

    /// Relayer passes a live 1Click quote: `quote` is the exact field object
    /// 1Click signed (request fields + quote fields + timestamp, as built by
    /// the official SDK) and `quote_signature` its `ed25519:` signature.
    ///
    /// The contract verifies the signature against the 1Click manager key and
    /// that the quote swaps exactly this payout's USDC into the policy's
    /// `payout_asset` for the policy's `recipient`, refunding to this contract.
    /// USDC goes to the deposit address *from the signed quote* — the relayer
    /// cannot redirect it.
    pub fn request_payout_intents(
        &mut self,
        payout_id: u64,
        quote: near_sdk::serde_json::Map<String, near_sdk::serde_json::Value>,
        quote_signature: String,
    ) -> Promise {
        self.assert_relayer();
        {
            let p = self.payouts.get(&payout_id).expect("no such payout");
            require!(p.status == PayoutStatus::Queued, "payout not queued");
            require!(p.evm_nonce.is_none(), "payout is bound to Rail B");
        }
        require!(
            intents::verify_quote_signature(&quote, &quote_signature, &self.oneclick_pubkey),
            "invalid 1Click quote signature"
        );
        let me = env::current_account_id();
        let origin = format!("nep141:{}", self.usdc);
        let max_slippage = self.max_slippage_bps as u64;
        let deposit_address: AccountId = intents::str_field(&quote, "depositAddress")
            .and_then(|a| a.parse().ok())
            .unwrap_or_else(|| env::panic_str("quote has no valid NEAR depositAddress"));

        let p = self.payouts.get_mut(&payout_id).expect("no such payout");

        let f = |k: &str| intents::str_field(&quote, k);
        require!(quote.get("dry").and_then(|v| v.as_bool()) == Some(false), "quote is dry");
        require!(f("swapType") == Some("EXACT_INPUT"), "quote swapType must be EXACT_INPUT");
        require!(f("depositType") == Some("ORIGIN_CHAIN"), "quote depositType must be ORIGIN_CHAIN");
        require!(f("originAsset") == Some(origin.as_str()), "quote originAsset is not pool USDC");
        require!(f("amount") == Some(p.amount_usdc.0.to_string().as_str()), "quote amount != payout amount");
        require!(f("destinationAsset") == Some(p.payout_asset.as_str()), "quote destinationAsset != policy payout_asset");
        require!(f("recipient") == Some(p.recipient.as_str()), "quote recipient != policy recipient");
        require!(f("recipientType") == Some("DESTINATION_CHAIN"), "quote recipientType must be DESTINATION_CHAIN");
        require!(f("refundTo") == Some(me.as_str()), "quote must refund to this contract");
        require!(f("refundType") == Some("ORIGIN_CHAIN"), "quote refundType must be ORIGIN_CHAIN");
        require!(
            quote.get("slippageTolerance").and_then(|v| v.as_u64()).is_some_and(|s| s <= max_slippage),
            "quote slippage above max"
        );
        for k in ["depositMemo", "customRecipientMsg", "virtualChainRecipient", "virtualChainRefundRecipient"] {
            require!(!quote.contains_key(k), "unsupported quote field");
        }
        let deadline = f("deadline").and_then(intents::parse_iso_ms).expect("quote has no deadline");
        require!(deadline > env::block_timestamp_ms(), "quote expired");
        p.status = PayoutStatus::Processing;
        p.rail = Some(PayoutRail::Intents);
        p.deposit_address = Some(deposit_address.clone());
        let amount = p.amount_usdc;
        emit(
            "payout_processing",
            json!({ "payout_id": payout_id, "rail": "Intents", "deposit_address": deposit_address, "quote_signature": quote_signature }),
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

// ───────────────────────── payouts: Rail B (Chain Signatures, EVM) ─────────────────────────

    /// Owner registers / updates an EVM payout chain. `next_nonce` must equal the
    /// pool address's current on-chain nonce when first configured.
    #[allow(clippy::too_many_arguments)]
    pub fn set_evm_chain(
        &mut self,
        chain: String,
        chain_id: u64,
        usdc: String,
        signer_address: String,
        next_nonce: u64,
        gas_limit: u64,
        max_fee_per_gas_cap: U128,
    ) {
        self.assert_owner();
        require!(evm::parse_address(&usdc).is_some(), "bad usdc address");
        require!(evm::parse_address(&signer_address).is_some(), "bad signer address");
        let float_usdc = self
            .evm_chains
            .get(&chain)
            .map(|c| c.float_usdc)
            .unwrap_or(U128(0));
        let cfg = EvmChain {
            chain_id,
            usdc: usdc.to_lowercase(),
            signer_address: signer_address.to_lowercase(),
            next_nonce,
            gas_limit,
            max_fee_per_gas_cap,
            float_usdc,
        };
        emit("evm_chain_set", json!({ "chain": chain, "config": cfg }));
        self.evm_chains.insert(chain, cfg);
    }

    /// Owner records USDC it has placed on the chain's pool address.
    pub fn add_chain_float(&mut self, chain: String, amount: U128) {
        self.assert_owner();
        let c = self.evm_chains.get_mut(&chain).expect("unknown evm chain");
        c.float_usdc = U128(c.float_usdc.0 + amount.0);
    }

    /// Relayer asks the contract to build + sign the payout tx. The contract
    /// fixes recipient, token, amount, chain id and nonce; the relayer only
    /// picks gas prices (capped). Calling again on a `Signed` payout re-signs
    /// with the *same nonce* (gas bump) — only one of them can ever be mined.
    pub fn request_payout_signed(
        &mut self,
        payout_id: u64,
        max_fee_per_gas: U128,
        max_priority_fee_per_gas: U128,
    ) -> Promise {
        self.assert_relayer();
        let p = self.payouts.get(&payout_id).expect("no such payout").clone();
        require!(
            matches!(p.status, PayoutStatus::Queued | PayoutStatus::Signed),
            "payout not queued/signed"
        );
        require!(p.rail != Some(PayoutRail::Intents), "payout is bound to Rail A");
        require!(
            max_priority_fee_per_gas.0 <= max_fee_per_gas.0,
            "priority fee above max fee"
        );
        let chain = self
            .evm_chains
            .get_mut(&p.payout_chain)
            .unwrap_or_else(|| env::panic_str("payout chain has no Rail B config"));
        require!(
            max_fee_per_gas.0 <= chain.max_fee_per_gas_cap.0,
            "max fee above cap"
        );
        require!(
            evm::parse_address(&p.recipient).is_some(),
            "recipient is not an EVM address"
        );

        let nonce = match p.evm_nonce {
            Some(n) => n,
            None => {
                require!(chain.float_usdc.0 >= p.amount_usdc.0, "insufficient chain float");
                chain.float_usdc = U128(chain.float_usdc.0 - p.amount_usdc.0);
                let n = chain.next_nonce;
                chain.next_nonce += 1;
                n
            }
        };
        let tx = Self::build_evm_tx(chain, &p, nonce, max_fee_per_gas.0, max_priority_fee_per_gas.0);
        let hash = tx.signing_hash();

        let pm = self.payouts.get_mut(&payout_id).expect("payout");
        pm.evm_nonce = Some(nonce);
        pm.rail = Some(PayoutRail::ChainSig);
        pm.status = PayoutStatus::Processing;
        emit(
            "payout_processing",
            json!({ "payout_id": payout_id, "rail": "ChainSig", "nonce": nonce, "payload": evm::hex_encode(&hash) }),
        );

        ext_mpc::ext(self.mpc_signer.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_MPC_SIGN)
            .sign(json!({
                "path": format!("pool-{}", p.payout_chain),
                "payload_v2": { "Ecdsa": evm::hex_encode(&hash) },
                "domain_id": DOMAIN_ECDSA,
            }))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_SIGN_CALLBACK)
                    .on_payout_signed(payout_id, nonce, max_fee_per_gas, max_priority_fee_per_gas),
            )
    }

    #[private]
    pub fn on_payout_signed(
        &mut self,
        payout_id: u64,
        nonce: u64,
        max_fee_per_gas: U128,
        max_priority_fee_per_gas: U128,
    ) -> bool {
        let p = self.payouts.get(&payout_id).expect("payout").clone();
        let chain = self.evm_chains.get(&p.payout_chain).expect("chain").clone();
        let tx = Self::build_evm_tx(&chain, &p, nonce, max_fee_per_gas.0, max_priority_fee_per_gas.0);
        let hash = tx.signing_hash();

        let signed = env::promise_result_checked(0, 2048)
            .ok()
            .and_then(|raw| parse_mpc_ecdsa(&raw))
            .filter(|(r, s, v)| {
                evm::recover_address(&hash, r, s, *v).map(|a| evm::hex_encode(&a))
                    == chain.signer_address.strip_prefix("0x").map(str::to_string)
            });

        let first_sign = p.signed_tx.is_none();
        let pm = self.payouts.get_mut(&payout_id).expect("payout");
        match signed {
            Some((r, s, v)) => {
                let raw = tx.signed_bytes(v, &r, &s);
                let tx_hash = env::keccak256_array(&raw);
                pm.signed_tx = Some(format!("0x{}", evm::hex_encode(&raw)));
                pm.evm_tx_hash = Some(format!("0x{}", evm::hex_encode(&tx_hash)));
                pm.status = PayoutStatus::Signed;
                let amount = pm.amount_usdc.0;
                let ev = json!({
                    "payout_id": payout_id,
                    "chain": pm.payout_chain,
                    "nonce": nonce,
                    "evm_tx_hash": pm.evm_tx_hash,
                    "signed_tx": pm.signed_tx,
                });
                if first_sign {
                    self.pool_reserved -= amount;
                    self.total_paid_out += amount;
                }
                emit("payout_signed", ev);
                true
            }
            None => {
                // Keep the nonce bound to this payout; a retry re-signs the same nonce.
                pm.status = if first_sign { PayoutStatus::Queued } else { PayoutStatus::Signed };
                emit("payout_sign_failed", json!({ "payout_id": payout_id, "nonce": nonce }));
                false
            }
        }
    }

    fn build_evm_tx(
        chain: &EvmChain,
        p: &Payout,
        nonce: u64,
        max_fee_per_gas: u128,
        max_priority_fee_per_gas: u128,
    ) -> evm::Eip1559Tx {
        let recipient = evm::parse_address(&p.recipient).expect("recipient");
        evm::Eip1559Tx {
            chain_id: chain.chain_id,
            nonce,
            max_priority_fee_per_gas,
            max_fee_per_gas,
            gas_limit: chain.gas_limit,
            to: evm::parse_address(&chain.usdc).expect("usdc"),
            value: 0,
            data: evm::erc20_transfer_data(&recipient, p.amount_usdc.0),
        }
    }

    /// Relayer confirms destination-chain delivery (1Click status SUCCESS tx hash).
    pub fn mark_paid(&mut self, payout_id: u64, dest_tx_hash: String) {
        self.assert_relayer();
        let p = self.payouts.get_mut(&payout_id).expect("no such payout");
        match p.status {
            PayoutStatus::Sent => {}
            PayoutStatus::Signed => require!(
                p.evm_tx_hash.as_deref().map(|h| h.eq_ignore_ascii_case(&dest_tx_hash)) == Some(true),
                "tx hash does not match the signed payout tx"
            ),
            _ => env::panic_str("payout not sent/signed"),
        }
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
            mpc_signer: self.mpc_signer.clone(),
            oneclick_pubkey: format!("ed25519:{}", near_sdk::bs58::encode(self.oneclick_pubkey).into_string()),
            max_slippage_bps: self.max_slippage_bps,
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

    pub fn get_evm_chain(&self, chain: String) -> Option<EvmChain> {
        self.evm_chains.get(&chain).cloned()
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

/// Parse the MPC `sign` response for secp256k1:
/// `{"scheme":"Secp256k1","big_r":{"affine_point":"02…"},"s":{"scalar":"…"},"recovery_id":0}`
/// Returns (r, s, y_parity).
fn parse_mpc_ecdsa(raw: &[u8]) -> Option<([u8; 32], [u8; 32], u8)> {
    let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(raw).ok()?;
    let big_r = evm::hex_decode(&v["big_r"]["affine_point"].as_str()?.to_lowercase())?;
    let s = evm::hex_decode(&v["s"]["scalar"].as_str()?.to_lowercase())?;
    let rid = v["recovery_id"].as_u64()?;
    if big_r.len() != 33 || s.len() != 32 || rid > 1 {
        return None;
    }
    let r: [u8; 32] = big_r[1..].try_into().ok()?;
    Some((r, s.try_into().ok()?, rid as u8))
}
