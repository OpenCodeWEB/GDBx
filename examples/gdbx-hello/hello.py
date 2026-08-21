#!/usr/bin/env python3
# GDBx Hello — Python (live or mock)
# Usage: python examples/gdbx-hello/hello.py [--live]
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "packages" / "gdbx-py"))

from gdbx_py.crypto import pair, sign
from gdbx_py.codec import make_address

p = pair()
addr = make_address(p["pubkey_hex"])
print(f"Generated .GDBx: {addr}.gdbx")
print(f"DID: did:gdbx:{addr}")
print(f"Pub: {p['pub'][:30]}...")
if "--live" in sys.argv:
    import asyncio
    from gdbx_py.client import GdbxClient
    async def main():
        client = GdbxClient("https://gdbx-do.xup.workers.dev", p)
        print("Registering DID...")
        print(await client.register_did())
        print(await client.put_deltas([{"key": "hello", "value": "world from Python"}]))
        print(await client.get_deltas("hello"))
    asyncio.run(main())
else:
    print("(mock mode — add --live to hit worker)")
    print("Copy this address to AiA/OS as GDBX_ADDR.")
