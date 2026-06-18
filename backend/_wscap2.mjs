import WebSocket from "ws";
import fs from "fs";
const ws = new WebSocket("wss://nabs1.emperorservers.com/api/race-control", { headers: { Origin: "https://nabs1.emperorservers.com" } });
const seen = {}; const out = [];
function log(s){ out.push(s); }
ws.on("message", (buf) => {
  let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
  const et = msg.EventType; seen[et]=(seen[et]||0)+1;
  if (seen[et] === 1) {
    const m = msg.Message;
    const keys = m && typeof m==="object" ? Object.keys(m).join(",") : JSON.stringify(m);
    log(`FIRST ET=${et} keys=[${keys}]`);
    if (![53,57,200].includes(et)) log(`  full: ${JSON.stringify(m).slice(0,500)}`);
  }
  if (et===200 && seen[200]===1) {
    const m = msg.Message;
    log(`BestLap=${JSON.stringify(m.BestLap)}`);
    log(`BestSplits=${JSON.stringify(m.BestSplits).slice(0,300)}`);
    const d = Object.values(m.ConnectedDrivers.Drivers)[0];
    log(`driver.Cars=${JSON.stringify(d.Cars).slice(0,600)}`);
  }
});
ws.on("error", (e)=>log("ERR "+e.message));
setTimeout(()=>{ log("COUNTS "+JSON.stringify(seen)); fs.writeFileSync("_wscap_out.txt", out.join("\n")); ws.close(); process.exit(0); }, 80000);
