"""
gdbx_py.codec — .GDBx address codec, mirrors sdk/gdbx-codec.js

Format (single GDBx network):
  payload = Version(1) + SHA256(uncompressed P-256 pubkey 65B) (32B) + BLAKE3(payload[0:33])[0:2]
  Address = base32(payload) -> 56 chars + ".gdbx"
  Legacy 58-char (Version+Network+Hash+Checksum) still validated for compat.
"""

import base64
import hashlib

try:
    import blake3

    def _blake3(data: bytes) -> bytes:
        return blake3.blake3(data).digest()
except ImportError:
    # fallback (should not happen in prod, but keep for tests)
    def _blake3(data: bytes) -> bytes:
        # use hashlib blake2b as approximation (not correct, will fail checksum)
        return hashlib.blake2b(data, digest_size=32).digest()

SUFFIX = "gdbx"
VERSION = 0x01
NETWORKS = {"gdbx": 0x00}
NETWORK_NAMES = {0x00: "gdbx"}
LEGACY_ADDR_LEN = 58
ADDR_LEN = 56


def base32_encode(data: bytes) -> str:
    return base64.b32encode(data).decode().rstrip("=").lower()


def base32_decode(s: str) -> bytes:
    s = s.strip().lower()
    # keep only a-z2-7
    s = "".join(c for c in s if c in "abcdefghijklmnopqrstuvwxyz234567")
    pad = (8 - len(s) % 8) % 8
    return base64.b32decode(s.upper() + "=" * pad)


def pubkey_hash(pubkey_hex: str) -> bytes:
    h = pubkey_hex.strip().lower()
    if h.startswith("0x"):
        h = h[2:]
    # must be 04 + 64+64 hex
    pk_bytes = bytes.fromhex(h)
    if len(pk_bytes) != 65 or pk_bytes[0] != 0x04:
        raise ValueError("pubkey must be uncompressed P-256 point (65 bytes, 0x04 prefix)")
    return hashlib.sha256(pk_bytes).digest()


def make_address(pubkey_hex: str, network: int = 0) -> str:
    # Single GDBx network — network param ignored for simplicity
    h = pubkey_hash(pubkey_hex)
    payload = bytearray(35)
    payload[0] = VERSION
    payload[1:33] = h
    checksum = _blake3(bytes(payload[:33]))[:2]
    payload[33:35] = checksum
    return base32_encode(bytes(payload))


def _validate_payload(payload: bytes):
    # New single-network: 35B
    if len(payload) == 35:
        if payload[0] != VERSION:
            return {"ok": False, "error": f"unsupported version {payload[0]}"}
        expect = _blake3(bytes(payload[:33]))[:2]
        if payload[33] != expect[0] or payload[34] != expect[1]:
            return {"ok": False, "error": "checksum mismatch"}
        return {"ok": True}
    # Legacy 36B (Version+Network+Hash+Checksum)
    if len(payload) == 36:
        if payload[0] != VERSION:
            return {"ok": False, "error": f"unsupported version {payload[0]}"}
        expect = _blake3(bytes(payload[:34]))[:2]
        if payload[34] != expect[0] or payload[35] != expect[1]:
            return {"ok": False, "error": "checksum mismatch"}
        return {"ok": True}
    return {"ok": False, "error": "decoded length must be 35 or 36 bytes"}


def validate_address(addr: str):
    if not isinstance(addr, str):
        return {"ok": False, "error": "address must be a string"}
    s = addr.strip().lower()
    bare = s[:-5] if s.endswith(".gdbx") else s
    if len(bare) not in (ADDR_LEN, LEGACY_ADDR_LEN) or any(c not in "abcdefghijklmnopqrstuvwxyz234567" for c in bare):
        return {"ok": False, "error": "invalid .gdbx address — expected 56 base32 chars"}
    try:
        payload = base32_decode(bare)
        return _validate_payload(payload)
    except Exception as e:
        return {"ok": False, "error": str(e)}


def normalize_address(addr: str):
    if not addr:
        return None
    s = str(addr).strip().lower()
    bare = s[:-5] if s.endswith(".gdbx") else s
    v = validate_address(bare)
    if not v["ok"]:
        return None
    return bare


def network_of(addr: str):
    bare = normalize_address(addr)
    if not bare:
        return None
    payload = base32_decode(bare)
    if len(payload) == 35:
        return "gdbx"
    if len(payload) == 36:
        return "gdbx"
    return None


def version_of(addr: str):
    bare = normalize_address(addr)
    if not bare:
        return None
    return base32_decode(bare)[0]


def to_did(address: str):
    bare = normalize_address(address)
    return f"did:gdbx:{bare}" if bare else None
