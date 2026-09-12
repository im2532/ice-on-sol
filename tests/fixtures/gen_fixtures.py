#!/usr/bin/env python3
"""
Generates the pre-loaded validator accounts used by tests/fee_router.test.ts (see Anchor.toml
[[test.validator.account]]). Pure Python (ed25519 + base58 inlined) so it runs anywhere.

Why fixtures: `register_pool` validates Meteora DBC PoolConfig / VirtualPool accounts by owner +
raw byte layout (programs/fee_router/src/constants.rs::dbc_layout). Creating real DBC accounts
needs the full launch flow, so the suite instead loads hand-built accounts owned by the DBC program
with exactly the bytes the router reads — which is also the only way to exercise the *negative*
paths (wrong fee_claimer, wrong quote mint, wrong config) deterministically.

Deterministic: every key is derived from a fixed seed, so re-running never changes the files.
Re-run after changing a program id in Anchor.toml (the router PDA depends on it).
"""
import hashlib, json, os, struct

HERE = os.path.dirname(os.path.abspath(__file__))
FEE_ROUTER_ID = "9bnCKVesMxQPDaWAmiT21vaES2QgtdXinfXciTCZrbEt"
PEG_DESK_ID = "6jMv6pdi3nB4RRmJSojDy2cHRLMgKNM3ZEeJFngWrqQN"
DBC_ID = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
TOKEN_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"

# ---- ed25519 (RFC 8032 reference, compact) ---------------------------------------------------
q = 2**255 - 19
l = 2**252 + 27742317777372353535851937790883648493

def inv(x):
    return pow(x, q - 2, q)

d = (-121665 * inv(121666)) % q
I = pow(2, (q - 1) // 4, q)

def xrecover(y):
    xx = (y * y - 1) * inv(d * y * y + 1)
    x = pow(xx, (q + 3) // 8, q)
    if (x * x - xx) % q != 0:
        x = (x * I) % q
    if x % 2 != 0:
        x = q - x
    return x

By = (4 * inv(5)) % q
Bx = xrecover(By)
B = (Bx, By)

def edwards(P, Q):
    x1, y1 = P
    x2, y2 = Q
    x3 = (x1 * y2 + x2 * y1) * inv(1 + d * x1 * x2 * y1 * y2)
    y3 = (y1 * y2 + x1 * x2) * inv(1 - d * x1 * x2 * y1 * y2)
    return (x3 % q, y3 % q)

def scalarmult(P, e):
    if e == 0:
        return (0, 1)
    Q = scalarmult(P, e // 2)
    Q = edwards(Q, Q)
    if e & 1:
        Q = edwards(Q, P)
    return Q

def encodepoint(P):
    x, y = P
    bits = [(y >> i) & 1 for i in range(255)] + [x & 1]
    return bytes(sum([bits[i * 8 + j] << j for j in range(8)]) for i in range(32))

def publickey(seed: bytes) -> bytes:
    h = hashlib.sha512(seed).digest()
    a = 2 ** 254 + sum(2 ** i * ((h[i // 8] >> (i % 8)) & 1) for i in range(3, 254))
    return encodepoint(scalarmult(B, a))

def isoncurve(P):
    x, y = P
    return (-x * x + y * y - 1 - d * x * x * y * y) % q == 0

def decodepoint(s: bytes):
    y = sum(2 ** i * ((s[i // 8] >> (i % 8)) & 1) for i in range(255))
    x = xrecover(y)
    if x & 1 != ((s[31] >> 7) & 1):
        x = q - x
    P = (x, y)
    return P if isoncurve(P) else None

def on_curve(pk: bytes) -> bool:
    return decodepoint(pk) is not None

# ---- base58 ---------------------------------------------------------------------------------
ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

def b58encode(b: bytes) -> str:
    n = int.from_bytes(b, "big")
    out = ""
    while n > 0:
        n, r = divmod(n, 58)
        out = ALPHABET[r] + out
    pad = len(b) - len(b.lstrip(b"\0"))
    return "1" * pad + out

def b58decode(s: str) -> bytes:
    n = 0
    for c in s:
        n = n * 58 + ALPHABET.index(c)
    b = n.to_bytes((n.bit_length() + 7) // 8, "big")
    pad = len(s) - len(s.lstrip("1"))
    return b"\0" * pad + b

# ---- PDA ------------------------------------------------------------------------------------
def find_pda(seeds, program: bytes):
    for bump in range(255, -1, -1):
        h = hashlib.sha256(b"".join(seeds) + bytes([bump]) + program + b"ProgramDerivedAddress").digest()
        if not on_curve(h):
            return h, bump
    raise RuntimeError("no bump")

# ---- keys (deterministic) ---------------------------------------------------------------------
def seed(name: str) -> bytes:
    return hashlib.sha256(b"icemarkets-fixture:" + name.encode()).digest()

def keypair(name: str):
    s = seed(name)
    pk = publickey(s)
    return list(s + pk), pk

quote_sk, QUOTE = keypair("quote-mint")   # COIN (e.g. GLDX)
base_sk, BASE = keypair("base-mint")      # memecoin
_, CREATOR = keypair("creator")
_, OTHER = keypair("other")
_, DBC_CONFIG_OK = keypair("dbc-config-ok")
_, DBC_CONFIG_BAD = keypair("dbc-config-bad-claimer")
_, DBC_POOL_OK = keypair("dbc-pool-ok")
_, DBC_POOL_BAD = keypair("dbc-pool-bad-claimer")
_, DBC_POOL_WRONGCFG = keypair("dbc-pool-wrong-config")
_, COMMODITY = keypair("commodity-gldx")

ROUTER, _ = find_pda([b"router"], b58decode(FEE_ROUTER_ID))

# ---- layouts (programs/fee_router/src/constants.rs) -----------------------------------------
POOL_CONFIG_DISC = bytes([26, 108, 14, 123, 116, 230, 129, 43])
VIRTUAL_POOL_DISC = bytes([213, 224, 5, 209, 98, 69, 119, 92])

def pool_config(fee_claimer: bytes, quote: bytes) -> bytes:
    buf = bytearray(1000)
    buf[0:8] = POOL_CONFIG_DISC
    buf[8:40] = quote
    buf[40:72] = fee_claimer
    return bytes(buf)

def virtual_pool(config: bytes, creator: bytes, base: bytes, migrated: int = 0) -> bytes:
    buf = bytearray(400)
    buf[0:8] = VIRTUAL_POOL_DISC
    buf[72:104] = config
    buf[104:136] = creator
    buf[136:168] = base
    buf[305] = migrated
    return bytes(buf)

def commodity(symbol: str, coin_mint: bytes) -> bytes:
    buf = bytearray(600)
    buf[0:8] = hashlib.sha256(b"account:Commodity").digest()[:8]
    buf[8:20] = symbol.encode().ljust(12, b"\0")
    buf[20:52] = coin_mint
    return bytes(buf)

def account_file(name: str, pubkey: bytes, owner: str, data: bytes):
    import base64
    doc = {
        "pubkey": b58encode(pubkey),
        "account": {
            "lamports": 10_000_000_000,
            "data": [base64.b64encode(data).decode(), "base64"],
            "owner": owner,
            "executable": False,
            "rentEpoch": 0,
            "space": len(data),
        },
    }
    with open(os.path.join(HERE, name), "w") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    return b58encode(pubkey)

files = {
    "dbc_config_ok": account_file("dbc_config_ok.json", DBC_CONFIG_OK, DBC_ID, pool_config(ROUTER, QUOTE)),
    "dbc_config_bad_claimer": account_file("dbc_config_bad_claimer.json", DBC_CONFIG_BAD, DBC_ID, pool_config(OTHER, QUOTE)),
    "dbc_pool_ok": account_file("dbc_pool_ok.json", DBC_POOL_OK, DBC_ID, virtual_pool(DBC_CONFIG_OK, CREATOR, BASE)),
    "dbc_pool_bad_claimer": account_file("dbc_pool_bad_claimer.json", DBC_POOL_BAD, DBC_ID, virtual_pool(DBC_CONFIG_BAD, CREATOR, BASE)),
    "dbc_pool_wrong_config": account_file("dbc_pool_wrong_config.json", DBC_POOL_WRONGCFG, DBC_ID, virtual_pool(DBC_CONFIG_BAD, CREATOR, BASE)),
    "commodity_gldx": account_file("commodity_gldx.json", COMMODITY, PEG_DESK_ID, commodity("GLDX", QUOTE)),
}

keys = {
    "feeRouterProgramId": FEE_ROUTER_ID,
    "routerPda": b58encode(ROUTER),
    "quoteMint": {"pubkey": b58encode(QUOTE), "secretKey": quote_sk},
    "baseMint": {"pubkey": b58encode(BASE), "secretKey": base_sk},
    "creator": b58encode(CREATOR),
    "other": b58encode(OTHER),
    "accounts": files,
}
with open(os.path.join(HERE, "keys.json"), "w") as f:
    json.dump(keys, f, indent=2)
    f.write("\n")

print("router PDA", b58encode(ROUTER))
for k, v in files.items():
    print(f"{k:24s} {v}")
print("\nAnchor.toml entries:")
for k, v in files.items():
    print(f'[[test.validator.account]]\naddress = "{v}"\nfilename = "tests/fixtures/{k}.json"\n')
