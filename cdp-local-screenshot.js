const fs = require("fs");
const path = require("path");

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
    close() { ws.close(); },
  };
}

async function screenshot(targetUrl, width, height, fileName, fullPage = false) {
  const targets = await requestJson("http://127.0.0.1:9222/json");
  const page = targets.find(t => t.type === "page" && t.url === targetUrl);
  if (!page) throw new Error(`Target not found: ${targetUrl}`);
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await new Promise(resolve => setTimeout(resolve, 800));
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: fullPage, fromSurface: true });
  fs.writeFileSync(path.join(process.cwd(), fileName), Buffer.from(shot.data, "base64"));
  cdp.close();
}

async function main() {
  const url = "file:///D:/work/dprotect/site/index.html";
  await screenshot(url, 1440, 1000, "local-desktop.png", false);
  await screenshot(url, 390, 844, "local-mobile.png", true);
  console.log("Saved local-desktop.png and local-mobile.png");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
