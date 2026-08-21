"""
gdbx_py.codec — .GDBx address codec, mirrors sdk/gdbx-codec.js

Format:
  payload = Version(1) + Network(1) + SHA256(uncompressed P-256 pubkey 65B) (32B) + BLAKE3(payload[0:34])[0:2]
  Address = base32(payload) -> 58 chars + ".gdbx"
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
NETWORKS = {"mainnet": 0x00, "testnet": 0x01, "local": 0x02}
NETWORK_NAMES = {0x00: "mainnet", 0x01: "testnet", 0x02: "local"}
ADDR_LEN = 58


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
    h = pubkey_hash(pubkey_hex)
    payload = bytearray(36)
    payload[0] = VERSION
    payload[1] = network
    payload[2:34] = h
    checksum = _blake3(bytes(payload[:34]))[:2]
    payload[34:36] = checksum
    return base32_encode(bytes(payload))


def _validate_payload(payload: bytes):
    if len(payload) != 36:
        return {"ok": False, "error": "decoded length must be 36 bytes"}
    if payload[0] != VERSION:
        return {"ok": False, "error": f"unsupported version {payload[0]}"}
    if payload[1] not in NETWORK_NAMES:
        return {"ok": False, "error": f"unknown network {payload[1]}"}
    expect = _blake3(bytes(payload[:34]))[:2]
    if payload[34] != expect[0] or payload[35] != expect[1]:
        return {"ok": False, "error": "checksum mismatch"}
    return {"ok": True}


def validate_address(addr: str):
    if not isinstance(addr, str):
        return {"ok": False, "error": "address must be a string"}
    s = addr.strip().lower()
    bare = s[:-5] if s.endswith(".gdbx") else s
    # check charset
    if len(bare) != ADDR_LEN or any(c not in "abcdefghijklmnopqrstuvwxyz234567" for c in bare):
        return {"ok": False, "error": "invalid .gdbx address — expected 58 base32 chars"}
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
    return NETWORK_NAMES[base32_decode(bare)[1]]


def version_of(addr: str):
    bare = normalize_address(addr)
    if not bare:
        return None
    return base32_decode(bare)[0]


def to_did(address: str):
    bare = normalize_address(address)
    return f"did:gdbx:{bare}" if bare else None
