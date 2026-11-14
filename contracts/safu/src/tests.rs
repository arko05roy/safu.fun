use super::*;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::testing_env;

const MS: u64 = 1_000_000; // ns per ms
const USDC: u128 = 1_000_000; // 6 decimals

fn owner() -> AccountId {
    accounts(0)
}
fn usdc() -> AccountId {
    "usdc.test.near".parse().unwrap()
}
fn api() -> AccountId {
    accounts(1)
}
fn watcher() -> AccountId {
    accounts(2)
}
fn relayer() -> AccountId {
    accounts(3)
}
fn mpc() -> AccountId {
    "v1.signer-prod.testnet".parse().unwrap()
}

fn ctx(predecessor: AccountId, now_ms: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id("safu.test.near".parse().unwrap())
        .predecessor_account_id(predecessor)
        .block_timestamp(now_ms * MS);
    testing_env!(b.build());
}

fn setup(pool: u128) -> Safu {
    ctx(owner(), 1_000);
    let mut c = Safu::new(owner(), usdc(), api(), 60_000, 0, mpc(), None);
    c.add_watcher(watcher());
    c.add_relayer(relayer());
    if pool > 0 {
        ctx(usdc(), 1_000);
        let _ = c.ft_on_transfer(owner(), U128(pool), "fund".into());
    }
    c
}

fn watch(c: &mut Safu, chain: &str, addr: &str) {
    if c.get_token(chain.into(), addr.into())["watch"].is_null() {
        c.register_token_watch(
            chain.into(),
            addr.into(),
            Holder { address: "0x00000000000000000000000000000000000000d1".into(), baseline: U128(1_000) },
            vec![],
            1,
        );
    }
}

fn register(c: &mut Safu, cover: u128, now_ms: u64) -> u64 {
    ctx(api(), now_ms);
    watch(c, "base-sepolia", "0xABCdef0000000000000000000000000000000001");
    c.register_policy(
        "base-sepolia".into(),
        "0xABCdef0000000000000000000000000000000001".into(),
        "sol".into(),
        "nep141:sol.omft.near".into(),
        "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin".into(),
        U128(cover),
        500,
        "00".into(),
        "buy-ref".into(),
        now_ms + 7 * 24 * 3600 * 1000,
    )
}

fn report(c: &mut Safu, now_ms: u64) -> u64 {
    ctx(watcher(), now_ms);
    c.report_rug(
        "BASE-SEPOLIA".into(),
        "0xabcdef0000000000000000000000000000000001".into(),
        "R1".into(),
        vec!["0xdead".into()],
    )
}

#[test]
fn fund_and_premium_accounting() {
    let mut c = setup(1_000 * USDC);
    ctx(usdc(), 2_000);
    let _ = c.ft_on_transfer(api(), U128(5 * USDC), "premium".into());
    let s = c.pool_stats();
    assert_eq!(s.available_usdc.0, 1_005 * USDC);
    assert_eq!(s.premiums_earned_usdc.0, 5 * USDC);
}

#[test]
#[should_panic(expected = "only the pool USDC token is accepted")]
fn rejects_foreign_token() {
    let mut c = setup(0);
    ctx(accounts(4), 2_000);
    let _ = c.ft_on_transfer(owner(), U128(1), "fund".into());
}

#[test]
#[should_panic(expected = "api only")]
fn only_api_registers() {
    let mut c = setup(1_000 * USDC);
    ctx(accounts(4), 2_000);
    c.register_policy(
        "x".into(), "y".into(), "sol".into(), "a".into(), "r".into(),
        U128(1), 100, "".into(), "".into(), 10_000_000,
    );
}

#[test]
#[should_panic(expected = "per-token exposure cap reached")]
fn exposure_cap_is_10pct_of_pool() {
    let mut c = setup(1_000 * USDC);
    register(&mut c, 60 * USDC, 2_000);
    register(&mut c, 41 * USDC, 2_000); // 101 > 100 cap
}

#[test]
fn token_key_is_normalized() {
    let mut c = setup(1_000 * USDC);
    register(&mut c, 10 * USDC, 2_000);
    let t = c.get_token("base-sepolia".into(), "0xabcdef0000000000000000000000000000000001".into());
    assert_eq!(t["active_policy_ids"].as_array().unwrap().len(), 1);
}

#[test]
fn full_rug_lifecycle_pays_80pct() {
    let mut c = setup(1_000 * USDC);
    let pid = register(&mut c, 50 * USDC, 2_000);
    let rid = report(&mut c, 3_000);

    ctx(accounts(4), 3_000 + 60_000);
    let payouts = c.finalize_rug(rid);
    assert_eq!(payouts.len(), 1);

    let p = c.get_payout(payouts[0]).unwrap();
    assert_eq!(p.amount_usdc.0, 40 * USDC);
    assert_eq!(p.recipient, "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
    assert_eq!(p.status, PayoutStatus::Queued);
    assert_eq!(
        c.get_policy(pid).unwrap().status,
        PolicyStatus::Claimed { payout_id: payouts[0] }
    );
    let s = c.pool_stats();
    assert_eq!(s.available_usdc.0, 960 * USDC);
    assert_eq!(s.reserved_usdc.0, 40 * USDC);
    assert_eq!(c.list_pending_payouts(None, None).len(), 1);
}

#[test]
#[should_panic(expected = "dispute window still open")]
fn cannot_finalize_inside_window() {
    let mut c = setup(1_000 * USDC);
    register(&mut c, 50 * USDC, 2_000);
    let rid = report(&mut c, 3_000);
    ctx(accounts(4), 3_000 + 59_999);
    c.finalize_rug(rid);
}

#[test]
#[should_panic(expected = "token already rugged")]
fn no_new_cover_after_rug() {
    let mut c = setup(1_000 * USDC);
    register(&mut c, 50 * USDC, 2_000);
    let rid = report(&mut c, 3_000);
    ctx(accounts(4), 70_000);
    c.finalize_rug(rid);
    register(&mut c, 10 * USDC, 80_000);
}

#[test]
fn rejected_dispute_reopens_token() {
    let mut c = setup(1_000 * USDC);
    register(&mut c, 50 * USDC, 2_000);
    let rid = report(&mut c, 3_000);
    ctx(owner(), 4_000);
    c.dispute(rid);
    c.resolve_dispute(rid, false);
    assert_eq!(c.get_report(rid).unwrap().status, ReportStatus::Rejected);
    // token can be covered and reported again
    register(&mut c, 10 * USDC, 5_000);
    report(&mut c, 6_000);
}

#[test]
fn upheld_dispute_finalizes_immediately() {
    let mut c = setup(1_000 * USDC);
    register(&mut c, 50 * USDC, 2_000);
    let rid = report(&mut c, 3_000);
    ctx(owner(), 4_000);
    c.dispute(rid);
    c.resolve_dispute(rid, true);
    ctx(accounts(4), 4_000);
    assert_eq!(c.finalize_rug(rid).len(), 1);
}

#[test]
fn waiting_period_excludes_fresh_policies() {
    ctx(owner(), 1_000);
    let mut c = Safu::new(owner(), usdc(), api(), 60_000, 600_000, mpc(), None); // 10 min wait
    c.add_watcher(watcher());
    ctx(usdc(), 1_000);
    let _ = c.ft_on_transfer(owner(), U128(1_000 * USDC), "fund".into());
    let pid = register(&mut c, 50 * USDC, 2_000);
    let rid = report(&mut c, 2_000 + 300_000); // 5 min later
    ctx(accounts(4), 2_000 + 300_000 + 60_000);
    assert!(c.finalize_rug(rid).is_empty());
    assert_eq!(c.get_policy(pid).unwrap().status, PolicyStatus::NotEligible);
    assert_eq!(c.pool_stats().available_usdc.0, 1_000 * USDC);
}

#[test]
fn pro_rata_when_pool_short() {
    let mut c = setup(1_000 * USDC);
    ctx(owner(), 1_500);
    c.set_params(None, None, None, Some(10_000)); // 100% per-token cap for this test
    register(&mut c, 1_000 * USDC, 2_000); // token A
    ctx(api(), 2_000);
    watch(&mut c, "sol-devnet", "TokenB111");
    c.register_policy(
        "sol-devnet".into(), "TokenB111".into(), "base".into(), "nep141:base.omft.near".into(),
        "0x0000000000000000000000000000000000000b0b".into(), U128(1_000 * USDC), 700,
        "00".into(), "ref".into(), 10_000_000,
    );
    // rug A: 800 reserved, 200 left
    let ra = report(&mut c, 3_000);
    ctx(accounts(4), 70_000);
    c.finalize_rug(ra);
    // rug B: gross 800 but only 200 available -> paid pro-rata
    ctx(watcher(), 80_000);
    let rb = c.report_rug("sol-devnet".into(), "TokenB111".into(), "R1".into(), vec!["sig".into()]);
    ctx(accounts(4), 150_000);
    let ids = c.finalize_rug(rb);
    assert_eq!(c.get_payout(ids[0]).unwrap().amount_usdc.0, 200 * USDC);
    assert_eq!(c.pool_stats().available_usdc.0, 0);
    assert_eq!(c.pool_stats().reserved_usdc.0, 1_000 * USDC);
}

#[test]
#[should_panic(expected = "relayer only")]
fn only_relayer_requests_payout() {
    let mut c = setup(1_000 * USDC);
    register(&mut c, 50 * USDC, 2_000);
    let rid = report(&mut c, 3_000);
    ctx(accounts(4), 70_000);
    let ids = c.finalize_rug(rid);
    let _ = c.request_payout_intents(ids[0], Default::default(), "ed25519:x".into());
}

// ───────── Rail B ─────────
// Same reference vector as evm::tests (viem 2.21, key 0x4c0883a6…f362318 →
// 0x2c7536E3605D9C16a7a3D7b1898e529396a65c23 plays the MPC-derived pool address).
const REF_R: &str = "b72a6fad9a0217e3fc59b17d4f21daf25942c1f5a8ff7bcf8f431e03397500dc";
const REF_S: &str = "79b1f1de3440b50fb4d4e694b731a26f5510348e9c2174f990b11f24ba90ac61";
const REF_SIGNED: &str = "0x02f8b283014a3407830f424084b2d05e00830186a094036cbd53842c5426634e7929541ec2318f3dcf7e80b844a9059cbb00000000000000000000000000000000000000000000000000000000000b0b010000000000000000000000000000000000000000000000000000000002625a00c001a0b72a6fad9a0217e3fc59b17d4f21daf25942c1f5a8ff7bcf8f431e03397500dca079b1f1de3440b50fb4d4e694b731a26f5510348e9c2174f990b11f24ba90ac61";

fn ctx_with_result(predecessor: AccountId, now_ms: u64, result: near_sdk::PromiseResult) {
    let mut b = VMContextBuilder::new();
    b.current_account_id("safu.test.near".parse().unwrap())
        .predecessor_account_id(predecessor)
        .block_timestamp(now_ms * MS);
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}

/// Pool with one rugged policy paying 40 USDC to 0x…0b0b01 on base-sepolia.
fn railb_setup() -> (Safu, u64) {
    let mut c = setup(1_000 * USDC);
    ctx(owner(), 1_500);
    c.set_evm_chain(
        "base-sepolia".into(),
        84532,
        "0x036CbD53842c5426634e7929541eC2318f3dCF7e".into(),
        "0x2c7536E3605D9C16a7a3D7b1898e529396a65c23".into(),
        7,
        100_000,
        U128(10_000_000_000),
    );
    c.add_chain_float("base-sepolia".into(), U128(100 * USDC));
    ctx(api(), 2_000);
    watch(&mut c, "base-sepolia", "0xABCdef0000000000000000000000000000000001");
    c.register_policy(
        "base-sepolia".into(), "0xABCdef0000000000000000000000000000000001".into(),
        "base-sepolia".into(), "nep141:base.omft.near".into(),
        "0x00000000000000000000000000000000000b0b01".into(), U128(50 * USDC), 500,
        "00".into(), "ref".into(), 10_000_000,
    );
    let rid = report(&mut c, 3_000);
    ctx(accounts(4), 70_000);
    let pid = c.finalize_rug(rid)[0];
    (c, pid)
}

fn mpc_response(r: &str, s: &str, rid: u8) -> Vec<u8> {
    format!(r#"{{"scheme":"Secp256k1","big_r":{{"affine_point":"03{r}"}},"s":{{"scalar":"{s}"}},"recovery_id":{rid}}}"#).into_bytes()
}

#[test]
fn rail_b_builds_signs_and_stores_raw_tx() {
    let (mut c, pid) = railb_setup();
    ctx(relayer(), 80_000);
    let _ = c.request_payout_signed(pid, U128(3_000_000_000), U128(1_000_000));
    let p = c.get_payout(pid).unwrap();
    assert_eq!(p.status, PayoutStatus::Processing);
    assert_eq!(p.evm_nonce, Some(7));
    assert_eq!(c.get_evm_chain("base-sepolia".into()).unwrap().next_nonce, 8);
    assert_eq!(c.get_evm_chain("base-sepolia".into()).unwrap().float_usdc.0, 60 * USDC);

    ctx_with_result(
        "safu.test.near".parse().unwrap(),
        80_001,
        near_sdk::PromiseResult::Successful(mpc_response(REF_R, REF_S, 1)),
    );
    assert!(c.on_payout_signed(pid, 7, U128(3_000_000_000), U128(1_000_000)));
    let p = c.get_payout(pid).unwrap();
    assert_eq!(p.status, PayoutStatus::Signed);
    assert_eq!(p.signed_tx.as_deref(), Some(REF_SIGNED));
    let s = c.pool_stats();
    assert_eq!(s.reserved_usdc.0, 0);
    assert_eq!(s.total_paid_out_usdc.0, 40 * USDC);

    // relayer can only confirm the exact tx the contract signed
    ctx(relayer(), 90_000);
    let h = p.evm_tx_hash.unwrap();
    c.mark_paid(pid, h.to_uppercase().replace("0X", "0x"));
    assert_eq!(c.get_payout(pid).unwrap().status, PayoutStatus::Paid);
    assert!(c.list_pending_payouts(None, None).is_empty());
}

#[test]
fn rail_b_rejects_signature_from_wrong_key() {
    let (mut c, pid) = railb_setup();
    ctx(relayer(), 80_000);
    let _ = c.request_payout_signed(pid, U128(3_000_000_000), U128(1_000_000));
    // valid-looking but wrong recovery id -> recovers a different address
    ctx_with_result(
        "safu.test.near".parse().unwrap(),
        80_001,
        near_sdk::PromiseResult::Successful(mpc_response(REF_R, REF_S, 0)),
    );
    assert!(!c.on_payout_signed(pid, 7, U128(3_000_000_000), U128(1_000_000)));
    let p = c.get_payout(pid).unwrap();
    assert_eq!(p.status, PayoutStatus::Queued);
    assert_eq!(p.evm_nonce, Some(7)); // nonce stays bound to this payout
    assert!(p.signed_tx.is_none());
    assert_eq!(c.pool_stats().reserved_usdc.0, 40 * USDC);

    // retry reuses nonce 7 and does not consume float again
    ctx(relayer(), 81_000);
    let _ = c.request_payout_signed(pid, U128(3_000_000_000), U128(1_000_000));
    let ch = c.get_evm_chain("base-sepolia".into()).unwrap();
    assert_eq!(ch.next_nonce, 8);
    assert_eq!(ch.float_usdc.0, 60 * USDC);
}

#[test]
fn rail_b_failed_mpc_call_requeues() {
    let (mut c, pid) = railb_setup();
    ctx(relayer(), 80_000);
    let _ = c.request_payout_signed(pid, U128(3_000_000_000), U128(1_000_000));
    ctx_with_result("safu.test.near".parse().unwrap(), 80_001, near_sdk::PromiseResult::Failed);
    assert!(!c.on_payout_signed(pid, 7, U128(3_000_000_000), U128(1_000_000)));
    assert_eq!(c.get_payout(pid).unwrap().status, PayoutStatus::Queued);
}

#[test]
#[should_panic(expected = "max fee above cap")]
fn rail_b_gas_price_is_capped() {
    let (mut c, pid) = railb_setup();
    ctx(relayer(), 80_000);
    let _ = c.request_payout_signed(pid, U128(10_000_000_001), U128(1));
}

#[test]
#[should_panic(expected = "tx hash does not match the signed payout tx")]
fn rail_b_mark_paid_requires_matching_hash() {
    let (mut c, pid) = railb_setup();
    ctx(relayer(), 80_000);
    let _ = c.request_payout_signed(pid, U128(3_000_000_000), U128(1_000_000));
    ctx_with_result(
        "safu.test.near".parse().unwrap(),
        80_001,
        near_sdk::PromiseResult::Successful(mpc_response(REF_R, REF_S, 1)),
    );
    c.on_payout_signed(pid, 7, U128(3_000_000_000), U128(1_000_000));
    ctx(relayer(), 90_000);
    c.mark_paid(pid, "0xdeadbeef".into());
}

#[test]
#[should_panic(expected = "payout is bound to Rail B")]
fn rail_a_blocked_after_rail_b_nonce() {
    let (mut c, pid) = railb_setup();
    ctx(relayer(), 80_000);
    let _ = c.request_payout_signed(pid, U128(3_000_000_000), U128(1_000_000));
    ctx_with_result("safu.test.near".parse().unwrap(), 80_001, near_sdk::PromiseResult::Failed);
    c.on_payout_signed(pid, 7, U128(3_000_000_000), U128(1_000_000));
    ctx(relayer(), 81_000);
    let _ = c.request_payout_intents(pid, Default::default(), "ed25519:x".into());
}

// ───────── Rail A: signed 1Click quotes ─────────
// Fixture: a live mainnet 1Click quote (testdata/oneclick_quote.json) for
// 1.6 USDC (NEAR) -> USDC on Base, recipient 0x7A69…8d0d, refundTo = the
// all-zero implicit account (so that is "this contract" in these tests).
const QUOTE: &str = include_str!("testdata/oneclick_quote.json");
const ZERO_ACCOUNT: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const NEAR_USDC: &str = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const QUOTE_NOW_MS: u64 = 1_794_638_617_875; // quote timestamp 2026-11-14T06:43:37.875Z

fn quote() -> (near_sdk::serde_json::Map<String, near_sdk::serde_json::Value>, String) {
    let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(QUOTE).unwrap();
    (v["signed_fields"].as_object().unwrap().clone(), v["signature"].as_str().unwrap().into())
}

fn ctx_at(contract: &str, predecessor: AccountId, now_ms: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract.parse().unwrap())
        .predecessor_account_id(predecessor)
        .block_timestamp(now_ms * MS);
    testing_env!(b.build());
}

/// Rugged policy whose payout (1.6 USDC) matches the fixture quote.
fn rail_a_setup(recipient: &str) -> (Safu, u64) {
    let usdc: AccountId = NEAR_USDC.parse().unwrap();
    ctx_at(ZERO_ACCOUNT, owner(), QUOTE_NOW_MS);
    let mut c = Safu::new(owner(), usdc.clone(), api(), 0, 0, mpc(), None);
    c.add_watcher(watcher());
    c.add_relayer(relayer());
    ctx_at(ZERO_ACCOUNT, usdc, QUOTE_NOW_MS);
    let _ = c.ft_on_transfer(owner(), U128(100 * USDC), "fund".into());
    ctx_at(ZERO_ACCOUNT, api(), QUOTE_NOW_MS);
    watch(&mut c, "base", "0x00000000000000000000000000000000000e2e03");
    c.register_policy(
        "base".into(), "0x00000000000000000000000000000000000e2e03".into(),
        "base".into(), "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near".into(),
        recipient.into(), U128(2 * USDC), 500, "00".into(), "ref".into(), QUOTE_NOW_MS + 86_400_000,
    );
    ctx_at(ZERO_ACCOUNT, watcher(), QUOTE_NOW_MS);
    let rid = c.report_rug("base".into(), "0x00000000000000000000000000000000000e2e03".into(), "R1".into(), vec!["x".into()]);
    ctx_at(ZERO_ACCOUNT, accounts(4), QUOTE_NOW_MS);
    let pid = c.finalize_rug(rid)[0];
    assert_eq!(c.get_payout(pid).unwrap().amount_usdc.0, 1_600_000);
    (c, pid)
}

#[test]
fn rail_a_accepts_signed_quote_and_uses_its_deposit_address() {
    let (mut c, pid) = rail_a_setup("0x7A69e5aBa08eAC068A45ddf9E1818c7d89518d0d");
    let (q, sig) = quote();
    ctx_at(ZERO_ACCOUNT, relayer(), QUOTE_NOW_MS + 60_000);
    let _ = c.request_payout_intents(pid, q, sig);
    let p = c.get_payout(pid).unwrap();
    assert_eq!(p.status, PayoutStatus::Processing);
    assert_eq!(
        p.deposit_address.unwrap().as_str(),
        "2cfd7e6cec26f47cc8ff7ad9d6df439a66dc0d942928421c5d4d95073d7c121f"
    );
}

#[test]
#[should_panic(expected = "invalid 1Click quote signature")]
fn rail_a_rejects_relayer_swapped_deposit_address() {
    let (mut c, pid) = rail_a_setup("0x7A69e5aBa08eAC068A45ddf9E1818c7d89518d0d");
    let (mut q, sig) = quote();
    q.insert("depositAddress".into(), "relayer-owned.near".into());
    ctx_at(ZERO_ACCOUNT, relayer(), QUOTE_NOW_MS + 60_000);
    let _ = c.request_payout_intents(pid, q, sig);
}

#[test]
#[should_panic(expected = "quote recipient != policy recipient")]
fn rail_a_rejects_validly_signed_quote_for_someone_else() {
    // genuine 1Click quote, but it pays a different recipient than this policy
    let (mut c, pid) = rail_a_setup("0x000000000000000000000000000000000000beef");
    let (q, sig) = quote();
    ctx_at(ZERO_ACCOUNT, relayer(), QUOTE_NOW_MS + 60_000);
    let _ = c.request_payout_intents(pid, q, sig);
}

#[test]
#[should_panic(expected = "quote must refund to this contract")]
fn rail_a_rejects_quote_refunding_elsewhere() {
    let (mut c, pid) = rail_a_setup("0x7A69e5aBa08eAC068A45ddf9E1818c7d89518d0d");
    let (q, sig) = quote();
    // same state, but executing as a different contract account
    ctx_at("safu.test.near", relayer(), QUOTE_NOW_MS + 60_000);
    let _ = c.request_payout_intents(pid, q, sig);
}

#[test]
#[should_panic(expected = "quote expired")]
fn rail_a_rejects_expired_quote() {
    let (mut c, pid) = rail_a_setup("0x7A69e5aBa08eAC068A45ddf9E1818c7d89518d0d");
    let (q, sig) = quote();
    ctx_at(ZERO_ACCOUNT, relayer(), 1_794_899_617_000); // == quote deadline
    let _ = c.request_payout_intents(pid, q, sig);
}

#[test]
#[should_panic(expected = "invalid 1Click quote signature")]
fn rail_a_key_rotation_invalidates_old_key() {
    let (mut c, pid) = rail_a_setup("0x7A69e5aBa08eAC068A45ddf9E1818c7d89518d0d");
    ctx_at(ZERO_ACCOUNT, owner(), QUOTE_NOW_MS);
    c.set_oneclick_pubkey("ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".into());
    let (q, sig) = quote();
    ctx_at(ZERO_ACCOUNT, relayer(), QUOTE_NOW_MS + 60_000);
    let _ = c.request_payout_intents(pid, q, sig);
}

// ───────── token watches ─────────

#[test]
#[should_panic(expected = "no token watch registered")]
fn policy_requires_watch() {
    let mut c = setup(1_000 * USDC);
    ctx(api(), 2_000);
    c.register_policy(
        "base-sepolia".into(), "0x0000000000000000000000000000000000000077".into(), "sol".into(),
        "nep141:sol.omft.near".into(), "r".into(), U128(USDC), 500, "00".into(), "ref".into(), 10_000_000,
    );
}

#[test]
fn watch_list_tracks_live_cover() {
    let mut c = setup(1_000 * USDC);
    register(&mut c, 10 * USDC, 2_000);
    let w = c.list_watched(None, None);
    assert_eq!(w.len(), 1);
    assert_eq!(w[0].active_policies, 1);
    assert_eq!(w[0].exposure_usdc.0, 10 * USDC);
    assert_eq!(w[0].watch.token_key, "base-sepolia:0xabcdef0000000000000000000000000000000001");
    let rid = report(&mut c, 3_000);
    assert_eq!(c.list_watched(None, None)[0].open_report_id, Some(rid));
    ctx(accounts(4), 70_000);
    c.finalize_rug(rid);
    assert!(c.list_watched(None, None).is_empty());
}

#[test]
#[should_panic(expected = "watch is locked while cover is live")]
fn watch_is_immutable_while_covered() {
    let mut c = setup(1_000 * USDC);
    register(&mut c, 10 * USDC, 2_000);
    ctx(api(), 2_500);
    c.register_token_watch(
        "base-sepolia".into(), "0xABCdef0000000000000000000000000000000001".into(),
        Holder { address: "0xother".into(), baseline: U128(1) }, vec![], 2,
    );
}

#[test]
fn prune_removes_token_from_watch_list() {
    let mut c = setup(1_000 * USDC);
    register(&mut c, 10 * USDC, 2_000); // expires 7 days later
    ctx(accounts(4), 2_000 + 8 * 24 * 3600 * 1000);
    assert_eq!(c.prune_expired("base-sepolia".into(), "0xABCdef0000000000000000000000000000000001".into()), 1);
    assert!(c.list_watched(None, None).is_empty());
}

#[test]
#[should_panic(expected = "watcher only")]
fn heartbeat_is_watcher_only() {
    let mut c = setup(0);
    ctx(accounts(4), 2_000);
    c.heartbeat();
}

// ───────── cover-only purchases (API-signed quotes) ─────────
const COVER_QUOTES: &str = include_str!("testdata/cover_quotes.json");

fn cq(name: &str) -> (String, String) {
    let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(COVER_QUOTES).unwrap();
    (v[name]["quote"].as_str().unwrap().into(), v[name]["signature"].as_str().unwrap().into())
}

fn buy_msg(quote: &str, sig: &str) -> String {
    near_sdk::serde_json::json!({ "buy_cover": { "quote": quote, "signature": sig } }).to_string()
}

/// Pool + watch on the quoted token + API key configured.
fn cover_setup() -> Safu {
    let mut c = setup(1_000 * USDC);
    ctx(api(), 1_500);
    watch(&mut c, "base-sepolia", "0xABCdef0000000000000000000000000000000001");
    ctx(owner(), 1_500);
    let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(COVER_QUOTES).unwrap();
    c.set_api_pubkey(v["pubkey"].as_str().unwrap().into());
    c
}

fn pay(c: &mut Safu, payer: &str, amount: u128, msg: String, now_ms: u64) {
    ctx(usdc(), now_ms);
    let _ = c.ft_on_transfer(payer.parse().unwrap(), U128(amount), msg);
}

#[test]
fn cover_only_purchase_creates_policy_and_books_premium() {
    let mut c = cover_setup();
    let (q, s) = cq("valid");
    pay(&mut c, "eugene.near", 500_000, buy_msg(&q, &s), 2_000);
    let p = c.get_policy(0).unwrap();
    assert_eq!(p.cover_usdc.0, 10 * USDC);
    assert_eq!(p.recipient, "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
    assert_eq!(p.buy_ref, "cover-only:n1");
    assert_eq!(p.insiders_root.len(), 64); // sha256 of the watch it was priced on
    let s = c.pool_stats();
    assert_eq!(s.available_usdc.0, 1_000 * USDC + 500_000);
    assert_eq!(s.premiums_earned_usdc.0, 500_000);
}

#[test]
#[should_panic(expected = "invalid api quote signature")]
fn cover_only_rejects_tampered_quote() {
    let mut c = cover_setup();
    let (q, s) = cq("valid");
    let tampered = q.replace("\"cover_usdc\":\"10000000\"", "\"cover_usdc\":\"90000000\"");
    pay(&mut c, "eugene.near", 500_000, buy_msg(&tampered, &s), 2_000);
}

#[test]
#[should_panic(expected = "paid amount != quoted premium")]
fn cover_only_rejects_underpayment() {
    let mut c = cover_setup();
    let (q, s) = cq("valid");
    pay(&mut c, "eugene.near", 499_999, buy_msg(&q, &s), 2_000);
}

#[test]
#[should_panic(expected = "quote already used")]
fn cover_only_rejects_replay() {
    let mut c = cover_setup();
    let (q, s) = cq("valid");
    pay(&mut c, "eugene.near", 500_000, buy_msg(&q, &s), 2_000);
    pay(&mut c, "eugene.near", 500_000, buy_msg(&q, &s), 2_100);
}

#[test]
#[should_panic(expected = "quote is for another payer")]
fn cover_only_binds_payer() {
    let mut c = cover_setup();
    let (q, s) = cq("valid");
    pay(&mut c, "mallory.near", 500_000, buy_msg(&q, &s), 2_000);
}

#[test]
#[should_panic(expected = "quote expired")]
fn cover_only_rejects_expired_quote() {
    let mut c = cover_setup();
    let (q, s) = cq("valid");
    pay(&mut c, "eugene.near", 500_000, buy_msg(&q, &s), 5_000);
}

#[test]
#[should_panic(expected = "premium inconsistent with cover and rate")]
fn cover_only_rejects_inconsistent_premium_even_if_signed() {
    let mut c = cover_setup();
    let (q, s) = cq("bad_rate");
    pay(&mut c, "eugene.near", 400_000, buy_msg(&q, &s), 2_000);
}

#[test]
#[should_panic(expected = "cover-only sales disabled")]
fn cover_only_requires_api_key() {
    let mut c = setup(1_000 * USDC);
    let (q, s) = cq("valid");
    pay(&mut c, "eugene.near", 500_000, buy_msg(&q, &s), 2_000);
}

// ───────── NEAR-direct payouts ─────────

fn near_payout_setup(recipient: &str, asset: &str) -> (Safu, u64) {
    let mut c = setup(1_000 * USDC);
    ctx(api(), 2_000);
    watch(&mut c, "near", "coin.dev.testnet");
    c.register_policy(
        "near".into(), "coin.dev.testnet".into(), "near".into(), asset.into(), recipient.into(),
        U128(10 * USDC), 500, "00".into(), "ref".into(), 10_000_000,
    );
    ctx(watcher(), 3_000);
    let rid = c.report_rug("near".into(), "coin.dev.testnet".into(), "R1".into(), vec!["x".into()]);
    ctx(accounts(4), 70_000);
    let pid = c.finalize_rug(rid)[0];
    (c, pid)
}

#[test]
fn near_direct_payout_pays_and_settles() {
    let (mut c, pid) = near_payout_setup("buyer.testnet", "nep141:usdc.test.near");
    ctx(accounts(5), 80_000); // anyone can trigger
    let _ = c.request_payout_near(pid);
    assert_eq!(c.get_payout(pid).unwrap().status, PayoutStatus::Processing);
    ctx_with_result("safu.test.near".parse().unwrap(), 80_001, near_sdk::PromiseResult::Successful(vec![]));
    assert!(c.on_payout_near(pid));
    let p = c.get_payout(pid).unwrap();
    assert_eq!(p.status, PayoutStatus::Paid);
    assert_eq!(p.rail, Some(PayoutRail::Near));
    assert_eq!(c.pool_stats().reserved_usdc.0, 0);
    assert_eq!(c.pool_stats().total_paid_out_usdc.0, 8 * USDC);
    assert!(c.list_pending_payouts(None, None).is_empty());
}

#[test]
fn near_direct_failed_transfer_requeues() {
    let (mut c, pid) = near_payout_setup("buyer.testnet", "nep141:usdc.test.near");
    ctx(accounts(5), 80_000);
    let _ = c.request_payout_near(pid);
    ctx_with_result("safu.test.near".parse().unwrap(), 80_001, near_sdk::PromiseResult::Failed);
    assert!(!c.on_payout_near(pid));
    assert_eq!(c.get_payout(pid).unwrap().status, PayoutStatus::Queued);
    assert_eq!(c.pool_stats().reserved_usdc.0, 8 * USDC);
}

#[test]
#[should_panic(expected = "NEAR-direct pays pool USDC only")]
fn near_direct_rejects_other_assets() {
    let (mut c, pid) = near_payout_setup("buyer.testnet", "nep141:wrap.near");
    let _ = c.request_payout_near(pid);
}
