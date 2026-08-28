var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../node_modules/@noble/hashes/esm/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function anumber(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function abytes(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}
function u8(arr) {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes(data);
  return data;
}
function createHasher(hashCons) {
  const hashC = /* @__PURE__ */ __name((msg) => hashCons().update(toBytes(msg)).digest(), "hashC");
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function createXOFer(hashCons) {
  const hashC = /* @__PURE__ */ __name((msg, opts) => hashCons(opts).update(toBytes(msg)).digest(), "hashC");
  const tmp = hashCons({});
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = (opts) => hashCons(opts);
  return hashC;
}
var isLE, swap8IfBE, swap32IfBE, Hash;
var init_utils = __esm({
  "../node_modules/@noble/hashes/esm/utils.js"() {
    init_functionsRoutes_0_3691018445422617();
    __name(isBytes, "isBytes");
    __name(anumber, "anumber");
    __name(abytes, "abytes");
    __name(aexists, "aexists");
    __name(aoutput, "aoutput");
    __name(u8, "u8");
    __name(u32, "u32");
    __name(clean, "clean");
    __name(createView, "createView");
    __name(rotr, "rotr");
    isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
    __name(byteSwap, "byteSwap");
    swap8IfBE = isLE ? (n) => n : (n) => byteSwap(n);
    __name(byteSwap32, "byteSwap32");
    swap32IfBE = isLE ? (u) => u : byteSwap32;
    __name(utf8ToBytes, "utf8ToBytes");
    __name(toBytes, "toBytes");
    Hash = class {
      static {
        __name(this, "Hash");
      }
    };
    __name(createHasher, "createHasher");
    __name(createXOFer, "createXOFer");
  }
});

// ../node_modules/@noble/hashes/esm/_md.js
function setBigUint64(view, byteOffset, value, isLE2) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE2);
  const _32n2 = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n2 & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE2 ? 4 : 0;
  const l = isLE2 ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE2);
  view.setUint32(byteOffset + l, wl, isLE2);
}
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD, SHA256_IV;
var init_md = __esm({
  "../node_modules/@noble/hashes/esm/_md.js"() {
    init_functionsRoutes_0_3691018445422617();
    init_utils();
    __name(setBigUint64, "setBigUint64");
    __name(Chi, "Chi");
    __name(Maj, "Maj");
    HashMD = class extends Hash {
      static {
        __name(this, "HashMD");
      }
      constructor(blockLen, outputLen, padOffset, isLE2) {
        super();
        this.finished = false;
        this.length = 0;
        this.pos = 0;
        this.destroyed = false;
        this.blockLen = blockLen;
        this.outputLen = outputLen;
        this.padOffset = padOffset;
        this.isLE = isLE2;
        this.buffer = new Uint8Array(blockLen);
        this.view = createView(this.buffer);
      }
      update(data) {
        aexists(this);
        data = toBytes(data);
        abytes(data);
        const { view, buffer, blockLen } = this;
        const len = data.length;
        for (let pos = 0; pos < len; ) {
          const take = Math.min(blockLen - this.pos, len - pos);
          if (take === blockLen) {
            const dataView = createView(data);
            for (; blockLen <= len - pos; pos += blockLen)
              this.process(dataView, pos);
            continue;
          }
          buffer.set(data.subarray(pos, pos + take), this.pos);
          this.pos += take;
          pos += take;
          if (this.pos === blockLen) {
            this.process(view, 0);
            this.pos = 0;
          }
        }
        this.length += data.length;
        this.roundClean();
        return this;
      }
      digestInto(out) {
        aexists(this);
        aoutput(out, this);
        this.finished = true;
        const { buffer, view, blockLen, isLE: isLE2 } = this;
        let { pos } = this;
        buffer[pos++] = 128;
        clean(this.buffer.subarray(pos));
        if (this.padOffset > blockLen - pos) {
          this.process(view, 0);
          pos = 0;
        }
        for (let i = pos; i < blockLen; i++)
          buffer[i] = 0;
        setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE2);
        this.process(view, 0);
        const oview = createView(out);
        const len = this.outputLen;
        if (len % 4)
          throw new Error("_sha2: outputLen should be aligned to 32bit");
        const outLen = len / 4;
        const state = this.get();
        if (outLen > state.length)
          throw new Error("_sha2: outputLen bigger than state");
        for (let i = 0; i < outLen; i++)
          oview.setUint32(4 * i, state[i], isLE2);
      }
      digest() {
        const { buffer, outputLen } = this;
        this.digestInto(buffer);
        const res = buffer.slice(0, outputLen);
        this.destroy();
        return res;
      }
      _cloneInto(to) {
        to || (to = new this.constructor());
        to.set(...this.get());
        const { blockLen, buffer, length, finished, destroyed, pos } = this;
        to.destroyed = destroyed;
        to.finished = finished;
        to.length = length;
        to.pos = pos;
        if (length % blockLen)
          to.buffer.set(buffer);
        return to;
      }
      clone() {
        return this._cloneInto();
      }
    };
    SHA256_IV = /* @__PURE__ */ Uint32Array.from([
      1779033703,
      3144134277,
      1013904242,
      2773480762,
      1359893119,
      2600822924,
      528734635,
      1541459225
    ]);
  }
});

// ../node_modules/@noble/hashes/esm/_u64.js
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
var U32_MASK64, _32n;
var init_u64 = __esm({
  "../node_modules/@noble/hashes/esm/_u64.js"() {
    init_functionsRoutes_0_3691018445422617();
    U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
    _32n = /* @__PURE__ */ BigInt(32);
    __name(fromBig, "fromBig");
  }
});

// ../node_modules/@noble/hashes/esm/_blake.js
function G1s(a, b, c, d, x) {
  a = a + b + x | 0;
  d = rotr(d ^ a, 16);
  c = c + d | 0;
  b = rotr(b ^ c, 12);
  return { a, b, c, d };
}
function G2s(a, b, c, d, x) {
  a = a + b + x | 0;
  d = rotr(d ^ a, 8);
  c = c + d | 0;
  b = rotr(b ^ c, 7);
  return { a, b, c, d };
}
var init_blake = __esm({
  "../node_modules/@noble/hashes/esm/_blake.js"() {
    init_functionsRoutes_0_3691018445422617();
    init_utils();
    __name(G1s, "G1s");
    __name(G2s, "G2s");
  }
});

// ../node_modules/@noble/hashes/esm/blake2.js
function compress(s, offset, msg, rounds, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15) {
  let j = 0;
  for (let i = 0; i < rounds; i++) {
    ({ a: v0, b: v4, c: v8, d: v12 } = G1s(v0, v4, v8, v12, msg[offset + s[j++]]));
    ({ a: v0, b: v4, c: v8, d: v12 } = G2s(v0, v4, v8, v12, msg[offset + s[j++]]));
    ({ a: v1, b: v5, c: v9, d: v13 } = G1s(v1, v5, v9, v13, msg[offset + s[j++]]));
    ({ a: v1, b: v5, c: v9, d: v13 } = G2s(v1, v5, v9, v13, msg[offset + s[j++]]));
    ({ a: v2, b: v6, c: v10, d: v14 } = G1s(v2, v6, v10, v14, msg[offset + s[j++]]));
    ({ a: v2, b: v6, c: v10, d: v14 } = G2s(v2, v6, v10, v14, msg[offset + s[j++]]));
    ({ a: v3, b: v7, c: v11, d: v15 } = G1s(v3, v7, v11, v15, msg[offset + s[j++]]));
    ({ a: v3, b: v7, c: v11, d: v15 } = G2s(v3, v7, v11, v15, msg[offset + s[j++]]));
    ({ a: v0, b: v5, c: v10, d: v15 } = G1s(v0, v5, v10, v15, msg[offset + s[j++]]));
    ({ a: v0, b: v5, c: v10, d: v15 } = G2s(v0, v5, v10, v15, msg[offset + s[j++]]));
    ({ a: v1, b: v6, c: v11, d: v12 } = G1s(v1, v6, v11, v12, msg[offset + s[j++]]));
    ({ a: v1, b: v6, c: v11, d: v12 } = G2s(v1, v6, v11, v12, msg[offset + s[j++]]));
    ({ a: v2, b: v7, c: v8, d: v13 } = G1s(v2, v7, v8, v13, msg[offset + s[j++]]));
    ({ a: v2, b: v7, c: v8, d: v13 } = G2s(v2, v7, v8, v13, msg[offset + s[j++]]));
    ({ a: v3, b: v4, c: v9, d: v14 } = G1s(v3, v4, v9, v14, msg[offset + s[j++]]));
    ({ a: v3, b: v4, c: v9, d: v14 } = G2s(v3, v4, v9, v14, msg[offset + s[j++]]));
  }
  return { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 };
}
var BLAKE2;
var init_blake2 = __esm({
  "../node_modules/@noble/hashes/esm/blake2.js"() {
    init_functionsRoutes_0_3691018445422617();
    init_blake();
    init_utils();
    BLAKE2 = class extends Hash {
      static {
        __name(this, "BLAKE2");
      }
      constructor(blockLen, outputLen) {
        super();
        this.finished = false;
        this.destroyed = false;
        this.length = 0;
        this.pos = 0;
        anumber(blockLen);
        anumber(outputLen);
        this.blockLen = blockLen;
        this.outputLen = outputLen;
        this.buffer = new Uint8Array(blockLen);
        this.buffer32 = u32(this.buffer);
      }
      update(data) {
        aexists(this);
        data = toBytes(data);
        abytes(data);
        const { blockLen, buffer, buffer32 } = this;
        const len = data.length;
        const offset = data.byteOffset;
        const buf = data.buffer;
        for (let pos = 0; pos < len; ) {
          if (this.pos === blockLen) {
            swap32IfBE(buffer32);
            this.compress(buffer32, 0, false);
            swap32IfBE(buffer32);
            this.pos = 0;
          }
          const take = Math.min(blockLen - this.pos, len - pos);
          const dataOffset = offset + pos;
          if (take === blockLen && !(dataOffset % 4) && pos + take < len) {
            const data32 = new Uint32Array(buf, dataOffset, Math.floor((len - pos) / 4));
            swap32IfBE(data32);
            for (let pos32 = 0; pos + blockLen < len; pos32 += buffer32.length, pos += blockLen) {
              this.length += blockLen;
              this.compress(data32, pos32, false);
            }
            swap32IfBE(data32);
            continue;
          }
          buffer.set(data.subarray(pos, pos + take), this.pos);
          this.pos += take;
          this.length += take;
          pos += take;
        }
        return this;
      }
      digestInto(out) {
        aexists(this);
        aoutput(out, this);
        const { pos, buffer32 } = this;
        this.finished = true;
        clean(this.buffer.subarray(pos));
        swap32IfBE(buffer32);
        this.compress(buffer32, 0, true);
        swap32IfBE(buffer32);
        const out32 = u32(out);
        this.get().forEach((v, i) => out32[i] = swap8IfBE(v));
      }
      digest() {
        const { buffer, outputLen } = this;
        this.digestInto(buffer);
        const res = buffer.slice(0, outputLen);
        this.destroy();
        return res;
      }
      _cloneInto(to) {
        const { buffer, length, finished, destroyed, outputLen, pos } = this;
        to || (to = new this.constructor({ dkLen: outputLen }));
        to.set(...this.get());
        to.buffer.set(buffer);
        to.destroyed = destroyed;
        to.finished = finished;
        to.length = length;
        to.pos = pos;
        to.outputLen = outputLen;
        return to;
      }
      clone() {
        return this._cloneInto();
      }
    };
    __name(compress, "compress");
  }
});

// ../node_modules/@noble/hashes/esm/blake3.js
var B3_Flags, B3_IV, B3_SIGMA, BLAKE3, blake3;
var init_blake3 = __esm({
  "../node_modules/@noble/hashes/esm/blake3.js"() {
    init_functionsRoutes_0_3691018445422617();
    init_md();
    init_u64();
    init_blake2();
    init_utils();
    B3_Flags = {
      CHUNK_START: 1,
      CHUNK_END: 2,
      PARENT: 4,
      ROOT: 8,
      KEYED_HASH: 16,
      DERIVE_KEY_CONTEXT: 32,
      DERIVE_KEY_MATERIAL: 64
    };
    B3_IV = SHA256_IV.slice();
    B3_SIGMA = /* @__PURE__ */ (() => {
      const Id = Array.from({ length: 16 }, (_, i) => i);
      const permute = /* @__PURE__ */ __name((arr) => [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8].map((i) => arr[i]), "permute");
      const res = [];
      for (let i = 0, v = Id; i < 7; i++, v = permute(v))
        res.push(...v);
      return Uint8Array.from(res);
    })();
    BLAKE3 = class _BLAKE3 extends BLAKE2 {
      static {
        __name(this, "BLAKE3");
      }
      constructor(opts = {}, flags2 = 0) {
        super(64, opts.dkLen === void 0 ? 32 : opts.dkLen);
        this.chunkPos = 0;
        this.chunksDone = 0;
        this.flags = 0 | 0;
        this.stack = [];
        this.posOut = 0;
        this.bufferOut32 = new Uint32Array(16);
        this.chunkOut = 0;
        this.enableXOF = true;
        const { key, context } = opts;
        const hasContext = context !== void 0;
        if (key !== void 0) {
          if (hasContext)
            throw new Error('Only "key" or "context" can be specified at same time');
          const k = toBytes(key).slice();
          abytes(k, 32);
          this.IV = u32(k);
          swap32IfBE(this.IV);
          this.flags = flags2 | B3_Flags.KEYED_HASH;
        } else if (hasContext) {
          const ctx = toBytes(context);
          const contextKey = new _BLAKE3({ dkLen: 32 }, B3_Flags.DERIVE_KEY_CONTEXT).update(ctx).digest();
          this.IV = u32(contextKey);
          swap32IfBE(this.IV);
          this.flags = flags2 | B3_Flags.DERIVE_KEY_MATERIAL;
        } else {
          this.IV = B3_IV.slice();
          this.flags = flags2;
        }
        this.state = this.IV.slice();
        this.bufferOut = u8(this.bufferOut32);
      }
      // Unused
      get() {
        return [];
      }
      set() {
      }
      b2Compress(counter, flags2, buf, bufPos = 0) {
        const { state: s, pos } = this;
        const { h, l } = fromBig(BigInt(counter), true);
        const { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 } = compress(B3_SIGMA, bufPos, buf, 7, s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], B3_IV[0], B3_IV[1], B3_IV[2], B3_IV[3], h, l, pos, flags2);
        s[0] = v0 ^ v8;
        s[1] = v1 ^ v9;
        s[2] = v2 ^ v10;
        s[3] = v3 ^ v11;
        s[4] = v4 ^ v12;
        s[5] = v5 ^ v13;
        s[6] = v6 ^ v14;
        s[7] = v7 ^ v15;
      }
      compress(buf, bufPos = 0, isLast = false) {
        let flags2 = this.flags;
        if (!this.chunkPos)
          flags2 |= B3_Flags.CHUNK_START;
        if (this.chunkPos === 15 || isLast)
          flags2 |= B3_Flags.CHUNK_END;
        if (!isLast)
          this.pos = this.blockLen;
        this.b2Compress(this.chunksDone, flags2, buf, bufPos);
        this.chunkPos += 1;
        if (this.chunkPos === 16 || isLast) {
          let chunk = this.state;
          this.state = this.IV.slice();
          for (let last, chunks = this.chunksDone + 1; isLast || !(chunks & 1); chunks >>= 1) {
            if (!(last = this.stack.pop()))
              break;
            this.buffer32.set(last, 0);
            this.buffer32.set(chunk, 8);
            this.pos = this.blockLen;
            this.b2Compress(0, this.flags | B3_Flags.PARENT, this.buffer32, 0);
            chunk = this.state;
            this.state = this.IV.slice();
          }
          this.chunksDone++;
          this.chunkPos = 0;
          this.stack.push(chunk);
        }
        this.pos = 0;
      }
      _cloneInto(to) {
        to = super._cloneInto(to);
        const { IV, flags: flags2, state, chunkPos, posOut, chunkOut, stack, chunksDone } = this;
        to.state.set(state.slice());
        to.stack = stack.map((i) => Uint32Array.from(i));
        to.IV.set(IV);
        to.flags = flags2;
        to.chunkPos = chunkPos;
        to.chunksDone = chunksDone;
        to.posOut = posOut;
        to.chunkOut = chunkOut;
        to.enableXOF = this.enableXOF;
        to.bufferOut32.set(this.bufferOut32);
        return to;
      }
      destroy() {
        this.destroyed = true;
        clean(this.state, this.buffer32, this.IV, this.bufferOut32);
        clean(...this.stack);
      }
      // Same as b2Compress, but doesn't modify state and returns 16 u32 array (instead of 8)
      b2CompressOut() {
        const { state: s, pos, flags: flags2, buffer32, bufferOut32: out32 } = this;
        const { h, l } = fromBig(BigInt(this.chunkOut++));
        swap32IfBE(buffer32);
        const { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 } = compress(B3_SIGMA, 0, buffer32, 7, s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], B3_IV[0], B3_IV[1], B3_IV[2], B3_IV[3], l, h, pos, flags2);
        out32[0] = v0 ^ v8;
        out32[1] = v1 ^ v9;
        out32[2] = v2 ^ v10;
        out32[3] = v3 ^ v11;
        out32[4] = v4 ^ v12;
        out32[5] = v5 ^ v13;
        out32[6] = v6 ^ v14;
        out32[7] = v7 ^ v15;
        out32[8] = s[0] ^ v8;
        out32[9] = s[1] ^ v9;
        out32[10] = s[2] ^ v10;
        out32[11] = s[3] ^ v11;
        out32[12] = s[4] ^ v12;
        out32[13] = s[5] ^ v13;
        out32[14] = s[6] ^ v14;
        out32[15] = s[7] ^ v15;
        swap32IfBE(buffer32);
        swap32IfBE(out32);
        this.posOut = 0;
      }
      finish() {
        if (this.finished)
          return;
        this.finished = true;
        clean(this.buffer.subarray(this.pos));
        let flags2 = this.flags | B3_Flags.ROOT;
        if (this.stack.length) {
          flags2 |= B3_Flags.PARENT;
          swap32IfBE(this.buffer32);
          this.compress(this.buffer32, 0, true);
          swap32IfBE(this.buffer32);
          this.chunksDone = 0;
          this.pos = this.blockLen;
        } else {
          flags2 |= (!this.chunkPos ? B3_Flags.CHUNK_START : 0) | B3_Flags.CHUNK_END;
        }
        this.flags = flags2;
        this.b2CompressOut();
      }
      writeInto(out) {
        aexists(this, false);
        abytes(out);
        this.finish();
        const { blockLen, bufferOut } = this;
        for (let pos = 0, len = out.length; pos < len; ) {
          if (this.posOut >= blockLen)
            this.b2CompressOut();
          const take = Math.min(blockLen - this.posOut, len - pos);
          out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
          this.posOut += take;
          pos += take;
        }
        return out;
      }
      xofInto(out) {
        if (!this.enableXOF)
          throw new Error("XOF is not possible after digest call");
        return this.writeInto(out);
      }
      xof(bytes) {
        anumber(bytes);
        return this.xofInto(new Uint8Array(bytes));
      }
      digestInto(out) {
        aoutput(out, this);
        if (this.finished)
          throw new Error("digest() was already called");
        this.enableXOF = false;
        this.writeInto(out);
        this.destroy();
        return out;
      }
      digest() {
        return this.digestInto(new Uint8Array(this.outputLen));
      }
    };
    blake3 = /* @__PURE__ */ createXOFer((opts) => new BLAKE3(opts));
  }
});

// ../node_modules/@noble/hashes/esm/sha2.js
var SHA256_K, SHA256_W, SHA256, sha256;
var init_sha2 = __esm({
  "../node_modules/@noble/hashes/esm/sha2.js"() {
    init_functionsRoutes_0_3691018445422617();
    init_md();
    init_utils();
    SHA256_K = /* @__PURE__ */ Uint32Array.from([
      1116352408,
      1899447441,
      3049323471,
      3921009573,
      961987163,
      1508970993,
      2453635748,
      2870763221,
      3624381080,
      310598401,
      607225278,
      1426881987,
      1925078388,
      2162078206,
      2614888103,
      3248222580,
      3835390401,
      4022224774,
      264347078,
      604807628,
      770255983,
      1249150122,
      1555081692,
      1996064986,
      2554220882,
      2821834349,
      2952996808,
      3210313671,
      3336571891,
      3584528711,
      113926993,
      338241895,
      666307205,
      773529912,
      1294757372,
      1396182291,
      1695183700,
      1986661051,
      2177026350,
      2456956037,
      2730485921,
      2820302411,
      3259730800,
      3345764771,
      3516065817,
      3600352804,
      4094571909,
      275423344,
      430227734,
      506948616,
      659060556,
      883997877,
      958139571,
      1322822218,
      1537002063,
      1747873779,
      1955562222,
      2024104815,
      2227730452,
      2361852424,
      2428436474,
      2756734187,
      3204031479,
      3329325298
    ]);
    SHA256_W = /* @__PURE__ */ new Uint32Array(64);
    SHA256 = class extends HashMD {
      static {
        __name(this, "SHA256");
      }
      constructor(outputLen = 32) {
        super(64, outputLen, 8, false);
        this.A = SHA256_IV[0] | 0;
        this.B = SHA256_IV[1] | 0;
        this.C = SHA256_IV[2] | 0;
        this.D = SHA256_IV[3] | 0;
        this.E = SHA256_IV[4] | 0;
        this.F = SHA256_IV[5] | 0;
        this.G = SHA256_IV[6] | 0;
        this.H = SHA256_IV[7] | 0;
      }
      get() {
        const { A, B, C, D, E, F, G, H } = this;
        return [A, B, C, D, E, F, G, H];
      }
      // prettier-ignore
      set(A, B, C, D, E, F, G, H) {
        this.A = A | 0;
        this.B = B | 0;
        this.C = C | 0;
        this.D = D | 0;
        this.E = E | 0;
        this.F = F | 0;
        this.G = G | 0;
        this.H = H | 0;
      }
      process(view, offset) {
        for (let i = 0; i < 16; i++, offset += 4)
          SHA256_W[i] = view.getUint32(offset, false);
        for (let i = 16; i < 64; i++) {
          const W15 = SHA256_W[i - 15];
          const W2 = SHA256_W[i - 2];
          const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
          const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
          SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
        }
        let { A, B, C, D, E, F, G, H } = this;
        for (let i = 0; i < 64; i++) {
          const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
          const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
          const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
          const T2 = sigma0 + Maj(A, B, C) | 0;
          H = G;
          G = F;
          F = E;
          E = D + T1 | 0;
          D = C;
          C = B;
          B = A;
          A = T1 + T2 | 0;
        }
        A = A + this.A | 0;
        B = B + this.B | 0;
        C = C + this.C | 0;
        D = D + this.D | 0;
        E = E + this.E | 0;
        F = F + this.F | 0;
        G = G + this.G | 0;
        H = H + this.H | 0;
        this.set(A, B, C, D, E, F, G, H);
      }
      roundClean() {
        clean(SHA256_W);
      }
      destroy() {
        this.set(0, 0, 0, 0, 0, 0, 0, 0);
        clean(this.buffer);
      }
    };
    sha256 = /* @__PURE__ */ createHasher(() => new SHA256());
  }
});

// _lib/gdbx-codec.js
var gdbx_codec_exports = {};
__export(gdbx_codec_exports, {
  ADDR_LEN: () => ADDR_LEN,
  FULL_LEN: () => FULL_LEN,
  LEGACY_ADDR_LEN: () => LEGACY_ADDR_LEN,
  NETWORKS: () => NETWORKS,
  NETWORK_NAMES: () => NETWORK_NAMES,
  SUFFIX: () => SUFFIX,
  VERSION: () => VERSION,
  base32Decode: () => base32Decode,
  base32Encode: () => base32Encode,
  default: () => gdbx_codec_default,
  makeAddress: () => makeAddress,
  networkOf: () => networkOf,
  normalizeAddress: () => normalizeAddress,
  pubKeyHash: () => pubKeyHash,
  toDID: () => toDID,
  validateAddress: () => validateAddress,
  versionOf: () => versionOf
});
function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = value << 8 | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[value >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[value << 5 - bits & 31];
  return out;
}
function base32Decode(str) {
  const clean2 = str.toLowerCase().replace(/[^a-z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean2) {
    value = value << 5 | B32_REVERSE[ch];
    bits += 5;
    if (bits >= 8) {
      out.push(value >>> bits - 8 & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}
function pubKeyHash(pubkey) {
  let bytes;
  if (pubkey instanceof Uint8Array) bytes = pubkey;
  else if (typeof pubkey === "string") {
    const hex = pubkey.replace(/^0x/i, "");
    bytes = Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));
  } else if (pubkey && pubkey.x && pubkey.y) {
    const x = normalize32(pubkey.x);
    const y = normalize32(pubkey.y);
    bytes = new Uint8Array(65);
    bytes[0] = 4;
    bytes.set(x, 1);
    bytes.set(y, 33);
  } else {
    throw new Error("pubkey must be Uint8Array(65), hex string, or {x,y}");
  }
  if (bytes.length !== 65 || bytes[0] !== 4) {
    throw new Error("pubkey must be an uncompressed P-256 point (65 bytes, 0x04 prefix)");
  }
  return sha256(bytes);
}
function normalize32(v) {
  if (v instanceof Uint8Array) {
    if (v.length === 32) return v;
    const out = new Uint8Array(32);
    out.set(v.slice(0, 32));
    return out;
  }
  const hex = String(v).replace(/^0x/i, "");
  const bytes = Uint8Array.from(hex.padStart(64, "0").match(/../g) || [], (h) => parseInt(h, 16));
  return bytes;
}
function makeAddress(pubkey, _network) {
  const hash = pubKeyHash(pubkey);
  const payload = new Uint8Array(1 + 32 + 2);
  payload[0] = VERSION;
  payload.set(hash, 1);
  const checksum = blake3(payload.subarray(0, 33)).subarray(0, 2);
  payload.set(checksum, 33);
  return base32Encode(payload);
}
function validateAddress(input) {
  if (typeof input !== "string") return { ok: false, error: "address must be a string" };
  const str = input.trim().toLowerCase();
  if (FULL_RE.test(str)) return validatePayload(base32Decode(str.slice(0, ADDR_LEN)));
  if (ADDR_RE.test(str)) return validatePayload(base32Decode(str));
  if (LEGACY_FULL_RE.test(str)) return validatePayload(base32Decode(str.slice(0, LEGACY_ADDR_LEN)));
  if (LEGACY_ADDR_RE.test(str)) return validatePayload(base32Decode(str));
  return {
    ok: false,
    error: `invalid .gdbx address \u2014 expected 56 base32 chars (a-z2-7)${SUFFIX ? " + '.gdbx'" : ""}`
  };
}
function validatePayload(payload) {
  if (payload.length === 35) {
    if (payload[0] !== VERSION) return { ok: false, error: `unsupported version ${payload[0]}` };
    const expect = blake3(payload.subarray(0, 33)).subarray(0, 2);
    if (payload[33] !== expect[0] || payload[34] !== expect[1]) {
      return { ok: false, error: "checksum mismatch \u2014 address is invalid or corrupted" };
    }
    return { ok: true };
  }
  if (payload.length === 36) {
    if (payload[0] !== VERSION) return { ok: false, error: `unsupported version ${payload[0]}` };
    const expect = blake3(payload.subarray(0, 34)).subarray(0, 2);
    if (payload[34] !== expect[0] || payload[35] !== expect[1]) {
      return { ok: false, error: "checksum mismatch \u2014 address is invalid or corrupted" };
    }
    return { ok: true };
  }
  return { ok: false, error: "decoded length must be 35 or 36 bytes" };
}
function normalizeAddress(input) {
  const str = String(input || "").trim().toLowerCase();
  const bare = str.endsWith(`.${SUFFIX}`) ? str.slice(0, -SUFFIX.length - 1) : str;
  const v = validateAddress(bare);
  if (!v.ok) return null;
  return bare;
}
function networkOf(input) {
  const bare = normalizeAddress(input);
  if (!bare) return null;
  const payload = base32Decode(bare);
  if (payload.length === 35) return "gdbx";
  if (payload.length === 36) {
    const legacyNames = { 0: "gdbx", 1: "gdbx", 2: "gdbx" };
    return legacyNames[payload[1]] || "gdbx";
  }
  return null;
}
function versionOf(input) {
  const bare = normalizeAddress(input);
  if (!bare) return null;
  return base32Decode(bare)[0];
}
function toDID(address) {
  const bare = normalizeAddress(address);
  return bare ? `did:gdbx:${bare}` : null;
}
var SUFFIX, VERSION, NETWORKS, NETWORK_NAMES, LEGACY_ADDR_LEN, ADDR_LEN, FULL_LEN, B32_ALPHABET, B32_REVERSE, ADDR_RE, LEGACY_ADDR_RE, FULL_RE, LEGACY_FULL_RE, gdbx_codec_default;
var init_gdbx_codec = __esm({
  "_lib/gdbx-codec.js"() {
    init_functionsRoutes_0_3691018445422617();
    init_blake3();
    init_sha2();
    SUFFIX = "gdbx";
    VERSION = 1;
    NETWORKS = { gdbx: 0 };
    NETWORK_NAMES = { 0: "gdbx" };
    LEGACY_ADDR_LEN = 58;
    ADDR_LEN = 56;
    FULL_LEN = ADDR_LEN + 1 + SUFFIX.length;
    B32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
    B32_REVERSE = (() => {
      const m = {};
      for (let i = 0; i < B32_ALPHABET.length; i++) m[B32_ALPHABET[i]] = i;
      return m;
    })();
    ADDR_RE = /^[a-z2-7]{56}$/;
    LEGACY_ADDR_RE = /^[a-z2-7]{58}$/;
    FULL_RE = /^[a-z2-7]{56}\.gdbx$/;
    LEGACY_FULL_RE = /^[a-z2-7]{58}\.gdbx$/;
    __name(base32Encode, "base32Encode");
    __name(base32Decode, "base32Decode");
    __name(pubKeyHash, "pubKeyHash");
    __name(normalize32, "normalize32");
    __name(makeAddress, "makeAddress");
    __name(validateAddress, "validateAddress");
    __name(validatePayload, "validatePayload");
    __name(normalizeAddress, "normalizeAddress");
    __name(networkOf, "networkOf");
    __name(versionOf, "versionOf");
    __name(toDID, "toDID");
    gdbx_codec_default = { makeAddress, validateAddress, normalizeAddress, networkOf, versionOf, toDID, SUFFIX, NETWORKS };
  }
});

// api/v1/[[path]].js
async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type"
      }
    });
  }
  const path = url.pathname.replace(/^\/api\/v1\/?/, "");
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "health" && request.method === "GET") {
    return json({ ok: true, service: "gdbx", ts: Date.now() });
  }
  if (segments[0] === "address" && request.method === "POST" && segments.length === 1) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid json" }, 400);
    }
    const hex = String(body?.pubkey || "").replace(/^0x/i, "");
    if (!/^[0-9a-fA-F]{130}$/.test(hex)) {
      return json({ error: "pubkey must be 130-char hex (uncompressed P-256: 04||X||Y)" }, 400);
    }
    const network = body?.network ?? 0;
    if (![0, 1, 2].includes(network)) return json({ error: "network must be 0|1|2" }, 400);
    try {
      const codec = await importCodec();
      const address = codec.makeAddress(hex, network);
      return json({
        ok: true,
        address: address + ".gdbx",
        bare: address,
        did: codec.toDID(address),
        network: codec.networkOf(address),
        version: codec.versionOf(address)
      }, 201);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 400);
    }
  }
  if (segments[0] === "address" && segments.length === 2 && request.method === "GET") {
    const codec = await importCodec();
    const v = codec.validateAddress(segments[1]);
    if (!v.ok) return json({ ok: false, error: v.error }, 400);
    const bare = codec.normalizeAddress(segments[1]);
    return json({
      ok: true,
      address: bare + ".gdbx",
      did: codec.toDID(bare),
      network: codec.networkOf(bare),
      version: codec.versionOf(bare)
    });
  }
  if (segments[0] === "did" && segments[1] === "register" && request.method === "POST") {
    return await storageFetch(env, "/did", request);
  }
  if (segments[0] === "did" && segments.length === 2 && request.method === "GET") {
    return await storageFetch(env, "/did/" + segments[1], request);
  }
  if (segments[0] === "sync" && request.method === "POST") {
    return await storageFetch(env, "/sync", request);
  }
  if (segments[0] === "sync" && segments.length >= 2 && request.method === "GET") {
    const rest = segments.slice(1).join("/");
    return await storageFetch(env, "/sync/" + rest, request);
  }
  if (segments[0] === "peers" && request.method === "POST") {
    return await storageFetch(env, "/peers", request);
  }
  if (segments[0] === "stats" && request.method === "GET") {
    return await storageFetch(env, "/stats", request);
  }
  if (segments[0] === "identity" && segments.length === 1 && request.method === "DELETE") {
    return await storageFetch(env, "/identity", request);
  }
  if (segments[0] === "export" && segments.length === 1 && request.method === "POST") {
    return await storageFetch(env, "/export", request);
  }
  if (segments[0] === "leaderboard" && segments.length === 1 && request.method === "GET") {
    return await storageFetch(env, "/leaderboard", request);
  }
  if (segments[0] === "ws" && segments.length === 1) {
    return await storageFetch(env, "/ws" + (url.search || ""), request);
  }
  return json({ error: "not found" }, 404);
}
async function storageFetch(env, targetPath, request) {
  const id = env.GDBX_STORAGE.idFromName("default");
  const stub = env.GDBX_STORAGE.get(id);
  const target = new URL(request.url);
  target.pathname = targetPath;
  const proxy = new Request(target.toString(), {
    method: request.method,
    headers: request.headers,
    body: ["POST", "DELETE"].includes(request.method) ? await request.text() : void 0
  });
  return stub.fetch(proxy);
}
async function importCodec() {
  if (!_codec) _codec = await Promise.resolve().then(() => (init_gdbx_codec(), gdbx_codec_exports));
  return _codec;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}
var _codec;
var init_path = __esm({
  "api/v1/[[path]].js"() {
    init_functionsRoutes_0_3691018445422617();
    __name(onRequest, "onRequest");
    __name(storageFetch, "storageFetch");
    _codec = null;
    __name(importCodec, "importCodec");
    __name(json, "json");
  }
});

// api/imgbb.js
function rateLimited(ip) {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_MAX;
}
function json2(body, status = 200, origin = "*") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-gdbx-key"
    }
  });
}
async function onRequest2(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return json2({ ok: true });
  if (request.method !== "POST") return json2({ error: "method not allowed" }, 405);
  const origin = request.headers.get("origin") || "";
  const allowlisted = ALLOWED_ORIGIN_SUFFIXES.some((s) => origin.endsWith(s));
  const uploadKey = env.GDBX_UPLOAD_KEY;
  const hasKey = uploadKey && request.headers.get("x-gdbx-key") === uploadKey;
  if (!allowlisted && !hasKey) return json2({ error: "origin not allowed" }, 403);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (rateLimited(ip)) return json2({ error: "rate limited" }, 429);
  const imgbbKey = env.IMGBB_KEY;
  if (!imgbbKey) return json2({ error: "imgbb key not configured \u2014 use chunked GDBx delta fallback" }, 500);
  let form;
  try {
    form = await request.formData();
  } catch {
    return json2({ error: "invalid multipart form" }, 400);
  }
  const file = form.get("image");
  if (!file || typeof file === "string") return json2({ error: "image file required (field 'image')" }, 400);
  if (!(file.type || "").startsWith("image/")) return json2({ error: "only image/* allowed" }, 415);
  if (file.size > MAX_IMAGE_BYTES) return json2({ error: "image too large (max 10 MB)" }, 413);
  const imgbb = new FormData();
  imgbb.append("key", imgbbKey);
  imgbb.append("image", file, file.name || "upload.png");
  let res;
  try {
    res = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: imgbb });
  } catch {
    return json2({ error: "imgbb unreachable" }, 502);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || !data || !data.data) {
    const msg = data && data.error && (data.error.message || data.error.code) || `imgbb upload failed (${res.status})`;
    return json2({ error: String(msg) }, 502);
  }
  const d = data.data;
  return json2({ url: d.url, display_url: d.display_url, delete_url: d.delete_url, thumb: d.thumb, width: d.width, height: d.height, size: d.size, time: d.time });
}
var ALLOWED_ORIGIN_SUFFIXES, MAX_IMAGE_BYTES, RATE_WINDOW_MS, RATE_MAX, buckets;
var init_imgbb = __esm({
  "api/imgbb.js"() {
    init_functionsRoutes_0_3691018445422617();
    ALLOWED_ORIGIN_SUFFIXES = [
      "https://gdbx.pages.dev",
      ".gdbx.pages.dev",
      "http://localhost:8788",
      "http://localhost:8787",
      "http://localhost:5173"
    ];
    MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    RATE_WINDOW_MS = 60 * 1e3;
    RATE_MAX = 20;
    buckets = /* @__PURE__ */ new Map();
    __name(rateLimited, "rateLimited");
    __name(json2, "json");
    __name(onRequest2, "onRequest");
  }
});

// n/[name].js
async function onRequestGet(context) {
  const { params, env } = context;
  const name = String(params.name || "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) {
    return json3({ ok: false, error: "invalid name" }, 400);
  }
  const id = env.GDBX_STORAGE.idFromName("default");
  const stub = env.GDBX_STORAGE.get(id);
  const entryRes = await stub.fetch(new Request(`https://do.local/name/${name}`));
  const data = await entryRes.json().catch(() => ({}));
  if (!entryRes.ok || !data.ok) {
    return json3({ ok: false, error: data.error || `HTTP ${entryRes.status}` }, entryRes.status === 404 ? 404 : 502);
  }
  const target = String(data.target || "");
  if (/^https?:\/\//i.test(target)) {
    return new Response(null, {
      status: 302,
      headers: { location: target, "access-control-allow-origin": "*" }
    });
  }
  return json3(data);
}
function json3(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}
var init_name = __esm({
  "n/[name].js"() {
    init_functionsRoutes_0_3691018445422617();
    __name(onRequestGet, "onRequestGet");
    __name(json3, "json");
  }
});

// gunx.js
async function onRequest3(context) {
  const { request } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  const upgrade = request.headers.get("upgrade");
  if (upgrade && upgrade.toLowerCase() === "websocket") {
    return new Response(
      JSON.stringify({
        err: "websocket-upgrade-not-proxied",
        hint: "use wss://gdbx.xup.workers.dev/gunx for live gun peering"
      }),
      { status: 426, headers: { ...CORS, "content-type": "application/json", upgrade: "websocket" } }
    );
  }
  if (request.method === "POST") {
    const body = await request.text();
    return fetch(WORKER_GUN, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    });
  }
  try {
    const stats = await fetch("https://gdbx.xup.workers.dev/gunx/stats").then((r) => r.json());
    return new Response(
      JSON.stringify({
        status: "websocket required",
        peer: "/gunx",
        ws: "wss://gdbx.xup.workers.dev/gunx",
        http: "POST https://gdbx.pages.dev/gunx",
        engine: "GunX-compat (GunX absorbed into GDBx)",
        stats
      }),
      { status: 426, headers: { ...CORS, "content-type": "application/json", upgrade: "websocket" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ status: "websocket required", ws: "wss://gdbx.xup.workers.dev/gunx" }),
      { status: 426, headers: { ...CORS, "content-type": "application/json", upgrade: "websocket" } }
    );
  }
}
var WORKER_GUN, CORS;
var init_gunx = __esm({
  "gunx.js"() {
    init_functionsRoutes_0_3691018445422617();
    WORKER_GUN = "https://gdbx.xup.workers.dev/gunx";
    CORS = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    };
    __name(onRequest3, "onRequest");
  }
});

// ../.wrangler/tmp/pages-ZsMAuB/functionsRoutes-0.3691018445422617.mjs
var routes;
var init_functionsRoutes_0_3691018445422617 = __esm({
  "../.wrangler/tmp/pages-ZsMAuB/functionsRoutes-0.3691018445422617.mjs"() {
    init_path();
    init_imgbb();
    init_name();
    init_gunx();
    routes = [
      {
        routePath: "/api/v1/:path*",
        mountPath: "/api/v1",
        method: "",
        middlewares: [],
        modules: [onRequest]
      },
      {
        routePath: "/api/imgbb",
        mountPath: "/api",
        method: "",
        middlewares: [],
        modules: [onRequest2]
      },
      {
        routePath: "/n/:name",
        mountPath: "/n",
        method: "GET",
        middlewares: [],
        modules: [onRequestGet]
      },
      {
        routePath: "/gunx",
        mountPath: "/",
        method: "",
        middlewares: [],
        modules: [onRequest3]
      }
    ];
  }
});

// ../node_modules/wrangler/templates/pages-template-worker.ts
init_functionsRoutes_0_3691018445422617();

// ../node_modules/path-to-regexp/dist.es2015/index.js
init_functionsRoutes_0_3691018445422617();
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
/*! Bundled license information:

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
