import Gun from "gun";
const g = new Gun({"peers":["https://gdbx.xup.workers.dev/gunx"],"radisk":false,"localStorage":false,"axe":false,"multicast":false});
setTimeout(() => {
  g.get("gdbx-client-test/1787595074046-live").on((d) => {
    if (d && d.message) { console.log("CHILD-GOT:" + d.message); process.exit(0); }
  });
}, 2500);
setTimeout(() => process.exit(2), 35000);