//! Commodity lifecycle: create_commodity, set_commodity_params, set_feed_account, set_status,
//! set_index_legs.

use anchor_lang::prelude::*;
use anchor_spl::metadata::{
    create_metadata_accounts_v3, mpl_token_metadata::types::DataV2, CreateMetadataAccountsV3,
    Metadata,
};
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::PegDeskError;
use crate::events::{CommodityCreated, ParamsUpdated, StatusChanged};
use crate::instructions::admin::{is_admin, is_keeper, require_admin, require_admin_or_keeper};
use crate::oracle::load_commodity;
use crate::state::*;

// ---- create_commodity ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateCommodityArgs {
    /// ASCII A-Z0-9, right-padded with 0u8 to 12 bytes.
    pub symbol: [u8; 12],
    pub oracle_kind: u8,
    pub session_kind: u8,
    pub feed_id: [u8; 32],
    /// PythPull: PriceUpdateV2 account; Switchboard (stand-in): KeeperPrice PDA; else default.
    pub feed_account: Pubkey,
    pub fx_feed_id: [u8; 32],
    pub fx_feed_account: Pubkey,
    pub quote_scale: u8,
    pub base_spread_bps: u16,
    pub closed_spread_bps: u16,
    pub conf_mult_bps: u16,
    pub max_age_open: u32,
    pub max_age_closed: u32,
    pub supply_cap: u64,
    pub per_tx_cap: u64,
    /// 0 = require fully verified Pyth updates.
    pub pyth_min_signatures: u8,
    /// Metaplex name (≤ 32 bytes) and uri (≤ 200 bytes).
    pub name: String,
    pub uri: String,
}

// NOTE: field order matters — Anchor initialises `init` accounts in declaration order, so every
// account referenced by an `init` constraint is declared above it.
#[derive(Accounts)]
#[instruction(args: CreateCommodityArgs)]
pub struct CreateCommodity<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Must be `config.admin`; becomes Metaplex update authority.
    pub admin: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ PegDeskError::Unauthorized,
        has_one = reserve_mint @ PegDeskError::InvalidParams
    )]
    pub config: Box<Account<'info, GlobalConfig>>,

    /// CHECK: PDA `["mint_auth"]`, holds no data; mint authority of every COIN.
    #[account(seeds = [MINT_AUTH_SEED], bump)]
    pub mint_auth: UncheckedAccount<'info>,

    pub reserve_mint: Box<Account<'info, Mint>>,

    pub token_program: Program<'info, Token>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    #[account(
        init,
        payer = payer,
        space = 8 + Commodity::INIT_SPACE,
        seeds = [COMMODITY_SEED, args.symbol.as_ref()],
        bump
    )]
    pub commodity: Box<Account<'info, Commodity>>,

    /// Fresh keypair (signs the tx). Freeze authority is left as None.
    #[account(
        init,
        payer = payer,
        mint::decimals = COIN_DECIMALS,
        mint::authority = mint_auth
    )]
    pub coin_mint: Box<Account<'info, Mint>>,

    /// USDC vault, PDA `["reserve", commodity]`, authority = commodity PDA.
    #[account(
        init,
        payer = payer,
        seeds = [RESERVE_SEED, commodity.key().as_ref()],
        bump,
        token::mint = reserve_mint,
        token::authority = commodity
    )]
    pub reserve_vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: Metaplex metadata PDA, created by the CPI below; address pinned by seeds.
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), coin_mint.key().as_ref()],
        bump,
        seeds::program = token_metadata_program.key()
    )]
    pub metadata: UncheckedAccount<'info>,
}

fn validate_market_params(
    base_spread_bps: u16,
    closed_spread_bps: u16,
    max_age_open: u32,
    max_age_closed: u32,
    supply_cap: u64,
    per_tx_cap: u64,
) -> Result<()> {
    require!(
        base_spread_bps <= MAX_SPREAD_BPS && closed_spread_bps <= MAX_SPREAD_BPS,
        PegDeskError::InvalidParams
    );
    require!(
        max_age_open > 0 && max_age_closed > 0,
        PegDeskError::InvalidParams
    );
    require!(per_tx_cap <= supply_cap, PegDeskError::InvalidParams);
    Ok(())
}

pub fn handle_create_commodity(
    ctx: Context<CreateCommodity>,
    args: CreateCommodityArgs,
) -> Result<()> {
    require!(validate_symbol(&args.symbol), PegDeskError::InvalidSymbol);
    let kind = OracleKind::from_u8(args.oracle_kind)
        .ok_or_else(|| error!(PegDeskError::InvalidOracleKind))?;
    require!(
        SessionKind::from_u8(args.session_kind).is_some(),
        PegDeskError::InvalidParams
    );
    require!(args.quote_scale <= QUOTE_EUR, PegDeskError::InvalidParams);
    if args.quote_scale == QUOTE_EUR {
        require!(
            kind == OracleKind::PythPull,
            PegDeskError::InvalidOracleKind
        );
    }
    validate_market_params(
        args.base_spread_bps,
        args.closed_spread_bps,
        args.max_age_open,
        args.max_age_closed,
        args.supply_cap,
        args.per_tx_cap,
    )?;
    require!(
        !args.name.is_empty() && args.name.len() <= MAX_NAME_LEN,
        PegDeskError::InvalidParams
    );
    require!(args.uri.len() <= MAX_URI_LEN, PegDeskError::InvalidParams);

    let commodity_key = ctx.accounts.commodity.key();
    let coin_mint_key = ctx.accounts.coin_mint.key();

    {
        let c = &mut ctx.accounts.commodity;
        c.symbol = args.symbol;
        c.coin_mint = coin_mint_key;
        c.decimals = COIN_DECIMALS;
        c.oracle_kind = args.oracle_kind;
        c.session_kind = args.session_kind;
        c.status = STATUS_OPEN;
        c.feed_id = args.feed_id;
        c.feed_account = args.feed_account;
        c.fx_feed_id = args.fx_feed_id;
        c.fx_feed_account = args.fx_feed_account;
        c.quote_scale = args.quote_scale;
        c.base_spread_bps = args.base_spread_bps;
        c.closed_spread_bps = args.closed_spread_bps;
        c.conf_mult_bps = args.conf_mult_bps;
        c.max_age_open = args.max_age_open;
        c.max_age_closed = args.max_age_closed;
        c.supply_cap = args.supply_cap;
        c.per_tx_cap = args.per_tx_cap;
        c.last_publish_time = 0;
        c.last_price = 0;
        c.reserve_vault = ctx.accounts.reserve_vault.key();
        // TODO(v1.1 rebalance_hedge): init hedge vault at PDA ["hedge", commodity].
        c.hedge_vault = Pubkey::default();
        c.reserve_balance_cached = 0;
        c.legs = [IndexLeg::default(); MAX_LEGS];
        c.leg_count = 0;
        c.bump = ctx.bumps.commodity;
        c.pyth_min_signatures = args.pyth_min_signatures;
        c.daily_mint_cap = 0;
        c.daily_redeem_cap = 0;
        c.window_start = 0;
        c.window_minted = 0;
        c.window_redeemed = 0;
        c.max_deviation_bps = 0;
        c.deviation_window_secs = 0;
        c.anchor_price = 0;
        c.anchor_ts = 0;
        c._reserved = [0u8; 1];
    }

    // Metaplex metadata. Mint authority = mint_auth PDA (signs via seeds), update authority = admin.
    let bump = [ctx.bumps.mint_auth];
    let signer_seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, &bump]];
    create_metadata_accounts_v3(
        CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.to_account_info(),
            CreateMetadataAccountsV3 {
                metadata: ctx.accounts.metadata.to_account_info(),
                mint: ctx.accounts.coin_mint.to_account_info(),
                mint_authority: ctx.accounts.mint_auth.to_account_info(),
                payer: ctx.accounts.payer.to_account_info(),
                update_authority: ctx.accounts.admin.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            signer_seeds,
        ),
        DataV2 {
            name: args.name,
            symbol: symbol_string(&args.symbol),
            uri: args.uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        },
        true, // is_mutable: admin can fix name / uri
        true, // update_authority_is_signer
        None, // collection_details
    )?;

    emit!(CommodityCreated {
        commodity: commodity_key,
        symbol: args.symbol,
        mint: coin_mint_key,
    });
    Ok(())
}

// ---- admin / keeper commodity mutations -----------------------------------------------------

#[derive(Accounts)]
pub struct UpdateCommodity<'info> {
    /// Admin (or keeper where the instruction allows it).
    pub authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [COMMODITY_SEED, commodity.symbol.as_ref()],
        bump = commodity.bump
    )]
    pub commodity: Box<Account<'info, Commodity>>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct SetParamsArgs {
    pub session_kind: Option<u8>,
    pub feed_id: Option<[u8; 32]>,
    pub fx_feed_id: Option<[u8; 32]>,
    pub quote_scale: Option<u8>,
    pub base_spread_bps: Option<u16>,
    pub closed_spread_bps: Option<u16>,
    pub conf_mult_bps: Option<u16>,
    pub max_age_open: Option<u32>,
    pub max_age_closed: Option<u32>,
    pub supply_cap: Option<u64>,
    pub per_tx_cap: Option<u64>,
    pub pyth_min_signatures: Option<u8>,
    // ---- circuit breakers (0 = disabled) ----
    pub daily_mint_cap: Option<u64>,
    pub daily_redeem_cap: Option<u64>,
    pub max_deviation_bps: Option<u16>,
    pub deviation_window_secs: Option<u32>,
}

pub fn handle_set_commodity_params(
    ctx: Context<UpdateCommodity>,
    args: SetParamsArgs,
) -> Result<()> {
    require_admin(&ctx.accounts.config, &ctx.accounts.authority.key())?;
    let key = ctx.accounts.commodity.key();
    let c = &mut ctx.accounts.commodity;

    if let Some(v) = args.session_kind {
        require!(
            SessionKind::from_u8(v).is_some(),
            PegDeskError::InvalidParams
        );
        c.session_kind = v;
    }
    if let Some(v) = args.feed_id {
        c.feed_id = v;
    }
    if let Some(v) = args.fx_feed_id {
        c.fx_feed_id = v;
    }
    if let Some(v) = args.quote_scale {
        require!(v <= QUOTE_EUR, PegDeskError::InvalidParams);
        if v == QUOTE_EUR {
            require!(
                c.oracle_kind == OracleKind::PythPull as u8,
                PegDeskError::InvalidOracleKind
            );
        }
        c.quote_scale = v;
    }
    if let Some(v) = args.base_spread_bps {
        c.base_spread_bps = v;
    }
    if let Some(v) = args.closed_spread_bps {
        c.closed_spread_bps = v;
    }
    if let Some(v) = args.conf_mult_bps {
        c.conf_mult_bps = v;
    }
    if let Some(v) = args.max_age_open {
        c.max_age_open = v;
    }
    if let Some(v) = args.max_age_closed {
        c.max_age_closed = v;
    }
    if let Some(v) = args.supply_cap {
        c.supply_cap = v;
    }
    if let Some(v) = args.per_tx_cap {
        c.per_tx_cap = v;
    }
    if let Some(v) = args.pyth_min_signatures {
        c.pyth_min_signatures = v;
    }
    if let Some(v) = args.daily_mint_cap {
        c.daily_mint_cap = v;
    }
    if let Some(v) = args.daily_redeem_cap {
        c.daily_redeem_cap = v;
    }
    if let Some(v) = args.max_deviation_bps {
        require!(v <= MAX_DEVIATION_BPS, PegDeskError::InvalidParams);
        c.max_deviation_bps = v;
    }
    if let Some(v) = args.deviation_window_secs {
        c.deviation_window_secs = v;
    }

    validate_market_params(
        c.base_spread_bps,
        c.closed_spread_bps,
        c.max_age_open,
        c.max_age_closed,
        c.supply_cap,
        c.per_tx_cap,
    )?;

    emit!(ParamsUpdated { commodity: key });
    Ok(())
}

/// Admin or keeper: rotate the Pyth update accounts (keepers post into fresh accounts).
pub fn handle_set_feed_account(
    ctx: Context<UpdateCommodity>,
    feed_account: Pubkey,
    fx_feed_account: Pubkey,
) -> Result<()> {
    require_admin_or_keeper(&ctx.accounts.config, &ctx.accounts.authority.key())?;
    let key = ctx.accounts.commodity.key();
    let c = &mut ctx.accounts.commodity;
    c.feed_account = feed_account;
    c.fx_feed_account = fx_feed_account;
    emit!(ParamsUpdated { commodity: key });
    Ok(())
}

/// Keeper: Open↔Closed and anything→Halted. Admin: any transition (only admin may leave Halted).
/// Admin: drop the deviation anchor so the next trade re-anchors at the current oracle price.
/// Use after a legitimate gap (e.g. a limit-up session) trips `PriceDeviationTooLarge`.
/// `last_price` / `last_publish_time` are kept (sweep valuation, monotonic guard).
pub fn handle_clear_price_anchor(ctx: Context<UpdateCommodity>) -> Result<()> {
    require_admin(&ctx.accounts.config, &ctx.accounts.authority.key())?;
    let key = ctx.accounts.commodity.key();
    ctx.accounts.commodity.anchor_price = 0;
    ctx.accounts.commodity.anchor_ts = 0;
    emit!(ParamsUpdated { commodity: key });
    Ok(())
}

pub fn handle_set_status(ctx: Context<UpdateCommodity>, status: u8) -> Result<()> {
    let who = ctx.accounts.authority.key();
    let admin = is_admin(&ctx.accounts.config, &who);
    let keeper = is_keeper(&ctx.accounts.config, &who);
    require!(admin || keeper, PegDeskError::Unauthorized);

    let new = Status::from_u8(status).ok_or_else(|| error!(PegDeskError::InvalidStatus))?;
    let cur = ctx
        .accounts
        .commodity
        .status_enum()
        .ok_or_else(|| error!(PegDeskError::InvalidStatus))?;

    if !admin {
        let allowed = cur == new
            || matches!(
                (cur, new),
                (Status::Open, Status::Closed)
                    | (Status::Closed, Status::Open)
                    | (_, Status::Halted)
            );
        require!(allowed, PegDeskError::Unauthorized);
    }

    let key = ctx.accounts.commodity.key();
    ctx.accounts.commodity.status = status;
    emit!(StatusChanged {
        commodity: key,
        status,
    });
    Ok(())
}

/// Admin, Composite only. `remaining_accounts[i]` must be the Commodity of `legs[i]`.
pub fn handle_set_index_legs(ctx: Context<UpdateCommodity>, legs: Vec<IndexLeg>) -> Result<()> {
    require_admin(&ctx.accounts.config, &ctx.accounts.authority.key())?;
    let key = ctx.accounts.commodity.key();
    require!(
        ctx.accounts.commodity.oracle_kind == OracleKind::Composite as u8,
        PegDeskError::InvalidOracleKind
    );
    require!(
        !legs.is_empty() && legs.len() <= MAX_LEGS,
        PegDeskError::InvalidLegs
    );
    require!(
        ctx.remaining_accounts.len() >= legs.len(),
        PegDeskError::InvalidLegs
    );

    let mut weight_sum: u64 = 0;
    for (i, leg) in legs.iter().enumerate() {
        require!(leg.weight_bps > 0, PegDeskError::InvalidLegs);
        weight_sum += leg.weight_bps as u64;
        require_keys_neq!(leg.commodity, key, PegDeskError::InvalidLegs);
        require!(
            !legs[..i].iter().any(|l| l.commodity == leg.commodity),
            PegDeskError::InvalidLegs
        );

        let info = &ctx.remaining_accounts[i];
        require_keys_eq!(*info.key, leg.commodity, PegDeskError::InvalidLegs);
        let leg_c = load_commodity(info)?;
        require!(
            leg_c.oracle_kind != OracleKind::Composite as u8,
            PegDeskError::InvalidLegs
        );
        // No fx slot per leg in the composite account layout.
        require!(leg_c.quote_scale != QUOTE_EUR, PegDeskError::InvalidLegs);
    }
    require!(weight_sum == BPS, PegDeskError::InvalidLegs);

    let c = &mut ctx.accounts.commodity;
    let mut arr = [IndexLeg::default(); MAX_LEGS];
    for (i, leg) in legs.iter().enumerate() {
        arr[i] = IndexLeg {
            commodity: leg.commodity,
            weight_bps: leg.weight_bps,
            _pad: [0u8; 6],
        };
    }
    c.legs = arr;
    c.leg_count = legs.len() as u8;

    emit!(ParamsUpdated { commodity: key });
    Ok(())
}
