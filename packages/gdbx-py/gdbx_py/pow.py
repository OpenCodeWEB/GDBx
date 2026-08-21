"""gdbx_py.pow — PoW, mirrors worker/src/verify.js + sdk/gdbx-sdk.js"""

import hashlib

TS_WINDOW_MS = 60_000
MIN_NONCE = 1


def get_difficulty(addr: str) -> int:
    l = len(str(addr or ""))
    if l <= 4:
        return 4
    if l <= 8:
        return 3
    return 2


def hash_input(addr: str, owner_pub: str, payload: str, ts: int, nonce: int) -> str:
    return f"{addr}:{owner_pub}:{payload}:{ts}:{nonce}"


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def verify_pow(claim: dict) -> dict:
    addr = str(claim.get("addr") or "").lower()
    import re

    if not re.match(r"^[a-z2-7]{58}$", addr):
        return {"ok": False, "error": "invalid .gdbx address"}
    expected = get_difficulty(addr)
    diff = claim.get("diff", expected)
    if not isinstance(diff, int):
        try:
            diff = int(diff)
        except:
            diff = expected
    if diff != expected:
        return {"ok": False, "error": "difficulty mismatch"}
    owner_pub = str(claim.get("ownerPub") or claim.get("owner_pub") or "")
    payload = str(claim.get("payload") or "")
    try:
        nonce = int(claim.get("nonce"))
    except:
        return {"ok": False, "error": "invalid nonce"}
    if nonce < MIN_NONCE:
        return {"ok": False, "error": "invalid nonce"}
    try:
        ts = int(claim.get("ts"))
    except:
        return {"ok": False, "error": "invalid ts"}
    h = sha256_hex(hash_input(addr, owner_pub, payload, ts, nonce))
    prefix = "0" * diff
    if not h.startswith(prefix):
        return {"ok": False, "error": "proof-of-work not satisfied"}
    if claim.get("hash") and claim["hash"] != h:
        return {"ok": False, "error": "hash mismatch"}
    return {"ok": True, "hash": h}


def mine_pow(addr: str, owner_pub: str, payload: str, ts: int, diff: int = None) -> dict:
    expected = get_difficulty(addr)
    d = diff if diff is not None else expected
    nonce = 1
    while True:
        h = sha256_hex(hash_input(addr, owner_pub, payload, ts, nonce))
        if h.startswith("0" * d):
            return {"nonce": nonce, "hash": h, "diff": d}
        nonce += 1
        # safety: avoid infinite loop in tests with high diff
        if nonce > 500000:
            raise RuntimeError("PoW mining too hard for test")
