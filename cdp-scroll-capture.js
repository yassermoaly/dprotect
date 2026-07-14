const fs = require("fs");
const path = require("path");

const outDir = path.join(process.cwd(), "capture", "scroll");
fs.mkdirSync(outDir, { recursive: true });

async function requestJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const msg = JSON.parse(event.data);
    if (pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  });
  return {
    send(method, params = {}) {
      const callId = ++id;
      ws.send(JSON.stringify({ id: callId, method, params }));
      return new Promise((resolve, reject) => pending.set(callId, { resolve, reject }));
    },
    close() {
      ws.close();
    },
  };
}

async function main() {
  const targets = await requestJson("http://127.0.0.1:9222/json");
  const page = targets.find(t => t.type === "page" && t.url.startsWith("https://tkxcqt25w6.preview.c40.airoapp.ai/"));
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const evalExpr = async expression => cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  const height = (await evalExpr("document.documentElement.scrollHeight")).result.value;

  for (let y = 0, i = 0; y < height; y += 850, i++) {
    await evalExpr(`new Promise(resolve => { window.scrollTo(0, ${y}); setTimeout(resolve, 900); })`);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(outDir, `${String(i).padStart(2, "0")}-${y}.png`), Buffer.from(shot.data, "base64"));
  }

  cdp.close();
  console.log(`Captured scroll screenshots in ${outDir}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
