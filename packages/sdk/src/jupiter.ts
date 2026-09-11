/**
 * Adapter over the Jupiter Swap API v1 (`/quote` + `/swap-instructions`), used for the
 * SOL-pay-in launch/trade path (SOL -> USDC leg before the Peg Desk buy). No SDK package
 * is pinned for this — it's a plain HTTPS JSON API — so this file isolates the field
 * names per docs/CONTRACTS.md §5 ("SOL path: tx1 Jupiter SOL→USDC; tx2 as above").
 *
 * // CHECK vs Jupiter API: https://dev.jup.ag/docs/swap-api (v1). Response field names
 * (`otherAmountThreshold`, `computeUnitLimit`, `swapInstruction`/`setupInstructions`
 * casing, base64 vs base58 account-key encoding, `addressLookupTableAddresses`) should be
 * checked against the live API before mainnet use — this was written from the documented
 * shape in docs/research/02 §C, not a live response captured in this sandbox (no network).
 */
import { AddressLookupTableAccount, Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";

const JUPITER_API_BASE = "https://lite-api.jup.ag/swap/v1"; // CHECK: confirm base URL / whether an API key header is required for the paid tier.

export interface JupiterQuoteParams {
  inputMint: PublicKey;
  outputMint: PublicKey;
  /** Input amount in the input mint's base units. */
  amount: bigint;
  slippageBps: number;
}

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  // CHECK vs API: full route/plan shape. Kept as `unknown` and passed through verbatim to
  // /swap-instructions rather than re-typed, since it's opaque to callers anyway.
  [key: string]: unknown;
}

/** GET /quote?inputMint=...&outputMint=...&amount=...&slippageBps=...&restrictIntermediateTokens=true */
export async function getQuote(params: JupiterQuoteParams): Promise<JupiterQuoteResponse> {
  const url = new URL(`${JUPITER_API_BASE}/quote`);
  url.searchParams.set("inputMint", params.inputMint.toBase58());
  url.searchParams.set("outputMint", params.outputMint.toBase58());
  url.searchParams.set("amount", params.amount.toString());
  url.searchParams.set("slippageBps", String(params.slippageBps));
  // Per docs/research/02 §C: only route through "highly liquid intermediate tokens" — keeps
  // a SOL->USDC quote from getting routed through a thin/illiquid hop.
  url.searchParams.set("restrictIntermediateTokens", "true");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Jupiter /quote failed: ${res.status} ${res.statusText} — ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as JupiterQuoteResponse;
}

export interface GetSwapIxsParams {
  quote: JupiterQuoteResponse;
  userPublicKey: PublicKey;
  /** Cap on accounts touched by the swap route, per CONTRACTS §5 (keeps the tx within Solana's account limit
   *  once combined with the peg_desk/DBC instructions in the same transaction). */
  maxAccounts?: number;
}

export interface JupiterSwapIxsResult {
  computeBudgetInstructions: TransactionInstruction[];
  setupInstructions: TransactionInstruction[];
  swapInstruction: TransactionInstruction;
  cleanupInstruction: TransactionInstruction | null;
  addressLookupTableAddresses: PublicKey[];
}

/** POST /swap-instructions — returns raw instructions (not a signed/serialized tx) so the
 *  launch/trade builder can splice them into its own transaction alongside peg_desk/DBC ixs. */
export async function getSwapIxs(params: GetSwapIxsParams): Promise<JupiterSwapIxsResult> {
  const res = await fetch(`${JUPITER_API_BASE}/swap-instructions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: params.quote,
      userPublicKey: params.userPublicKey.toBase58(),
      maxAccounts: params.maxAccounts ?? 20,
      // wrapAndUnwrapSol: true is the default and what we want for a SOL-in leg.
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Jupiter /swap-instructions failed: ${res.status} ${res.statusText} — ${await res.text().catch(() => "")}`,
    );
  }
  const body = (await res.json()) as {
    computeBudgetInstructions: JupiterRawIx[];
    setupInstructions: JupiterRawIx[];
    swapInstruction: JupiterRawIx;
    cleanupInstruction?: JupiterRawIx;
    addressLookupTableAddresses: string[];
  };

  return {
    computeBudgetInstructions: body.computeBudgetInstructions.map(deserializeIx),
    setupInstructions: body.setupInstructions.map(deserializeIx),
    swapInstruction: deserializeIx(body.swapInstruction),
    cleanupInstruction: body.cleanupInstruction ? deserializeIx(body.cleanupInstruction) : null,
    addressLookupTableAddresses: body.addressLookupTableAddresses.map((a) => new PublicKey(a)),
  };
}

/** Jupiter's `/swap-instructions` response encodes each instruction as programId + accounts (pubkey/isSigner/isWritable) + base64 data. */
interface JupiterRawIx {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64
}

function deserializeIx(raw: JupiterRawIx): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(raw.programId),
    keys: raw.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(raw.data, "base64"),
  });
}

/** Resolves ALT addresses returned by /swap-instructions into full `AddressLookupTableAccount`s for tx compilation. */
export async function resolveAddressLookupTables(
  connection: Connection,
  addresses: PublicKey[],
): Promise<AddressLookupTableAccount[]> {
  const accounts = await Promise.all(
    addresses.map(async (address) => {
      const res = await connection.getAddressLookupTable(address);
      if (!res.value) throw new Error(`ALT not found on-chain: ${address.toBase58()}`);
      return res.value;
    }),
  );
  return accounts;
}
