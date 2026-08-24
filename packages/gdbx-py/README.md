# gdbx-py â€” GDBx Python SDK

Pure Python SDK for [GDBX](../../) â€” Global Decentralized DataBase Sync.

- `gdbx_py.crypto` â€” ECDSA P-256 GDBx sign/verify (gun-free, matches `sdk/gdbx-crypto.js`)
- `gdbx_py.codec` â€” `.gdbx` address (BLAKE3 + base32, matches `sdk/gdbx-codec.js`)
- `gdbx_py.client` â€” `GdbxClient` HTTP + WS (mirrors `sdk/gdbx-sdk.js`)
- `gdbx_py.pow` â€” PoW mining

```python
from gdbx_py.crypto import pair, sign, verify
from gdbx_py.codec import make_address
from gdbx_py.client import GdbxClient

p = pair()
addr = make_address(p["pubkey_hex"])
client = GdbxClient("https://gdbx.xup.workers.dev", p)
await client.register_did()
await client.put_deltas([{"key": "hello", "value": "world"}])
```
