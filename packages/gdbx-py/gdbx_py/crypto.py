"""
gdbx_py.crypto — GDBx pure-python crypto, gun-free.

Matches sdk/gdbx-crypto.js exactly:
- canonical_json: key-sorted JSON (same as JS)
- pair: ECDSA P-256, pub = x.y (base64url), priv = base64url raw d (32 bytes)
- sign: "GDBx" + JSON.stringify({m: canonical_json(body), s: base64url(raw_sig)})
  where raw_sig = ECDSA P-256 sign over SHA256(SHA256(m)) double-hash (see JS)
- verify: checks m == canonical_json(body) and ECDSA verify over double-hash
"""

import base64
import hashlib
import json
from typing import Any, Dict

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.backends import default_backend


def canonical_json(obj: Any) -> str:
    if obj is None or not isinstance(obj, dict):
        if isinstance(obj, list):
            return "[" + ",".join(canonical_json(x) for x in obj) + "]"
        return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    if isinstance(obj, list):
        return "[" + ",".join(canonical_json(x) for x in obj) + "]"
    keys = sorted(obj.keys())
    return "{" + ",".join(f"{json.dumps(k)}:{canonical_json(obj[k])}" for k in keys) + "}"


def bytes_to_b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def b64_to_bytes(s: str) -> bytes:
    s = str(s).replace("-", "+").replace("_", "/")
    pad = len(s) % 4
    if pad:
        s += "=" * (4 - pad)
    return base64.b64decode(s)


def _int_to_bytes(n: int, length: int = 32) -> bytes:
    return n.to_bytes(length, "big")


def _der_to_raw(der: bytes) -> bytes:
    # DER -> raw r||s (64 bytes)
    r, s = utils.decode_dss_signature(der)
    return _int_to_bytes(r, 32) + _int_to_bytes(s, 32)


def _raw_to_der(raw: bytes) -> bytes:
    if len(raw) != 64:
        raise ValueError("raw sig must be 64 bytes")
    r = int.from_bytes(raw[:32], "big")
    s = int.from_bytes(raw[32:], "big")
    return utils.encode_dss_signature(r, s)


def pair() -> Dict[str, str]:
    """Generate ECDSA P-256 pair. Returns {pub: 'x.y', priv: b64url, pubkey_hex: '04...'}."""
    priv = ec.generate_private_key(ec.SECP256R1(), default_backend())
    pub = priv.public_key()
    nums = pub.public_numbers()
    x = _int_to_bytes(nums.x, 32)
    y = _int_to_bytes(nums.y, 32)
    d = _int_to_bytes(priv.private_numbers().private_value, 32)
    x_b64 = bytes_to_b64url(x)
    y_b64 = bytes_to_b64url(y)
    d_b64 = bytes_to_b64url(d)
    # pubkey_hex = 04 || x || y (130 hex chars)
    pubkey_hex = "04" + x.hex() + y.hex()
    return {"pub": f"{x_b64}.{y_b64}", "priv": d_b64, "pubkey_hex": pubkey_hex, "_priv_obj": priv}


def _load_private(pair_dict: Dict[str, str]):
    if "_priv_obj" in pair_dict:
        return pair_dict["_priv_obj"]
    # reconstruct from pub + priv
    pub = pair_dict["pub"]
    priv_b64 = pair_dict.get("priv") or pair_dict.get("privJwk")
    if not pub or not priv_b64:
        raise ValueError("pair needs pub and priv")
    x_b64, y_b64 = pub.split(".")
    x = b64_to_bytes(x_b64)
    y = b64_to_bytes(y_b64)
    # priv may be JSON jwk or raw b64
    if isinstance(priv_b64, dict):
        d = b64_to_bytes(priv_b64["d"])
    elif priv_b64.strip().startswith("{"):
        d = b64_to_bytes(json.loads(priv_b64)["d"])
    else:
        d = b64_to_bytes(priv_b64)
    d_int = int.from_bytes(d, "big")
    x_int = int.from_bytes(x, "big")
    y_int = int.from_bytes(y, "big")
    priv = ec.derive_private_key(d_int, ec.SECP256R1(), default_backend())
    # sanity: check pub matches
    return priv


def _load_public(pub: str):
    x_b64, y_b64 = pub.split(".")
    x = int.from_bytes(b64_to_bytes(x_b64), "big")
    y = int.from_bytes(b64_to_bytes(y_b64), "big")
    return ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1()).public_key(default_backend())


def sign(body: Any, key_pair: Dict[str, str]) -> str:
    """Sign body -> GDBx envelope."""
    m = canonical_json(body)
    # JS does: hash = SHA256(m), then sign hash with ECDSA SHA256 (double hash)
    # So we sign SHA256(m) as prehashed SHA256
    digest = hashlib.sha256(m.encode()).digest()
    priv = _load_private(key_pair)
    # JS double-hashes: digest = SHA256(m), then subtle.sign with hash:SHA256 hashes digest again
    # So we sign digest as normal message with ECDSA(SHA256) — library will hash digest again
    der = priv.sign(digest, ec.ECDSA(hashes.SHA256()))
    raw = _der_to_raw(der)
    s = bytes_to_b64url(raw)
    return "GDBx" + json.dumps({"m": m, "s": s}, separators=(",", ":"))


def verify(body: Any, sig: str, pub: str) -> bool:
    try:
        if not isinstance(sig, str) or not sig.startswith("GDBx"):
            return False
        env = json.loads(sig[4:])
        if not env or not isinstance(env, dict) or "s" not in env:
            return False
        m_str = env["m"] if isinstance(env["m"], str) else canonical_json(env["m"])
        if m_str != canonical_json(body):
            return False
        x_b64, y_b64 = pub.split(".")
        if not x_b64 or not y_b64:
            return False
        pub_key = _load_public(pub)
        digest = hashlib.sha256(m_str.encode()).digest()
        raw = b64_to_bytes(env["s"])
        der = _raw_to_der(raw)
        pub_key.verify(der, digest, ec.ECDSA(hashes.SHA256()))
        return True
    except Exception:
        return False


def verify_compat(body: Any, sig: str, pub: str) -> bool:
    if isinstance(sig, str) and sig.startswith("GDBx"):
        return verify(body, sig, pub)
    # legacy SEA: "SEA" + JSON {m,s}
    try:
        raw = sig[3:] if isinstance(sig, str) and sig[:4] == "SEA{" else sig
        env = json.loads(raw)
        if not env or not isinstance(env, dict) or "s" not in env:
            return False
        m_str = env["m"] if isinstance(env["m"], str) else canonical_json(env["m"])
        if m_str != canonical_json(body):
            return False
        pub_key = _load_public(pub)
        digest = hashlib.sha256(m_str.encode()).digest()
        raw_sig = b64_to_bytes(env["s"])
        der = _raw_to_der(raw_sig)
        pub_key.verify(der, digest, ec.ECDSA(hashes.SHA256()))
        return True
    except Exception:
        return False


def sign_body(addr: str, action: str, ts: int, payload):
    return {"addr": addr, "action": action, "ts": ts, "payload": payload}
