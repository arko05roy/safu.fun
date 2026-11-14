//! On-chain verification of NEAR Intents 1Click quotes (Rail A).
//!
//! 1Click signs every quote with its manager key. The signed message is
//!   base58( sha256( stable_json({ ...requestFields, ...quoteFields, timestamp }) ) )
//! as UTF-8 text, where `stable_json` is compact JSON with keys sorted and
//! undefined fields omitted — see `verifyQuoteSignature` in
//! github.com/defuse-protocol/one-click-sdk-typescript (src/quote-signature.ts).
//!
//! The relayer passes that exact field object + signature; the contract
//! re-canonicalizes it, verifies the signature, then checks that the quote
//! pays *this payout's* asset/amount/recipient and refunds to this contract.
//! The deposit address USDC is sent to is taken from the signed quote — the
//! relayer can no longer redirect Rail A funds.

use near_sdk::serde_json::{Map, Value};
use near_sdk::{bs58, env};

/// 1Click manager public key (`ONE_CLICK_MANAGER_PUB_KEY` in the official SDK).
pub const DEFAULT_ONECLICK_PUBKEY: &str = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

fn decode_ed25519<const N: usize>(s: &str) -> Option<[u8; N]> {
    let raw = s.strip_prefix("ed25519:").unwrap_or(s);
    bs58::decode(raw).into_vec().ok()?.try_into().ok()
}

pub fn parse_pubkey(s: &str) -> Option<[u8; 32]> {
    decode_ed25519::<32>(s)
}

/// Compact JSON with top-level keys sorted (json-stable-stringify). The signed
/// object is flat, so values are serialized as-is.
fn canonical_json(fields: &Map<String, Value>) -> String {
    let mut keys: Vec<&String> = fields.keys().collect();
    keys.sort();
    let mut out = String::from("{");
    for (i, k) in keys.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&Value::String((*k).clone()).to_string());
        out.push(':');
        out.push_str(&fields[*k].to_string());
    }
    out.push('}');
    out
}

pub fn verify_quote_signature(fields: &Map<String, Value>, signature: &str, pubkey: &[u8; 32]) -> bool {
    let Some(sig) = decode_ed25519::<64>(signature) else {
        return false;
    };
    let hash = env::sha256_array(canonical_json(fields).as_bytes());
    let message = bs58::encode(hash).into_string();
    env::ed25519_verify(&sig, message.as_bytes(), pubkey)
}

pub fn str_field<'a>(fields: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    fields.get(key).and_then(Value::as_str)
}

/// Parse `YYYY-MM-DDTHH:MM:SS[.fff]Z` into unix milliseconds.
pub fn parse_iso_ms(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' || *b.last()? != b'Z' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, se) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let ms = if b[19] == b'.' { num(20..23).unwrap_or(0) } else { 0 };
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 60 {
        return None;
    }
    // days_from_civil (Howard Hinnant)
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
    let yoe = y2 - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let total = ((days * 24 + h) * 60 + mi) * 60 + se;
    u64::try_from(total * 1000 + ms).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::serde_json;

    pub const VECTOR: &str = include_str!("testdata/oneclick_quote.json");

    fn vector() -> (Map<String, Value>, String) {
        let v: Value = serde_json::from_str(VECTOR).unwrap();
        (
            v["signed_fields"].as_object().unwrap().clone(),
            v["signature"].as_str().unwrap().to_string(),
        )
    }

    #[test]
    fn verifies_live_1click_quote() {
        let (f, sig) = vector();
        let pk = parse_pubkey(DEFAULT_ONECLICK_PUBKEY).unwrap();
        assert!(verify_quote_signature(&f, &sig, &pk));
    }

    #[test]
    fn verifies_second_live_quote_usdc_to_sol() {
        let v: Value = serde_json::from_str(include_str!("testdata/oneclick_quote_sol.json")).unwrap();
        let pk = parse_pubkey(DEFAULT_ONECLICK_PUBKEY).unwrap();
        assert!(verify_quote_signature(
            v["signed_fields"].as_object().unwrap(),
            v["signature"].as_str().unwrap(),
            &pk
        ));
    }

    #[test]
    fn rejects_tampered_deposit_address() {
        let (mut f, sig) = vector();
        f.insert("depositAddress".into(), Value::String("attacker.near".into()));
        let pk = parse_pubkey(DEFAULT_ONECLICK_PUBKEY).unwrap();
        assert!(!verify_quote_signature(&f, &sig, &pk));
    }

    #[test]
    fn iso_parse() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_iso_ms("2026-11-17T07:13:37.000Z"), Some(1_794_899_617_000));
        assert_eq!(parse_iso_ms("2000-02-29T12:00:00Z"), Some(951_825_600_000));
        assert_eq!(parse_iso_ms("garbage"), None);
    }
}
