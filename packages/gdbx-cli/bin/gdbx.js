#!/usr/bin/env node
import { Command } from "commander";
import { createIdentity, loadIdentity } from "../lib/identity.js";

const program = new Command();
program.name("gdbx").description("GDBx CLI — Global Decentralized DataBase Sync").version("0.1.0");

// identity
program
  .command("identity")
  .description("identity helpers")
  .argument("<action>", "create|show")
  .option("--net <net>", "mainnet|testnet|local", "mainnet")
  .option("--out <path>", "output key.json path")
  .action(async (action, opts) => {
    if (action === "create") {
      const b = await createIdentity(opts.net, opts.out);
      console.log(`\nGenerated .GDBx: ${b.addr}.gdbx`);
      console.log(`DID: ${b.did}`);
      console.log(`Pub: ${b.pub.slice(0,30)}...`);
      console.log(`Saved to: ${opts.out || "~/.gdbx/key.json"}`);
    } else if (action === "show") {
      const id = loadIdentity(opts.out);
      console.log(JSON.stringify({ addr: id.addr, did: id.did, pub: id.pub }, null, 2));
    } else {
      console.error("unknown identity action:", action);
      process.exit(1);
    }
  });

// sync
const sync = program.command("sync").description("sync deltas");
sync
  .command("put")
  .argument("<key>")
  .argument("<value>")
  .option("--prefix <prefix>", "")
  .action(async (key, value, opts) => {
    const { put } = await import("../lib/sync.js");
    const r = await put(key, value, opts);
    console.log(JSON.stringify(r, null, 2));
  });
sync
  .command("get")
  .option("--prefix <prefix>", "", "")
  .action(async (opts) => {
    const { get } = await import("../lib/sync.js");
    const r = await get(opts.prefix, opts);
    console.log(JSON.stringify(r, null, 2));
  });
sync
  .command("watch")
  .option("--prefix <prefix>", "", "")
  .action(async (opts) => {
    const { watch } = await import("../lib/sync.js");
    console.log(`Watching ${opts.prefix || "(all)"} — Ctrl+C to exit`);
    const ws = await watch(opts.prefix, (delta) => console.log("delta:", delta), opts);
    process.on("SIGINT", () => {
      ws.disconnect?.();
      process.exit(0);
    });
  });

// vector
const vector = program.command("vector").description("vector memory");
vector
  .command("put")
  .argument("<key>")
  .argument("<text>")
  .option("--vector <vec>", "comma separated floats, e.g. 0.1,0.2,0.3")
  .action(async (key, text, opts) => {
    const vec = opts.vector ? opts.vector.split(",").map(Number) : [0.1, 0.2, 0.3];
    const { putVector } = await import("../lib/vector.js");
    const r = await putVector(key, text, vec, opts);
    console.log(JSON.stringify(r, null, 2));
  });
vector
  .command("search")
  .option("--query <vec>", "comma separated floats")
  .option("--topk <n>", "top k", "3")
  .option("--prefix <prefix>", "aia/vectors/", "aia/vectors/")
  .action(async (opts) => {
    const q = opts.query ? opts.query.split(",").map(Number) : [0.1, 0.2, 0.3];
    const { searchVector } = await import("../lib/vector.js");
    const r = await searchVector(q, Number(opts.topk), opts.prefix, opts);
    console.log(JSON.stringify(r, null, 2));
  });

// backup
const backup = program.command("backup").description("snapshot");
backup
  .command("export")
  .option("--out <path>", "snapshot.json", "snapshot.json")
  .action(async (opts) => {
    const { exportSnapshot } = await import("../lib/backup.js");
    const r = await exportSnapshot(opts.out, opts);
    console.log(JSON.stringify(r, null, 2));
  });
backup
  .command("import")
  .option("--in <path>", "snapshot.json", "snapshot.json")
  .action(async (opts) => {
    const { importSnapshot } = await import("../lib/backup.js");
    const r = await importSnapshot(opts.in, opts);
    console.log(JSON.stringify(r, null, 2));
  });

// ftp — sovereign gateway (FileZilla → GDBx pool, GDBX1-signed, chunked)
const ftp = program.command("ftp").description("sovereign FTP gateway (FileZilla → GDBx pool)");
ftp
  .command("gateway")
  .description("start local FTP gateway on 127.0.0.1 (FileZilla → GDBx)")
  .option("--port <port>", "127.0.0.1:2121", "2121")
  .action(async (opts) => {
    const { startGateway } = await import("../lib/ftp.js");
    await startGateway({ port: Number(String(opts.port).split(":").pop()) });
  });
ftp
  .command("put")
  .description("upload local file to GDBx via FTP bridge (chunked, GDBX1-signed)")
  .argument("<localPath>")
  .argument("<remotePath>")
  .action(async (localPath, remotePath) => {
    const { ftpPut } = await import("../lib/ftp.js");
    const r = await ftpPut(localPath, remotePath);
    console.log(JSON.stringify(r, null, 2));
  });
ftp
  .command("get")
  .description("download GDBx file to local (reassemble chunks)")
  .argument("<remotePath>")
  .argument("<localPath>")
  .action(async (remotePath, localPath) => {
    const { ftpGet } = await import("../lib/ftp.js");
    const r = await ftpGet(remotePath, localPath);
    console.log(JSON.stringify(r, null, 2));
  });
ftp
  .command("ls")
  .description("list GDBx FTP manifests")
  .argument("[prefix]", "/", "/")
  .action(async (prefix) => {
    const { ftpLs } = await import("../lib/ftp.js");
    const r = await ftpLs(prefix);
    console.log(JSON.stringify(r, null, 2));
  });
ftp
  .command("sync")
  .description("watch GDBx FTP prefix for changes")
  .argument("[prefix]", "/", "/")
  .action(async (prefix) => {
    const { ftpSync } = await import("../lib/ftp.js");
    console.log(`Syncing ${prefix} — Ctrl+C to exit`);
    await ftpSync(prefix);
    // keep process alive
    await new Promise(() => {});
  });

program.parseAsync(process.argv);
