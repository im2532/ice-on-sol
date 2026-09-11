/**
 * Wallet-facing actions: thin adapters from UI params to the REAL @icemarkets/sdk builders
 * (packages/sdk/src/{launch,trade,pegDesk,distributor}.ts). All SDK types are imported type-only so
 * `tsc` checks these calls against the SDK's actual signatures; the module itself is loaded with a
 * dynamic import() so its Meteora/Anchor dependencies are code-split out of the initial bundle.
 *
 * Runtime inputs besides the wallet:
 *  - the peg_desk IDL at `${NEXT_PUBLIC_IDL_BASE ?? "/idl"}/peg_desk.json` (copied from target/idl by
 *    `make build`), used to read Commodity accounts and build peg_desk instructions;
 *  - the indexer API (lib/api.ts) to map a memecoin mint → DBC pool / paired commodity, and for
 *    Merkle claim proofs.
 */
import { Buffer } from "buffer";
import {
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type Signer,
  type TransactionInstruction,
} from "@solana/web3.js";
import type {
  BuildLaunchTransactionsParams,
  BuiltTrade,
  CommodityAccountView,
  OracleReading,
  PegDeskClient,
} from "@icemarkets/sdk";
import { toast } from "@/components/Toast";
import { fetchClaimableLeaves, fetchCommodities, fetchMarket } from "./api";
import { USDC_MINT, WSOL_MINT, fetchLaunchAltAddress } from "./cluster";

// ---------------------------------------------------------------------------
// UI-level params (what the pages collect). Mapped onto SDK params below.
// ---------------------------------------------------------------------------

/** Same union as the SDK's `PayWith` (launch.ts). */
export type PayWith = "SOL" | "USDC" | "COIN";

export interface LaunchParams {
  ownerWallet: PublicKey;
  commoditySymbol: string; // paired-with coin, e.g. "GLD"; a ready-made index coin (e.g. "WATCHX") works the same way
  name: string;
  ticker: string;
  /** Metadata URI for the memecoin (currently the uploaded image URI; see app/api/upload). */
  imageUri: string;
  description?: string;
  website?: string;
  x?: string;
  telegram?: string;
  feeBps: 100 | 200 | 300;
  firstBuyUsd: number;
  payWith: Extract<PayWith, "USDC" | "SOL">;
}

export interface BuySellParams {
  wallet: PublicKey;
  /** Memecoin mint (/token/[mint]) or a commodity coin mint (/commodities/[symbol]). */
  mint: string;
  /** Human units of what is spent: USDC / SOL for buys, the token being sold for sells. */
  amountIn: number;
  /** Optional human-unit floor on the output; 0 = derive from quote − slippage. */
  minOut: number;
  payWith: PayWith;
  slippageBps?: number;
}

export interface ClaimParams {
  wallet: PublicKey;
  /** Claim every unclaimed Merkle leaf paid in this commodity coin (e.g. "GLD"). */
  coinSymbol: string;
}

export interface SendTxDeps {
  connection: Connection;
  /** wallet-adapter `sendTransaction` (its `signers` option partially signs with extra keypairs). */
  sendTransaction: (
    tx: Transaction | VersionedTransaction,
    connection: Connection,
    options?: { signers?: Signer[] },
  ) => Promise<string>;
}

// ---------------------------------------------------------------------------
// SDK + context loading
// ---------------------------------------------------------------------------

type Sdk = typeof import("@icemarkets/sdk");

// The SDK (and web3.js/Anchor) use the Node `Buffer` global; Next 15 does not polyfill it client-side.
if (typeof window !== "undefined") (globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;

const IDL_BASE = process.env.NEXT_PUBLIC_IDL_BASE ?? "/idl";
const DEFAULT_SLIPPAGE_BPS = 100;
const DECIMALS = 1_000_000; // every ICEmarkets coin, memecoin and USDC has 6 decimals

let sdkPromise: Promise<Sdk> | null = null;
let idlPromise: Promise<unknown> | null = null;

async function loadSdk(): Promise<Sdk> {
  sdkPromise ??= import("@icemarkets/sdk");
  return sdkPromise;
}

async function loadPegDeskIdl(): Promise<unknown> {
  idlPromise ??= fetch(`${IDL_BASE}/peg_desk.json`).then((r) => {
    if (!r.ok) throw new Error(`peg_desk IDL not found at ${IDL_BASE}/peg_desk.json (run \`make build\`)`);
    return r.json();
  });
  return idlPromise;
}

interface PegContext {
  sdk: Sdk;
  pegDesk: PegDeskClient;
  commodity: CommodityAccountView;
  oracle: OracleReading;
}

async function pegContext(connection: Connection, wallet: PublicKey, symbol: string): Promise<PegContext> {
  const sdk = await loadSdk();
  const pegDesk = sdk.createPegDeskClient(connection, wallet, await loadPegDeskIdl());
  const commodity = await pegDesk.fetchCommodityView(symbol);
  const oracle = await pegDesk.fetchOracleReading(commodity);
  return { sdk, pegDesk, commodity, oracle };
}

const toBase = (human: number): bigint => BigInt(Math.floor(human * DECIMALS));

async function toTx(connection: Connection, payer: PublicKey, built: Pick<BuiltTrade, "instructions" | "addressLookupTableAddresses">, sdk: Sdk) {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  if (built.addressLookupTableAddresses.length === 0) {
    const tx = new Transaction().add(...built.instructions);
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer;
    return tx;
  }
  const alts = await sdk.resolveAddressLookupTables(connection, built.addressLookupTableAddresses);
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: built.instructions }).compileToV0Message(alts);
  return new VersionedTransaction(msg);
}

/** Metaplex caps metadata URIs at 200 bytes and Anchor's instruction encoder at 1000 bytes total, so a
 *  base64 `data:` URI from the stub upload route (apps/web/app/api/upload) can never go on chain. Until
 *  Irys uploads are wired up, launch with an empty URI rather than failing with "encoding overruns Buffer". */
const MAX_METADATA_URI_BYTES = 200;
function metadataUri(uri: string | undefined): string {
  if (!uri) return "";
  if (uri.startsWith("data:") || new TextEncoder().encode(uri).length > MAX_METADATA_URI_BYTES) {
    console.warn(`launch: dropping metadata uri (${uri.slice(0, 30)}…, ${uri.length} chars) — needs a hosted URL ≤ ${MAX_METADATA_URI_BYTES} bytes`);
    return "";
  }
  return uri;
}

async function sendAndToast(
  txs: { tx: Transaction | VersionedTransaction; signers?: Signer[] }[],
  deps: SendTxDeps,
  successMessage: string,
): Promise<string[]> {
  const sigs: string[] = [];
  try {
    for (const [i, { tx, signers }] of txs.entries()) {
      const sig = await deps.sendTransaction(tx, deps.connection, signers?.length ? { signers } : undefined);
      sigs.push(sig);
      // Later txs depend on earlier ones (e.g. the DBC pool init reads the config created just before),
      // so wait for confirmation before sending the next.
      if (i < txs.length - 1) {
        const bh = await deps.connection.getLatestBlockhash("confirmed");
        const res = await deps.connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
        if (res.value.err) throw new Error(`transaction ${i + 1}/${txs.length} failed: ${JSON.stringify(res.value.err)} (${sig})`);
      }
    }
    toast.success(successMessage);
    return sigs;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Transaction failed");
    throw err;
  }
}

async function guard<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    toast.error(`${what}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Launch: SDK `buildLaunchTransactions` (CONTRACTS §5) — 2 v0 txs (DBC config, then launch) or 3 with a SOL → USDC swap first,
 * compiled against the launch lookup table from `/deployments/<cluster>.json` when present.
 * Index coins (Composite) are paired like any other commodity; the SDK prices them from their legs.
 */
export async function launchMarket(params: LaunchParams, deps: SendTxDeps): Promise<string[] | null> {
  const built = await guard("Launch", async () => {
    const { sdk, pegDesk, commodity, oracle } = await pegContext(deps.connection, params.ownerWallet, params.commoditySymbol);
    const addressLookupTable = await sdk.loadLaunchAlt(deps.connection, await fetchLaunchAltAddress());
    const routerPda = sdk.feeRouter.router(sdk.FEE_ROUTER_PROGRAM_ID)[0];
    const launch: BuildLaunchTransactionsParams = {
      connection: deps.connection,
      creator: params.ownerWallet,
      commoditySymbol: params.commoditySymbol,
      name: params.name,
      symbol: params.ticker,
      uri: metadataUri(params.imageUri),
      feeTierBps: params.feeBps,
      firstBuyUsdc: params.firstBuyUsd,
      payWith: params.payWith,
      commodity,
      oracle,
      coinUsdPrice: Number(oracle.price) / 1e8,
      usdcMint: USDC_MINT,
      wsolMint: WSOL_MINT,
      userUsdcAta: sdk.ata(USDC_MINT, params.ownerWallet),
      userCoinAta: sdk.ata(commodity.coinMint, params.ownerWallet),
      // DBC leftoverReceiver (leftover = 0 in the launch config, so this only matters as a sink).
      treasury: new PublicKey(process.env.NEXT_PUBLIC_TREASURY || routerPda.toBase58()), // `||`: an empty env var means "unset"
      pegDesk,
      slippageBps: DEFAULT_SLIPPAGE_BPS,
      addressLookupTable,
    };
    const res = await sdk.buildLaunchTransactions(launch);
    // v0 txs are compiled (fee payer + blockhash) by the SDK; `res.signers[i]` carries the fresh DBC
    // config / base mint keypair each tx needs. wallet-adapter applies them before the wallet signs.
    return res.transactions.map((tx, i) => ({ tx, signers: res.signers[i] ?? [] }));
  });
  if (!built) return null;
  return sendAndToast(built, deps, `Launched $${params.ticker}`);
}

/** Buy: commodity coin → peg_desk.buy directly; memecoin → SDK buildBuyWithUsdc / buildBuyWithSol. */
export async function buyCoin(params: BuySellParams, deps: SendTxDeps): Promise<string[] | null> {
  const tx = await guard("Buy", async () => {
    const slippage = BigInt(params.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
    const commodities = await fetchCommodities();
    const direct = commodities.find((c) => c.mint === params.mint);

    if (direct) {
      if (direct.status !== "open") throw new Error(`${direct.symbol} is ${direct.status} — buys are disabled (sell-only while closed)`);
      if (params.payWith !== "USDC") throw new Error("Commodity coins are bought with USDC");
      const { sdk, pegDesk, commodity, oracle } = await pegContext(deps.connection, params.wallet, direct.symbol);
      const usdcIn = toBase(params.amountIn);
      const q = pegDesk.quote(commodity, oracle, usdcIn);
      const minCoinOut = params.minOut > 0 ? toBase(params.minOut) : sdk.applySlippageDown(q.coinOut, slippage);
      const instructions: TransactionInstruction[] = [
        pegDesk.createUserCoinAtaIx(params.wallet, params.wallet, commodity.coinMint),
        await pegDesk.buyIx({ user: params.wallet, commodity, usdcIn, minCoinOut, userUsdcAta: sdk.ata(USDC_MINT, params.wallet) }),
      ];
      return toTx(deps.connection, params.wallet, { instructions, addressLookupTableAddresses: [] }, sdk);
    }

    const market = await fetchMarket(params.mint);
    if (!market) throw new Error("Unknown market");
    if (params.payWith === "COIN") {
      // COIN → memecoin directly on the curve: no Peg Desk leg, so this also works while the coin is Closed.
      const sdk = await loadSdk();
      const built = await sdk.buildBuyWithCoin({
        connection: deps.connection,
        user: params.wallet,
        dbcPool: new PublicKey(market.dbcPool),
        memeMint: new PublicKey(market.mint),
        coinIn: toBase(params.amountIn),
        minMemeOut: params.minOut > 0 ? toBase(params.minOut) : 0n,
      });
      return toTx(deps.connection, params.wallet, built, sdk);
    }
    const { sdk, pegDesk, commodity, oracle } = await pegContext(deps.connection, params.wallet, market.commoditySymbol);
    const common = {
      connection: deps.connection,
      user: params.wallet,
      commodity,
      oracle,
      dbcPool: new PublicKey(market.dbcPool),
      memeMint: new PublicKey(market.mint),
      slippageBps: Number(slippage),
      pegDesk,
    };
    const built =
      params.payWith === "SOL"
        ? await sdk.buildBuyWithSol({
            ...common,
            solIn: BigInt(Math.floor(params.amountIn * 1e9)),
            usdcMint: USDC_MINT,
            wsolMint: WSOL_MINT,
            userUsdcAta: sdk.ata(USDC_MINT, params.wallet),
          })
        : await sdk.buildBuyWithUsdc({ ...common, usdcIn: toBase(params.amountIn), userUsdcAta: sdk.ata(USDC_MINT, params.wallet) });
    return toTx(deps.connection, params.wallet, built, sdk);
  });
  if (!tx) return null;
  return sendAndToast([{ tx }], deps, "Buy sent");
}

/** Sell: commodity coin → peg_desk.sell; memecoin → SDK buildSellToUsdc (dbc.swap → peg_desk.sell). */
export async function sellCoin(params: BuySellParams, deps: SendTxDeps): Promise<string[] | null> {
  const tx = await guard("Sell", async () => {
    const slippage = BigInt(params.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
    const commodities = await fetchCommodities();
    const direct = commodities.find((c) => c.mint === params.mint);
    const amountBase = toBase(params.amountIn);

    if (direct) {
      const { sdk, pegDesk, commodity, oracle } = await pegContext(deps.connection, params.wallet, direct.symbol);
      const q = pegDesk.quoteSell(commodity, oracle, amountBase);
      const minUsdcOut = params.minOut > 0 ? toBase(params.minOut) : sdk.applySlippageDown(q.usdcOut, slippage);
      const ix = await pegDesk.sellIx({ user: params.wallet, commodity, coinIn: amountBase, minUsdcOut, userUsdcAta: sdk.ata(USDC_MINT, params.wallet) });
      return toTx(deps.connection, params.wallet, { instructions: [ix], addressLookupTableAddresses: [] }, sdk);
    }

    const market = await fetchMarket(params.mint);
    if (!market) throw new Error("Unknown market");
    const { sdk, pegDesk, commodity, oracle } = await pegContext(deps.connection, params.wallet, market.commoditySymbol);
    // CHECK: no DBC curve quote in the SDK yet — estimate COIN out from the indexer's last price
    // net of the pool fee; the DBC leg's own minimumAmountOut (estimate − slippage) protects the user.
    const estCoin = BigInt(Math.floor(Number(amountBase) * market.priceQuote * (1 - market.feeBps / 10_000)));
    const built = await sdk.buildSellToUsdc({
      connection: deps.connection,
      user: params.wallet,
      commodity,
      oracle,
      dbcPool: new PublicKey(market.dbcPool),
      memeMint: new PublicKey(market.mint),
      tokenIn: amountBase,
      userUsdcAta: sdk.ata(USDC_MINT, params.wallet),
      slippageBps: Number(slippage),
      pegDesk,
      coinFromDbc: estCoin,
    });
    return toTx(deps.connection, params.wallet, built, sdk);
  });
  if (!tx) return null;
  return sendAndToast([{ tx }], deps, "Sell sent");
}

/** Claim every unclaimed distributor Merkle leaf for `coinSymbol` (SDK `claimIx`, ≤ 4 per tx). */
export async function claim(params: ClaimParams, deps: SendTxDeps): Promise<string[] | null> {
  const txs = await guard("Claim", async () => {
    const sdk = await loadSdk();
    const leaves = (await fetchClaimableLeaves(params.wallet.toBase58())).filter((l) => l.coinSymbol === params.coinSymbol);
    if (leaves.length === 0) throw new Error(`Nothing to claim in ${params.coinSymbol}`);
    const ixs = leaves.map((l) =>
      sdk.claimIx({
        wallet: params.wallet,
        pool: new PublicKey(l.pool),
        epochIndex: l.epochIndex,
        coinMint: new PublicKey(l.coinMint),
        amount: BigInt(l.amount),
        proof: l.proof.map((h) => Buffer.from(h, "hex")),
      }),
    );
    const out: { tx: Transaction }[] = [];
    for (let i = 0; i < ixs.length; i += 4) {
      out.push({ tx: await toTx(deps.connection, params.wallet, { instructions: ixs.slice(i, i + 4), addressLookupTableAddresses: [] }, sdk) as Transaction });
    }
    return out;
  });
  if (!txs) return null;
  return sendAndToast(txs, deps, "Claim sent");
}
