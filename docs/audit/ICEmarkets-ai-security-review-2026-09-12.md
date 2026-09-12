# 🔐 Security Review — ICEmarkets on-chain programs (AI-assisted)

> **What this is.** An AI-assisted security review of the four ICEmarkets Anchor programs, run on
> 2026-09-12 against commit `cd3dba1` using the [pashov/skills](https://github.com/pashov/skills)
> auditor workflow (12 specialised hunting agents + judging gates + this report format) adapted from
> Solidity to Anchor/Solana, executed with Claude Fable 5.1.
>
> **What this is not.** It is **not** a third-party audit. No human security researcher has reviewed
> this code. AI analysis cannot establish the absence of vulnerabilities and no guarantee of security
> is given. A paid independent review, a bug bounty and on-chain monitoring are still required before
> caps are lifted (see `docs/MAINNET_RUNBOOK.md`). Fix status below refers to the commit that lands
> this document; every fix must be re-run through `anchor test` (49 tests + the ones added here) and
> the localnet money loop (`make localnet`) before deployment.

---

## Scope

|                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mode**                         | ALL (every program, every instruction)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Commit**                       | `cd3dba1` (origin/master) — Anchor 0.31.1 / Agave 4.2.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Programs**                     | peg_desk `6jMv6pdi3nB4RRmJSojDy2cHRLMgKNM3ZEeJFngWrqQN` · fee_router `9bnCKVesMxQPDaWAmiT21vaES2QgtdXinfXciTCZrbEt`<br>distributor `AEGw9dc3MUYR3aJXzZJjQmQDsJBJuT1RfsjoByNv4dV6` · buyback `2jsn1m1EnUx2AixWn8KSvWa7bqgQJrLqr2pQenzok4Lk`                                                                                                                                                                                                                                                                                                                                                              |
| **Files reviewed**               | `peg_desk/{lib,state,constants,errors,pricing,oracle}.rs` · `peg_desk/instructions/{admin,commodity,keeper,trade,sweep}.rs`<br>`fee_router/{lib,state,errors}.rs` · `fee_router/instructions/{initialize_router,register_pool,claim_dbc,claim_damm,migrate,split}.rs`<br>`distributor/{lib,state,constants,errors,merkle}.rs` · `distributor/instructions/{initialize,open_epoch,push_epoch,claim,close_epoch}.rs`<br>`buyback/{lib,state,constants,errors}.rs` · `buyback/instructions/{initialize,convert_and_burn}.rs`<br>`packages/sdk/src/{buyback,damm,dbc,meteora,pegDesk,trade}.ts` (route builders, as CPI inputs) |
| **Out of scope**                 | Meteora DBC / DAMM v2 / Jupiter v6 / Pyth / Metaplex program code · keeper and web app code (reviewed only where it sets on-chain parameters) · key management · Squads configuration                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Confidence threshold (1-100)** | 70                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Method**                       | 12 parallel hunting agents (access control, arithmetic, oracle, CPI/account validation, economic/MEV, DoS, state machine, initialization, token handling, upgradeability, keeper trust, cross-program) over a 7,508-line source bundle; every candidate was independently re-derived by a judging pass against the code before being kept; agreement count (x/12) is reported per finding.                                                                                                                                                                                                                     |

---

## Findings

[98] **1. Buyback rate anchor ratchets downward on every executed cycle, so the "price breaker" never binds**

`buyback.convert_and_burn` · Confidence: 98 · agreement 12/12 · **Fixed** (F-01)

**Description**
`next_anchor` moved the anchor by `anchor_move_bps` *towards* the executed rate in both directions, so a keeper (or anyone who can shape the route) could walk the ICE-per-USDC anchor down 2 % per cycle until any dump-into-thin-liquidity route passed `min_rate`; the breaker only ever bounded the *step*, never the level.

**Fix**

```diff
- let step = anchor * move_bps / BPS; if rate > anchor { anchor + step } else { anchor - step }
+ // anchor only ever moves UP automatically (by ≤ move_bps, floor 1); downward repricing is admin set_params
+ if rate <= anchor { return anchor; }
+ let step = ((anchor as u128 * move_bps as u128 / BPS_DENOM as u128) as u64).max(1);
+ anchor.saturating_add(step).min(rate)
```
---

[97] **2. Zero anchor on the first cycle disables the breaker entirely; `max_per_cycle_usdc = 0` means unlimited**

`buyback.initialize` / `buyback.set_params` / `buyback.convert_and_burn` · Confidence: 97 · agreement 12/12 · **Fixed** (F-02)

**Description**
`ice_per_usdc_anchor = 0` was documented as "let the first cycle set it", so the very first cycle after deploy (and after any admin reset to 0) accepted *any* rate and then anchored to it; combined with `max_per_cycle_usdc = 0 → unlimited` the whole buyback vault could be routed through a manipulated pool in one transaction.

**Fix**

```diff
+ require!(args.ice_per_usdc_anchor > 0, BuybackError::Unanchored);
+ require!(args.max_per_cycle_usdc > 0, BuybackError::CycleCapUnset);   // initialize AND set_params
+ // handler: require!(st.ice_per_usdc_anchor > 0, Unanchored); require!(st.max_per_cycle_usdc > 0, CycleCapUnset);
```
`scripts/create-ice-localnet.ts` now derives the initial anchor from the pool spot price (−1 % fee); mainnet ops set it from the stonk.fun / Raydium quote (`BUYBACK_ANCHOR`).
---

[95] **3. `usdc_spent` is unbounded below: a route that spends 0 (or dust) leaves the sale proceeds stranded in a PDA ATA and still "succeeds"**

`buyback.convert_and_burn` · Confidence: 95 · agreement 11/12 · **Fixed** (F-03)

**Description**
The handler measured `usdc_spent = usdc_pre_swap − usdc_post_swap` but never compared it with the USDC the peg-desk sell produced, so a keeper could pass a route that swaps 1 lamport, burn ~0 ICE, and strand the rest in `bb_usdc` (owned by the `bb_auth` PDA with no withdrawal path — funds permanently locked, and the cycle still emitted a success event).

**Fix**

```diff
+ let min_spend = usdc_out * (BPS − MIN_SPEND_TOLERANCE_BPS) / BPS  (min 1)     // 100 bps
+ require!(usdc_spent >= min_spend, BuybackError::UsdcUnderspent);
+ require!(usdc_spent <= usdc_pre_swap && usdc_spent <= st.max_per_cycle_usdc, ...);
+ // new admin ix `sweep_work_account(amount)` moves residue from any bb_auth ATA to an admin-owned account
```
The keeper sizes the fixed route amount at ≤ 0.9 % under the expected sell output so honest cycles pass.
---

[92] **4. Rate computed with `usdc_spent.max(1)` turns a zero-spend cycle into an astronomically good rate**

`buyback.convert_and_burn` · Confidence: 92 · agreement 11/12 · **Fixed** (F-04)

**Description**
`rate = ice_out × 1e6 / usdc_spent.max(1)` returned `ice_out × 1e6` when nothing was spent, which passed `min_rate` trivially and (with F-01) pushed the anchor to a nonsensical value; the fudge masked the F-03 condition instead of failing it.

**Fix**

```diff
- let rate = ice_out * USDC_UNIT / (usdc_spent as u128).max(1);
+ let rate = rate_per_usdc(ice_out, usdc_spent).ok_or(BuybackError::MathOverflow)?;  // None when usdc_spent == 0
+ require!(rate > 0, BuybackError::RateBelowAnchor);
```
---

[94] **5. Keeper price rate-limit and max-move are enforced against the keeper-supplied `publish_time`, and the default interval is 0**

`peg_desk.keeper_update_price` · Confidence: 94 · agreement 12/12 · **Fixed** (F-05)

**Description**
`min_interval` was checked as `publish_time − kp.publish_time`, a value the keeper itself supplies, and `DEFAULT_MIN_INTERVAL` was 0 with `set_keeper_bounds` never called by any script — so a compromised or buggy keeper could post an unbounded number of ±5 % moves in one slot (each stamped one second apart) and move a KeeperSigned/Switchboard-kind price arbitrarily far in a single block, defeating `max_move_bps` and feeding the trade path a fabricated price.

**Fix**

```diff
+ pub last_update_ts: i64,                      // KeeperPrice — validator clock of the last accepted post
- DEFAULT_MIN_INTERVAL: u32 = 0;
+ DEFAULT_MIN_INTERVAL: u32 = 30;
+ require!(publish_time >= 0 && publish_time > kp.publish_time, OracleNotMonotonic);   // strict
+ require!(now − kp.last_update_ts >= kp.min_interval.max(1), TooSoon);               // chain time
+ set_keeper_bounds: require!(min_interval >= 1, InvalidParams);
```
**Layout change:** `KeeperPrice` grew by 8 bytes — existing devnet/localnet KeeperPrice accounts must be re-created (`make localnet`; devnet re-seed) before the upgraded program is used.
---

[93] **6. Price-deviation breaker re-anchors on every trade and keys its window to oracle time, so a sequence of small trades walks the anchor anywhere**

`peg_desk.buy` / `peg_desk.sell` · Confidence: 93 · agreement 12/12 · **Fixed** (F-06)

**Description**
The breaker compared the new oracle read with `last_price` (updated by *every* trade) and reset the window on the oracle's `publish_time`, so an attacker interleaving dust trades with each ±max_deviation oracle step could ratchet the accepted price by `max_deviation_bps` per trade with no time cost, and a keeper could bypass the window by stamping publish times.

**Fix**

```diff
+ pub anchor_price: u64, pub anchor_ts: i64          // Commodity — fixed for a whole window, set on validator clock
+ deviation_ok(price, anchor, anchor_ts, now, max_dev, window): allowed = max_dev × min(elapsed/window + 1, 20)
+ should_reanchor(...) only after a full window has elapsed; admin `clear_price_anchor` zeroes the anchor
```
---

[90] **7. Buyback-exempt sells still consume the public daily-redeem window**

`peg_desk.sell` · Confidence: 90 · agreement 10/12 · **Fixed** (F-07)

**Description**
The `redeem_cap_exempt` signer skipped the cap *check* but its volume was still added to `window_redeemed`, so every buyback cycle ate ordinary users' redemption capacity and, at the guarded-launch 10 % caps, could deny redemptions for the rest of the day.

**Fix**

```diff
- window_add(&mut c.window_redeemed, usdc_out)
+ window_add(&mut c.window_redeemed, if exempt { 0 } else { usdc_out })
```
---

[85] **8. Gross (not net) daily caps make a cheap wash-trade DoS of a market possible**

`peg_desk.buy` / `peg_desk.sell` · Confidence: 85 · agreement 9/12 · **Fixed** (F-08)

**Description**
`window_minted` only ever grew, so an attacker could buy up to the cap and immediately sell back (paying only the spread — ~US$140/day at launch parameters) to lock a market for all other users until the window rolled.

**Fix**

```diff
+ buy:  window_release(&mut c.window_redeemed, usdc_in);  window_add(&mut c.window_minted, coin_out)
+ sell: window_release(&mut c.window_minted, coin_in);    window_add(&mut c.window_redeemed, usdc_out)   // net flow
```
---

[88] **9. Singleton `initialize*` instructions can be front-run: whoever lands the first transaction becomes admin**

`peg_desk.initialize_config` · `fee_router.initialize_router` · `distributor.initialize` · `buyback.initialize` · Confidence: 88 · agreement 11/12 · **Fixed** (F-09)

**Description**
Each program's global config PDA is created by an unpermissioned `initialize` whose `payer` becomes `admin`; on mainnet the deploy and the init are separate transactions, so a mempool-watching bot could initialise the freshly-deployed program with itself as admin/treasury and the team would have to redeploy at a new program id.

**Fix**

```diff
+ /// CHECK: this program's executable account
+ #[account(address = crate::ID)] pub program: UncheckedAccount<'info>,
+ /// CHECK: ProgramData PDA, validated in the handler
+ pub program_data: UncheckedAccount<'info>,
+ require_upgrade_authority(program, program_data, payer)?;   // skipped for non-upgradeable loaders (localnet genesis)
```
Tests, SDK (`programDataPda`) and every init script pass the two accounts.
---

[80] **10. Distributor keeper can drain the holder vault into an epoch nobody can claim**

`distributor.open_epoch` / `distributor.push_epoch` · Confidence: 80 · agreement 10/12 · **Mitigated (ops), not fixed in code** (F-10)

**Description**
A keeper key can open an epoch with an arbitrary Merkle root (e.g. one leaf to itself) and push up to `max_push_per_epoch_bps` of the holder vault into it; the design accepts keeper trust for payouts, but with `max_push_per_epoch_bps = 10_000` (the value `init-programs.ts` sets) a single compromised keeper key empties the vault in one epoch.

**Mitigation (runbook §6)**: launch with `max_push_per_epoch_bps ≤ 2_000`; keeper key lives only in Fly secrets; admin (Squads) can `pause` and rotate keepers; alerting on `EpochOpened` with an unexpected root. A code fix (epoch root time-lock + admin veto window) is queued for v1.1 and is a condition for lifting the guarded-launch caps.
---

[78] **11. `open_epoch.end_ts` is unbounded, so an epoch can be opened for the far past or the future**

`distributor.open_epoch` · Confidence: 78 · agreement 8/12 · **Fixed** (L-03)

**Description**
`end_ts` was not checked against the clock, letting a keeper open epochs whose TWAB window is in the future (claims computed on data that does not exist yet) or arbitrarily old (stale snapshot).

**Fix**

```diff
+ require!(end_ts <= now && end_ts >= now − MAX_EPOCH_AGE_SECS /* 30 d */, DistError::InvalidWindow);
```
---

[62] **12. Global `pause` does not block keeper oracle posts**

`peg_desk.keeper_update_price` · Confidence: 62 · agreement 5/12 · Not fixed (accepted)

**Description**
`global_pause` halts trades but keeper posts continue, so a paused market's `KeeperPrice` can drift during an incident; harmless while paused (no trades read it) but the first trade after un-pause consumes whatever was posted — the deviation breaker (F-06 fix) now bounds that.
---

[58] **13. `claim_damm` assumes the pool's token order (quote/base) from account position rather than reading `Pool.token_a_mint`**

`fee_router.claim_damm` · Confidence: 58 · agreement 4/12 · Not fixed (lead promoted; see Leads)

**Description**
If a DAMM v2 pool were registered with mints in the opposite order the split would be applied to the wrong token; every pool is created by the team's own migration path so the order is fixed in practice, but the check is cheap.
---

Findings List

| #  | Confidence | Title                                                                              | Status                 |
|----|------------|------------------------------------------------------------------------------------|------------------------|
| 1  | [98]       | Buyback anchor ratchets downward; breaker never binds                              | Fixed                  |
| 2  | [97]       | Zero anchor / zero cap disables the buyback breaker                                | Fixed                  |
| 3  | [95]       | Under-spent route strands sale proceeds in a PDA ATA                               | Fixed + `sweep_work_account` |
| 4  | [92]       | `usdc_spent.max(1)` rate fudge                                                     | Fixed                  |
| 5  | [94]       | Keeper rate-limit on keeper-supplied time; default interval 0                      | Fixed (layout change)  |
| 6  | [93]       | Deviation breaker re-anchors per trade, window on oracle time                      | Fixed (layout change)  |
| 7  | [90]       | Exempt sells consume the public redeem window                                      | Fixed                  |
| 8  | [85]       | Gross daily caps enable wash-trade DoS                                             | Fixed (net flow)       |
| 9  | [88]       | `initialize*` front-run makes the first caller admin                               | Fixed                  |
| 10 | [80]       | Distributor keeper can drain holder vault into an unclaimable epoch                | Mitigated (ops); code fix v1.1 |
| 11 | [78]       | `open_epoch.end_ts` unbounded                                                      | Fixed                  |
| 12 | [62]       | Pause does not block keeper posts                                                  | Accepted               |
| 13 | [58]       | `claim_damm` token-order assumption                                                | Open (lead)            |

---

## Leads

_Vulnerability trails with concrete code smells where the full exploit path could not be completed in one analysis pass. These are not false positives — they are high-signal leads for manual review. Not scored._

- **DAMM v2 token order** — `fee_router.claim_damm` — Code smells: quote/base inferred from account position — Read `Pool.token_a_mint` (offset pinned in `meteoraLayout.test.ts`) and assert it matches `PoolEntry.quote_mint` before splitting.
- **i64 arithmetic in keeper elapsed-time** — `peg_desk.keeper_update_price` — Code smells: `now − last` on i64 without checked ops — With `last_update_ts` now validator-set the subtraction cannot overflow in practice; `checked_sub` would make that explicit.
- **Composite legs vs. closed status** — `peg_desk.oracle::read_composite` — Code smells: leg read allowed while the leg is `Closed` but the index is `Open` — A composite can quote at open spreads while every leg is sell-only; consider requiring `min(leg status)` for the composite's effective status.
- **Pyth partial verification** — `peg_desk.oracle::read_pyth` — Code smells: `pyth_min_signatures` accepts `VerificationLevel::Partial` — Keep at 0 (Full) on mainnet; the registry defaults already do.
- **Switchboard-kind == keeper trust** — `peg_desk.keeper_update_price` — Code smells: `OracleKind::Switchboard` is written by the keeper relay, not by Switchboard — Every Switchboard-kind coin has keeper-grade trust until the on-demand pull feed replaces the relay; the F-05/F-06 bounds are the only on-chain limit.
- **Single-step admin rotation** — `fee_router.set_params` · `distributor.set_params` · `buyback.set_params` — Code smells: `new_admin` applied immediately (peg_desk uses `pending_admin` + accept) — A typo in the Squads transfer bricks admin; `transfer-authority.ts` mitigates with `CONFIRM_NEW_AUTHORITY` but a two-step on-chain accept is the durable fix.
- **Non-atomic deploy + initialize** — all programs — Code smells: separate transactions — F-09 closes the admin takeover; ops should still bundle deploy → init → `transfer-authority` in one session with the upgrade authority held by a fresh key.

---

## Verification status

| Check                                                   | Status at report time                                     |
|---------------------------------------------------------|-----------------------------------------------------------|
| Pure-Rust unit tests (`pricing.rs`, buyback math)       | Pass (standalone `rustc --test` in the review environment) |
| `anchor build && anchor test` (49 + new tests)          | **Pending** — must run on the build machine after this commit |
| Localnet money loop (`make localnet`)                   | **Pending** — KeeperPrice/Commodity layout changed; re-seed required |
| Devnet re-deploy + `make smoke`                         | **Pending**                                               |
| Independent human review                                | **Not performed**                                         |

---

> ⚠️ This review was performed by an AI assistant (Claude Fable 5.1 running the pashov/skills auditor workflow adapted to Anchor). AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. Team security reviews, bug bounty programs, and on-chain monitoring are strongly recommended. The pashov/skills methodology is by Pashov Audit Group — for a consultation regarding your project's security, visit [https://www.pashov.com](https://www.pashov.com). Pashov Audit Group did not perform or endorse this review.
