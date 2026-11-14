//! Minimal on-chain EVM transaction builder for Rail B payouts.
//!
//! The contract — not the relayer — decides what gets signed: an EIP-1559
//! transaction calling `transfer(recipient, amount)` on the chain's
//! configured USDC token, from the contract's Chain Signatures address.
//! The relayer only supplies gas prices (capped) and broadcasts.

use near_sdk::env;

/// RLP-encode a byte string.
fn rlp_bytes(out: &mut Vec<u8>, b: &[u8]) {
    if b.len() == 1 && b[0] < 0x80 {
        out.push(b[0]);
    } else {
        rlp_len_prefix(out, b.len(), 0x80);
        out.extend_from_slice(b);
    }
}

fn rlp_len_prefix(out: &mut Vec<u8>, len: usize, offset: u8) {
    if len < 56 {
        out.push(offset + len as u8);
    } else {
        let be = trim_leading_zeros(&(len as u64).to_be_bytes()).to_vec();
        out.push(offset + 55 + be.len() as u8);
        out.extend_from_slice(&be);
    }
}

/// RLP-encode an unsigned integer (big-endian, no leading zeros; 0 = empty string).
fn rlp_uint(out: &mut Vec<u8>, v: u128) {
    rlp_bytes(out, trim_leading_zeros(&v.to_be_bytes()));
}

fn rlp_list(out: &mut Vec<u8>, payload: &[u8]) {
    rlp_len_prefix(out, payload.len(), 0xc0);
    out.extend_from_slice(payload);
}

fn trim_leading_zeros(b: &[u8]) -> &[u8] {
    let i = b.iter().position(|x| *x != 0).unwrap_or(b.len());
    &b[i..]
}

pub fn parse_address(s: &str) -> Option<[u8; 20]> {
    let h = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X"))?;
    let v = hex_decode(h)?;
    v.try_into().ok()
}

pub fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

pub fn hex_encode(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push(H[(x >> 4) as usize] as char);
        s.push(H[(x & 0xf) as usize] as char);
    }
    s
}

/// ABI calldata for ERC-20 `transfer(address,uint256)`.
pub fn erc20_transfer_data(to: &[u8; 20], amount: u128) -> Vec<u8> {
    let mut d = Vec::with_capacity(68);
    d.extend_from_slice(&[0xa9, 0x05, 0x9c, 0xbb]);
    d.extend_from_slice(&[0u8; 12]);
    d.extend_from_slice(to);
    d.extend_from_slice(&[0u8; 16]);
    d.extend_from_slice(&amount.to_be_bytes());
    d
}

#[derive(Clone, Debug)]
pub struct Eip1559Tx {
    pub chain_id: u64,
    pub nonce: u64,
    pub max_priority_fee_per_gas: u128,
    pub max_fee_per_gas: u128,
    pub gas_limit: u64,
    pub to: [u8; 20],
    pub value: u128,
    pub data: Vec<u8>,
}

impl Eip1559Tx {
    fn fields(&self, out: &mut Vec<u8>) {
        rlp_uint(out, self.chain_id as u128);
        rlp_uint(out, self.nonce as u128);
        rlp_uint(out, self.max_priority_fee_per_gas);
        rlp_uint(out, self.max_fee_per_gas);
        rlp_uint(out, self.gas_limit as u128);
        rlp_bytes(out, &self.to);
        rlp_uint(out, self.value);
        rlp_bytes(out, &self.data);
        rlp_list(out, &[]); // empty access list
    }

    /// `0x02 || rlp([chainId, nonce, …, accessList])`
    pub fn unsigned_bytes(&self) -> Vec<u8> {
        let mut payload = Vec::new();
        self.fields(&mut payload);
        let mut out = vec![0x02];
        rlp_list(&mut out, &payload);
        out
    }

    /// keccak256 of the unsigned envelope — the payload the MPC signs.
    pub fn signing_hash(&self) -> [u8; 32] {
        env::keccak256_array(&self.unsigned_bytes())
    }

    /// `0x02 || rlp([…, yParity, r, s])` — ready for `eth_sendRawTransaction`.
    pub fn signed_bytes(&self, y_parity: u8, r: &[u8; 32], s: &[u8; 32]) -> Vec<u8> {
        let mut payload = Vec::new();
        self.fields(&mut payload);
        rlp_uint(&mut payload, y_parity as u128);
        rlp_bytes(&mut payload, trim_leading_zeros(r));
        rlp_bytes(&mut payload, trim_leading_zeros(s));
        let mut out = vec![0x02];
        rlp_list(&mut out, &payload);
        out
    }
}

/// Recover the signer's EVM address from a 32-byte hash and (r, s, v).
pub fn recover_address(hash: &[u8; 32], r: &[u8; 32], s: &[u8; 32], v: u8) -> Option<[u8; 20]> {
    let mut sig = [0u8; 64];
    sig[..32].copy_from_slice(r);
    sig[32..].copy_from_slice(s);
    let pk = env::ecrecover(hash, &sig, v, true)?;
    let h = env::keccak256_array(&pk);
    let mut a = [0u8; 20];
    a.copy_from_slice(&h[12..]);
    Some(a)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reference vector generated with viem 2.21 (serializeTransaction / signTransaction)
    // using the well-known test key 0x4c0883a6…f362318.
    fn h(s: &str) -> Vec<u8> {
        hex_decode(s.trim_start_matches("0x")).unwrap()
    }

    fn tx() -> Eip1559Tx {
        Eip1559Tx {
            chain_id: 84532,
            nonce: 7,
            max_priority_fee_per_gas: 1_000_000,
            max_fee_per_gas: 3_000_000_000,
            gas_limit: 100_000,
            to: parse_address("0x036CbD53842c5426634e7929541eC2318f3dCF7e").unwrap(),
            value: 0,
            data: erc20_transfer_data(
                &parse_address("0x00000000000000000000000000000000000b0b01").unwrap(),
                40_000_000,
            ),
        }
    }

    #[test]
    fn matches_viem_unsigned_hash_and_signed() {
        let t = tx();
        assert_eq!(t.data, h("0xa9059cbb00000000000000000000000000000000000000000000000000000000000b0b010000000000000000000000000000000000000000000000000000000002625a00"));
        assert_eq!(t.unsigned_bytes(), h("0x02f86f83014a3407830f424084b2d05e00830186a094036cbd53842c5426634e7929541ec2318f3dcf7e80b844a9059cbb00000000000000000000000000000000000000000000000000000000000b0b010000000000000000000000000000000000000000000000000000000002625a00c0"));
        assert_eq!(t.signing_hash().to_vec(), h("0xf635a1d3eb3da2a217941b51e2e48c30106ea1829903b55328486883af5ad287"));
        let r: [u8; 32] = h("0xb72a6fad9a0217e3fc59b17d4f21daf25942c1f5a8ff7bcf8f431e03397500dc").try_into().unwrap();
        let s: [u8; 32] = h("0x79b1f1de3440b50fb4d4e694b731a26f5510348e9c2174f990b11f24ba90ac61").try_into().unwrap();
        assert_eq!(t.signed_bytes(1, &r, &s), h("0x02f8b283014a3407830f424084b2d05e00830186a094036cbd53842c5426634e7929541ec2318f3dcf7e80b844a9059cbb00000000000000000000000000000000000000000000000000000000000b0b010000000000000000000000000000000000000000000000000000000002625a00c001a0b72a6fad9a0217e3fc59b17d4f21daf25942c1f5a8ff7bcf8f431e03397500dca079b1f1de3440b50fb4d4e694b731a26f5510348e9c2174f990b11f24ba90ac61"));
        assert_eq!(
            recover_address(&t.signing_hash(), &r, &s, 1).unwrap(),
            parse_address("0x2c7536E3605D9C16a7a3D7b1898e529396a65c23").unwrap()
        );
    }
}
