# Track: address-codec — `.GDBx` address format

## Problem
GDBx-এর identity/resource namespace দরকার — যেমন `.onion` Tor-কে বোঝায়, `.GDBx`
বোঝাবে Global Decentralized Database address। Format হতে হবে cryptographically
verifiable (checksummed), collision-resistant, multi-network capable।

## Design (Gemini-এর ডিজাইন অনুযায়ী, v3 onion থেকে উন্নত)

```
payload    = Version(1B) + NetworkType(1B) + PubKeyHash(32B) + Checksum(2B)
Checksum   = BLAKE3(Version + NetworkType + PubKeyHash)[0..2]   (2 bytes)
Address    = base32(payload, RFC4648, lowercase, no padding) + ".gdbx"
```

- **Hash:** BLAKE3 (আধুনিক, দ্রুত, collision-resistant; `@noble/hashes` — worker/node এ native no-WASM)
- **Version byte:** `0x01` (future: 0x02...) — format evolution
- **Network byte:** `0x00` mainnet (gdbx), `0x01` testnet, `0x02` local/LAN — multi-network isolation
- **PubKeyHash:** 32 bytes — SHA-256 of the P-256 (SEA) public key (uncompressed point)
- **Checksum:** প্রথম 2 bytes BLAKE3 — typo/forgery detection (onion v3-এর মতো)
- **Length:** 36 bytes payload → 58 base32 chars (no padding) + `.gdbx` suffix = 63 chars
- **DID:** `did:gdbx:<address-without-suffix>` (identity standard)

## Deliverables
1. `sdk/gdbx-codec.js` — ESM module: `makeAddress(pubkeyBytes|pubkeyJwk)`, `validateAddress(str)`, `normalizeAddress(str)`, `networkOf(str)`, `versionOf(str)` — pure functions, browser+worker+node compatible (no Gun dependency)
2. `test/test_codec.mjs` — unit tests:
   - known-vector address (deterministic input → exact output)
   - checksum flip-1-char → invalid
   - length/network/version validation
   - round-trip normalize (upper/lowercase, `.gdbx` suffix optional)
   - 1,000 random addresses: all validate; no false rejects
   - collision smoke: 10k addresses → unique set
3. `conductor/tracks/address-codec/{spec,plan}.md` + registry update

## Acceptance
- `node --test test/test_codec.mjs` → all pass
- Known-vector test proves determinism (regression guard)