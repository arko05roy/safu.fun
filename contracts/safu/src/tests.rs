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

fn ctx(predecessor: AccountId, now_ms: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id("safu.test.near".parse().unwrap())
        .predecessor_account_id(predecessor)
        .block_timestamp(now_ms * MS);
    testing_env!(b.build());
}

fn setup(pool: u128) -> Safu {
    ctx(owner(), 1_000);
    let mut c = Safu::new(owner(), usdc(), api(), 60_000, 0);
    c.add_watcher(watcher());
    c.add_relayer(relayer());
    if pool > 0 {
        ctx(usdc(), 1_000);
        let _ = c.ft_on_transfer(owner(), U128(pool), "fund".into());
    }
    c
}

fn register(c: &mut Safu, cover: u128, now_ms: u64) -> u64 {
    ctx(api(), now_ms);
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
    let mut c = Safu::new(owner(), usdc(), api(), 60_000, 600_000); // 10 min wait
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
    let _ = c.request_payout_intents(ids[0], "abc.near".parse().unwrap());
}
