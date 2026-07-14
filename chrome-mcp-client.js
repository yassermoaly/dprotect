const { spawn } = require("child_process");

const args = process.argv.slice(2);
const command = args[0] || "tools/list";
const payload = args[1]
  ? JSON.parse(args[1].startsWith("b64:")
      ? Buffer.from(args[1].slice(4), "base64").toString("utf8")
      : args[1])
  : {};

const mcpPath = `${process.env.LOCALAPPDATA}\\npm-cache\\_npx\\15c61037b1978c83\\node_modules\\chrome-devtools-mcp\\build\\src\\bin\\chrome-devtools-mcp.js`;
const child = spawn(process.execPath, [mcpPath, "--browserUrl", "http://127.0.0.1:9222", "--viewport", "1440x1200"], {
  stdio: ["pipe", "pipe", "pipe"],
  shell: false,
});

let nextId = 1;
let buffer = "";
const pending = new Map();

child.stderr.on("data", (data) => {
  process.stderr.write(data);
});

child.stdout.on("data", (data) => {
  buffer += data.toString("utf8");
  readMessages();
});

child.on("exit", (code) => {
  if (code !== 0) process.exitCode = code || 1;
});

function send(method, params) {
  const id = nextId++;
  const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  child.stdin.write(`${message}\n`);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

function notify(method, params = {}) {
  const message = JSON.stringify({ jsonrpc: "2.0", method, params });
  child.stdin.write(`${message}\n`);
}

function readMessages() {
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline === -1) return;

    const raw = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);

    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  }
}

async function main() {
  await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "codex-local-mcp-client", version: "1.0.0" },
  });
  notify("notifications/initialized");

  let result;
  if (command === "tools/list") {
    result = await send("tools/list", {});
  } else {
    result = await send("tools/call", {
      name: command,
      arguments: payload,
    });
  }

  console.log(JSON.stringify(result, null, 2));
  child.stdin.end();
  child.kill();
}

main().catch((error) => {
  console.error(error);
  child.kill();
  process.exit(1);
});
