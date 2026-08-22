/**
 * ftp.js — GDBx FTP Gateway (local loopback, FileZilla compatible)
 *
 * Starts ftp-srv on 127.0.0.1:2121, translates FTP commands to GDBx pool
 * via GDBxFTP SDK (GDBx-signed, chunked, pool-replicated).
 *
 * Usage: gdbx ftp gateway --port 2121
 *   FileZilla: Host 127.0.0.1, Port 2121, Username <addr>.gdbx, Password <priv> (or any)
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

let FtpSrv;
try {
  FtpSrv = require("ftp-srv");
  // ftp-srv is CJS, may be default export
  if (FtpSrv && FtpSrv.default) FtpSrv = FtpSrv.default;
} catch {
  FtpSrv = null;
}

import { loadIdentity } from "./identity.js";
import { GDBxFTP } from "../../../sdk/ftp_bridge.js";

export async function startGateway(opts = {}) {
  const port = Number(opts.port || 2121);
  const url = `ftp://127.0.0.1:${port}`;
  if (!FtpSrv) throw new Error("ftp-srv not installed — run npm install");

  const identity = loadIdentity(opts.keyPath);
  const ftp = new GDBxFTP({ pair: { pub: identity.pub, priv: identity.priv }, pubkeyHex: identity.pubkeyHex || identity.pubkey_hex, addr: identity.addr });

  const server = new FtpSrv({
    url,
    pasv_url: "127.0.0.1",
    pasv_min: 1024,
    pasv_max: 1048,
    anonymous: false,
  });

  server.on("login", ({ connection, username, password }, resolve, reject) => {
    // Username is expected to be <addr>.gdbx or addr, password is priv or session token
    // For MVP, accept any username that matches local addr or "anonymous", and any password
    // In production, verify GDBx signature of password
    const cleanUser = String(username || "").replace(/\.gdbx$/i, "").toLowerCase();
    const localAddr = String(identity.addr || "").toLowerCase();
    if (cleanUser && cleanUser !== localAddr && cleanUser !== "anonymous" && cleanUser !== "gdbx") {
      // still allow for demo, but log
      console.warn(`[ftp] login as ${username} (local ${localAddr}) — allowing for demo`);
    }
    // Provide a simple filesystem that maps to GDBxFTP
    const fs = {
      // required by ftp-srv: get, put, list, etc. We implement via GDBxFTP
      // ftp-srv expects fs to have methods, but we can also use connection events
    };
    // Use connection event handlers for STOR/RETR/LIST
    connection.on("STOR", async (data, path) => {
      try {
        const chunks = [];
        for await (const chunk of data) chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        await ftp.put(buf, path);
        console.log(`[ftp] STOR ${path} (${buf.length}B) → GDBx pool`);
      } catch (e) {
        console.error(`[ftp] STOR ${path} failed:`, e.message);
        throw e;
      }
    });
    connection.on("RETR", async (path) => {
      try {
        const data = await ftp.get(path);
        return data;
      } catch (e) {
        console.error(`[ftp] RETR ${path} failed:`, e.message);
        throw e;
      }
    });
    // For LIST, ftp-srv will call fs.list, but we can handle via connection.on("LIST")
    // Fallback: provide list via GDBxFTP.ls
    // ftp-srv's custom FS is not fully implemented here; we rely on connection events for LIST as well
    // To make LIST work, we provide a minimal fs with list
    const gfs = {
      get: async (path) => {
        const data = await ftp.get(path);
        return { name: path.split("/").pop() || path, size: data.length, isDirectory: () => false };
      },
      list: async (path) => {
        const entries = await ftp.ls(path || "/");
        return entries.map((e) => ({
          name: e.key.replace(`sys/ftp/manifest${path}`, "").replace(/^\//, "") || e.key.split("/").pop(),
          size: e.manifest?.size || 0,
          isDirectory: () => false,
          modifyTime: new Date(e.manifest?.updatedAt || Date.now()),
        }));
      },
    };
    resolve({ root: "/", cwd: "/", fs: gfs });
  });

  await server.listen();
  console.log(`[ftp] GDBx FTP Gateway listening on ${url} — FileZilla: Host 127.0.0.1 Port ${port} User ${identity.addr}.gdbx`);
  console.log(`[ftp] GDBx pool: ${identity.addr} — .GDBx sovereign, GDBx-signed, chunked`);
  return server;
}

// also export helpers for CLI commands (put/get/ls/sync without gateway)
export async function ftpPut(localPath, remotePath, opts = {}) {
  const { readFile } = await import("node:fs/promises");
  const identity = loadIdentity(opts.keyPath);
  const ftp = new GDBxFTP({ pair: { pub: identity.pub, priv: identity.priv }, pubkeyHex: identity.pubkeyHex || identity.pubkey_hex, addr: identity.addr });
  const data = await readFile(localPath);
  return ftp.put(data, remotePath);
}
export async function ftpGet(remotePath, localPath, opts = {}) {
  const { writeFile } = await import("node:fs/promises");
  const identity = loadIdentity(opts.keyPath);
  const ftp = new GDBxFTP({ pair: { pub: identity.pub, priv: identity.priv }, pubkeyHex: identity.pubkeyHex || identity.pubkey_hex, addr: identity.addr });
  const data = await ftp.get(remotePath);
  await writeFile(localPath, data);
  return { path: remotePath, size: data.length };
}
export async function ftpLs(prefix, opts = {}) {
  const identity = loadIdentity(opts.keyPath);
  const ftp = new GDBxFTP({ pair: { pub: identity.pub, priv: identity.priv }, pubkeyHex: identity.pubkeyHex || identity.pubkey_hex, addr: identity.addr });
  return ftp.ls(prefix);
}
export async function ftpSync(prefix, opts = {}) {
  const identity = loadIdentity(opts.keyPath);
  const ftp = new GDBxFTP({ pair: { pub: identity.pub, priv: identity.priv }, pubkeyHex: identity.pubkeyHex || identity.pubkey_hex, addr: identity.addr });
  return ftp.sync(prefix, (ev) => console.log(`[sync] ${ev.path}`, ev.manifest?.size || 0));
}
