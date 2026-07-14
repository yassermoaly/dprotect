const fs = require("fs");
const path = require("path");

const outDir = path.join(process.cwd(), "capture");
fs.mkdirSync(outDir, { recursive: true });

function requestJson(url) {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
    return res.json();
  });
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
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
  const page = targets.find((target) =>
    target.type === "page" &&
    target.url.startsWith("https://tkxcqt25w6.preview.c40.airoapp.ai/")
  );
  if (!page) throw new Error("Preview page not found in Chrome DevTools targets.");

  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const evalJson = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };

  const pageInfo = await evalJson(`(() => ({
    url: location.href,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    bodyText: document.body.innerText,
    html: document.documentElement.outerHTML,
    links: [...document.querySelectorAll('a')].map(a => ({ text: a.innerText, href: a.href, aria: a.getAttribute('aria-label') })),
    images: [...document.images].map(img => ({
      src: img.currentSrc || img.src,
      alt: img.alt,
      width: img.naturalWidth,
      height: img.naturalHeight,
      rect: (() => { const r = img.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()
    })),
    sections: [...document.querySelectorAll('section, header, footer, main, nav')].map(el => ({
      tag: el.tagName.toLowerCase(),
      id: el.id,
      className: el.className,
      text: el.innerText.slice(0, 2000),
      rect: (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height }; })()
    })),
    colors: (() => {
      const map = new Map();
      for (const el of document.querySelectorAll('*')) {
        const s = getComputedStyle(el);
        for (const value of [s.color, s.backgroundColor, s.borderColor]) {
          if (value && value !== 'rgba(0, 0, 0, 0)') map.set(value, (map.get(value) || 0) + 1);
        }
      }
      return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
    })(),
    fonts: [...new Set([...document.querySelectorAll('*')].map(el => getComputedStyle(el).fontFamily))].slice(0, 30),
    resources: performance.getEntriesByType('resource').map(r => ({ name: r.name, initiatorType: r.initiatorType, transferSize: r.transferSize }))
  }))()`);

  fs.writeFileSync(path.join(outDir, "page.html"), pageInfo.html, "utf8");
  fs.writeFileSync(path.join(outDir, "page.json"), JSON.stringify(pageInfo, null, 2), "utf8");

  const styles = await evalJson(`(() => [...document.styleSheets].map(sheet => {
    try {
      return { href: sheet.href, css: [...sheet.cssRules].map(rule => rule.cssText).join('\\n') };
    } catch (error) {
      return { href: sheet.href, error: String(error) };
    }
  }))()`);
  fs.writeFileSync(path.join(outDir, "stylesheets.json"), JSON.stringify(styles, null, 2), "utf8");

  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true });
  fs.writeFileSync(path.join(outDir, "desktop-full.png"), Buffer.from(screenshot.data, "base64"));

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise(resolve => setTimeout(resolve, 500));
  const mobile = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true });
  fs.writeFileSync(path.join(outDir, "mobile-full.png"), Buffer.from(mobile.data, "base64"));

  cdp.close();
  console.log(JSON.stringify({
    captured: page.url,
    title: page.title,
    files: ["capture/page.html", "capture/page.json", "capture/stylesheets.json", "capture/desktop-full.png", "capture/mobile-full.png"]
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
