//! Exact `a * b / c` for u128 operands via a 256-bit intermediate.
//! Share/reward math multiplies two 18-decimal quantities (≈1e20 × 1e21),
//! which overflows u128, so every such product goes through here.

/// 128×128 → 256-bit product as (hi, lo).
fn mul_wide(a: u128, b: u128) -> (u128, u128) {
    const M: u128 = u64::MAX as u128;
    let (a1, a0) = (a >> 64, a & M);
    let (b1, b0) = (b >> 64, b & M);
    let p00 = a0 * b0;
    let p01 = a0 * b1;
    let p10 = a1 * b0;
    let p11 = a1 * b1;
    let mid = (p00 >> 64) + (p01 & M) + (p10 & M);
    let lo = (p00 & M) | (mid << 64);
    let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
    (hi, lo)
}

/// floor(a * b / c). Panics if c == 0 or the result exceeds u128.
pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    assert!(c != 0, "mul_div by zero");
    let (hi, lo) = mul_wide(a, b);
    if hi == 0 {
        return lo / c;
    }
    assert!(hi < c, "mul_div overflow");
    // 256-by-128 long division, one bit at a time (remainder stays < c).
    let (mut rem, mut q) = (hi, 0u128);
    for i in (0..128).rev() {
        let carry = rem >> 127;
        rem = (rem << 1) | ((lo >> i) & 1);
        q <<= 1;
        if carry == 1 || rem >= c {
            rem = rem.wrapping_sub(c);
            q |= 1;
        }
    }
    q
}

#[cfg(test)]
mod tests {
    use super::mul_div;

    #[test]
    fn small_values_match_native() {
        assert_eq!(mul_div(7, 9, 4), 15);
        assert_eq!(mul_div(0, u128::MAX, 3), 0);
        assert_eq!(mul_div(u128::MAX, 1, 1), u128::MAX);
    }

    #[test]
    fn large_products_are_exact() {
        let safu = 10u128.pow(18);
        // 100 SAFU of shares × 1000 SAFU staked / 400 SAFU of shares
        assert_eq!(mul_div(100 * safu, 1_000 * safu, 400 * safu), 250 * safu);
        assert_eq!(mul_div(u128::MAX, u128::MAX, u128::MAX), u128::MAX);
        assert_eq!(mul_div(u128::MAX, 3, 4), u128::MAX / 4 * 3 + 2); // (2^128-1)*3/4
        let x = 340_282_366_920_938_463_463_374_607_431_768_211_455u128; // u128::MAX
        assert_eq!(mul_div(x, x - 1, x), x - 1);
    }

    #[test]
    #[should_panic(expected = "mul_div overflow")]
    fn overflow_panics() {
        mul_div(u128::MAX, u128::MAX, 1);
    }
}
