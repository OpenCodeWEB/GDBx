# GDBx ~ Global Decentralized DataBase Sync

> **Tagline:** এক address, সব প্রযুক্তি। | One address, every technology.

GDBx একটি ওপেনসোর্স, সার্ভারলেস, ডিসেন্ট্রালাইজড ডেটাবেস সিঙ্ক প্রোটোকল। যেভাবে
`.onion` Tor নেটওয়ার্ককে চিহ্নিত করে, `.GDBx` চিহ্নিত করে **Global Decentralized
DataBase** — একটি address namespace যা দিয়ে Tor v3, I2P, Nostr, WebRTC, IPFS,
GunDB mesh, এবং blockchain RPC — সব প্রযুক্তি একসাথে রাউটেবল।

## মূল ধারণা

- **`.GDBx` Address** — cryptographically verifiable, checksummed address
  (BLAKE3 checksum + Base32 RFC4648), যা একটি identity বা একটি resource-কে
  বহু-ট্রান্সপোর্টে ঠিকানা দেয়।
- **Multi-Transport Routing** — একই address-এ WebRTC (<20ms), Nostr (<150ms),
  Tor v3, I2P, IPFS — স্বয়ংক্রিয় transport selection + fallback।
- **Identity & Trust** — SEA (ECDSA P-256) public key identity, `did:gdbx:<addr>`
  DID Document, PoW anti-spam, HMAC-SHA256 signed deltas।
- **CRDT Sync Engine** — GunDB mesh-ভিত্তিক flat-primitives JSON schema,
  conflict-free merge, delta sync, presence heartbeat, pruning।
- **Serverless by Design** — Cloudflare Workers + Durable Objects + Pages;
  প্রতি-node local-first, কোন সেন্ট্রাল সার্ভার নেই।

## GunX থেকে উত্তরাধিকার

GunX (github.com/OpenCodeWEB/GunX) ছিল প্রুভ-অফ-কনসেপ্ট টেস্টবেড — সেখানে
Tor v3 onion validation, PoW+SEA minting, Durable Objects registry, payment
bridge, WebRTC direct transport, Nostr relay — সব প্রমাণিত হয়েছে (৩৬+ ইউনিট,
১৯ লাইভ E2E)। GDBx সেই প্রমাণিত আইডিয়ার প্রোডাকশন-গ্রেড সংস্করণ।

## বর্তমান স্ট্যাটাস

- Phase 0 (scaffold): conductor setup
- Phase 1: address codec (`.gdbx` format + tests)
- Phase 2: multi-transport router + DID resolver
- Phase 3: CRDT sync engine + GDBxStorageDO
- Phase 4: security hardening + live deploy (gdbx.pages.dev)

## Links

- Live: https://gdbx.pages.dev
- Repo: https://github.com/OpenCodeWEB/GDBX
- Docs: `conductor/`