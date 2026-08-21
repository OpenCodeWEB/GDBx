/**
 * FtpBridge.js — Sovereign FTP Edge Bridge (Worker/R2, Priority 4)
 *
 * For MVP, chunks are stored as GDBx pool deltas (sys/ftp/chunk/<hash>)
 * via GDBxFTP SDK — no separate Worker route needed. This file is a
 * placeholder for future R2 bucket integration:
 *
 *   POST /api/ftp/chunk — upload encrypted chunk to R2 GDBX_FTP_BUCKET
 *   GET  /api/ftp/chunk/<hash> — download
 *
 * If R2 is configured (env.GDBX_FTP_BUCKET), chunks go to R2 (cheaper, faster).
 * Else, fallback to pool (sovereign, already implemented in sdk/ftp_bridge.js).
 *
 * To enable R2:
 *   1. Create R2 bucket: wrangler r2 bucket create gdbx-ftp
 *   2. Add to wrangler.toml:
 *      [[r2_buckets]]
 *      binding = "GDBX_FTP_BUCKET"
 *      bucket_name = "gdbx-ftp"
 *   3. Redeploy: npx wrangler deploy --config worker/wrangler.toml
 */

export class FtpBridge {
  constructor(env) {
    this.env = env;
    this.r2 = env.GDBX_FTP_BUCKET || null;
  }

  async putChunk(hash, data) {
    if (this.r2) {
      await this.r2.put(`chunks/${hash}`, data);
      return { stored: "r2", hash };
    }
    // fallback: pool (already handled by GDBxFTP SDK via putDeltas)
    return { stored: "pool", hash };
  }

  async getChunk(hash) {
    if (this.r2) {
      const obj = await this.r2.get(`chunks/${hash}`);
      if (obj) return await obj.arrayBuffer();
    }
    // fallback: pool
    return null;
  }
}

export default FtpBridge;
