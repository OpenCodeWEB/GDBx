"""gdbx_py.client — GdbxClient, mirrors sdk/gdbx-sdk.js"""

import json
import time
import math
from typing import Any, Dict, List, Optional

import httpx

from .crypto import sign, canonical_json
from .codec import make_address, normalize_address
from .pow import mine_pow


def _sign_body(addr: str, action: str, ts: int, payload):
    return {"addr": addr, "action": action, "ts": ts, "payload": payload}


class GdbxClient:
    def __init__(self, base_url: str, pair: Dict[str, str], pubkey_hex: str = None, network: int = 0):
        self.base_url = base_url.rstrip("/")
        self.pair = pair
        self.pubkey_hex = pubkey_hex or pair.get("pubkey_hex") or ""
        if not self.pubkey_hex:
            raise ValueError("pubkey_hex required (04... 130 hex)")
        self.addr = make_address(self.pubkey_hex, network)

    async def _post(self, path: str, body: dict) -> dict:
        async with httpx.AsyncClient() as c:
            r = await c.post(f"{self.base_url}{path}", json=body, timeout=15)
            try:
                data = r.json()
            except:
                data = {"error": await r.aread()}
            if r.status_code >= 400:
                raise RuntimeError(data.get("error") or f"HTTP {r.status_code}")
            return data

    async def register_did(self, did_doc: dict = None) -> dict:
        ts = int(time.time() * 1000)
        payload = did_doc
        # PoW over "did.register"
        pw = mine_pow(self.addr, self.pair["pub"], "did.register", ts)
        # sign canonical body
        body = _sign_body(self.addr, "did.register", ts, payload)
        sig = sign(body, self.pair)
        return await self._post("/did", {
            "addr": self.addr,
            "pubkey": self.pair["pub"],
            "pubkeyHex": self.pubkey_hex,
            "didDoc": did_doc,
            "ts": ts,
            "nonce": pw["nonce"],
            "diff": pw["diff"],
            "hash": pw["hash"],
            "sig": sig,
        })

    async def put_deltas(self, deltas: List[Dict[str, Any]]) -> dict:
        ts = int(time.time() * 1000)
        # normalize deltas
        norm = [{"key": d["key"], "value": d["value"], "clock": d.get("clock", ts)} for d in deltas]
        payload = json.dumps(norm, separators=(",", ":"))
        pw = mine_pow(self.addr, self.pair["pub"], "sync.put", ts)
        body = _sign_body(self.addr, "sync.put", ts, payload)
        sig = sign(body, self.pair)
        return await self._post("/sync", {
            "addr": self.addr,
            "pubkey": self.pair["pub"],
            "pubkeyHex": self.pubkey_hex,
            "deltas": norm,
            "ts": ts,
            "nonce": pw["nonce"],
            "diff": pw["diff"],
            "hash": pw["hash"],
            "sig": sig,
        })

    async def get_deltas(self, prefix: str = "") -> dict:
        q = f"?prefix={prefix}" if prefix else ""
        async with httpx.AsyncClient() as c:
            r = await c.get(f"{self.base_url}/sync/{self.addr}{q}", timeout=10)
            data = r.json()
            if r.status_code >= 400:
                raise RuntimeError(data.get("error") or f"HTTP {r.status_code}")
            return data

    # --- vector stub (kv with cosine in Python, matches spec) ---
    # GDBx flat-primitive rule: values must be string|number|boolean|null, so vector stored as JSON string
    async def put_vector(self, key: str, text: str, vector: List[float]) -> dict:
        return await self.put_deltas([{"key": key, "value": json.dumps({"text": text, "vector": vector}, ensure_ascii=False)}])

    async def search_vector(self, query_vec: List[float], top_k: int = 5, prefix: str = "aia/vectors/") -> List[dict]:
        data = await self.get_deltas(prefix)
        entries = data.get("entries") or data.get("deltas") or []
        # brute-force cosine
        def cosine(a, b):
            dot = sum(x * y for x, y in zip(a, b))
            na = math.sqrt(sum(x * x for x in a))
            nb = math.sqrt(sum(x * x for x in b))
            if na == 0 or nb == 0:
                return -1
            return dot / (na * nb)

        scored = []
        for e in entries:
            v = None
            val = e.get("value")
            if isinstance(val, dict) and "vector" in val:
                v = val["vector"]
            elif isinstance(val, str):
                try:
                    j = json.loads(val)
                    v = j.get("vector")
                except:
                    pass
            if v is None:
                continue
            scored.append((cosine(query_vec, v), e))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [{"score": s, "entry": e} for s, e in scored[:top_k]]

    # sync wrappers for AiA (which uses sync httpx)
    def register_did_sync(self, *a, **kw):
        import asyncio
        return asyncio.run(self.register_did(*a, **kw))

    def put_deltas_sync(self, *a, **kw):
        import asyncio
        return asyncio.run(self.put_deltas(*a, **kw))

    def get_deltas_sync(self, *a, **kw):
        import asyncio
        return asyncio.run(self.get_deltas(*a, **kw))
