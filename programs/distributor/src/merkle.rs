//! Merkle verification — must match tests/merkle.ts (shared with apps/keeper).
//! leaf = keccak256(epoch || wallet || amount_le_u64); parent = keccak256(min(a,b) || max(a,b)).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;

pub fn leaf(epoch: &Pubkey, wallet: &Pubkey, amount: u64) -> [u8; 32] {
    let amount_le = amount.to_le_bytes();
    keccak::hashv(&[
        &epoch.to_bytes()[..],
        &wallet.to_bytes()[..],
        &amount_le[..],
    ])
    .to_bytes()
}

pub fn hash_pair(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    if a <= b {
        keccak::hashv(&[&a[..], &b[..]]).to_bytes()
    } else {
        keccak::hashv(&[&b[..], &a[..]]).to_bytes()
    }
}

pub fn verify(proof: &[[u8; 32]], root: &[u8; 32], leaf: [u8; 32]) -> bool {
    let mut computed = leaf;
    for node in proof.iter() {
        computed = hash_pair(&computed, node);
    }
    computed == *root
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_leaf_tree() {
        let e = Pubkey::new_unique();
        let w1 = Pubkey::new_unique();
        let w2 = Pubkey::new_unique();
        let l1 = leaf(&e, &w1, 10);
        let l2 = leaf(&e, &w2, 20);
        let root = hash_pair(&l1, &l2);
        assert!(verify(&[l2], &root, l1));
        assert!(verify(&[l1], &root, l2));
        assert!(!verify(&[l1], &root, leaf(&e, &w2, 21)));
    }
}
