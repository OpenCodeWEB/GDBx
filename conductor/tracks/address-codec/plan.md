# Plan — address-codec

## Steps (TDD)
1. `sdk/gdbx-codec.js` skeleton + `test/test_codec.mjs` (red — module missing)
2. Implement BLAKE3 usage (`@noble/hashes/blake3.js`), base32 encode/decode (RFC4648, no padding), checksum, address make/validate/normalize
3. Known-vector test: fixed pubkey bytes → expected address (compute once, lock in)
4. Green: all tests pass
5. `conductor/tracks.md` registry update + commit

## Order
tests → codec → vector lock → green → commit