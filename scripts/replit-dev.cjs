// Development only: retain Expo + FastAPI + MongoDB with one public web port.
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const children = [];
let publicRelay;
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  publicRelay?.close();
  for (const child of children) child.kill("SIGTERM");
  const timer = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 3000);
  timer.unref();
  Promise.all(children.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", resolve);
  }))).then(() => process.exit(code));
}

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root, stdio: "inherit", ...options,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(`${name} failed to start: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`${name} stopped unexpectedly (${signal || code}).`);
      stop(1);
    }
  });
  return child;
}

async function waitFor(check, name, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (!stopping && Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${name} did not become ready in ${timeout / 1000}s.`);
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });
}

function apiReady() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:8000/api/status", (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
    throw new Error("Set ADMIN_PASSWORD and SESSION_SECRET in Replit Secrets before running.");
  }
  const dbPath = path.join(root, ".local/dev-mongo");
  fs.mkdirSync(dbPath, { recursive: true });
  start("MongoDB", "mongod", [
    "--dbpath", dbPath, "--bind_ip", "127.0.0.1", "--port", "27017",
    "--wiredTigerCacheSizeGB", "0.25", "--quiet",
    "--logpath", path.join(dbPath, "mongod.log"),
  ]);
  await waitFor(() => portOpen(27017), "MongoDB", 30000);

  start("FastAPI", "python", [
    "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "8000",
  ], {
    cwd: path.join(root, "backend"),
    env: {
      ...process.env,
      MONGO_URL: "mongodb://127.0.0.1:27017",
      DB_NAME: "trivia_replit_dev",
      JWT_SECRET_KEY: process.env.SESSION_SECRET,
    },
  });
  await waitFor(apiReady, "FastAPI", 60000);

  start("Expo", path.join(root, "frontend/node_modules/.bin/expo"), [
    "start", "--web", "--port", "5000", "--host", "lan",
  ], {
    cwd: path.join(root, "frontend"),
    env: {
      ...process.env, CI: "0", EXPO_PUBLIC_BACKEND_URL: "",
      REPLIT_LOCAL_DEV: "1",
    },
  });
  await waitFor(() => portOpen(5000), "Expo");
  // The imported environment retains a public port-80 mapping to 8081 even
  // after .replit replacement. Keep that entry working as a development relay.
  // The workflow/preview still targets the actual Expo server on port 5000.
  publicRelay = http.createServer((req, res) => {
    const upstream = http.request({
      hostname: "127.0.0.1", port: 5000,
      path: req.url, method: req.method, headers: req.headers,
    }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end("Development server unavailable.");
    });
    req.pipe(upstream);
  });
  publicRelay.on("upgrade", (req, socket, head) => {
    const upstream = net.connect(5000, "127.0.0.1", () => {
      const headers = Object.entries(req.headers)
        .map(([key, value]) => `${key}: ${value}`).join("\r\n");
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
  });
  publicRelay.on("error", (error) => { console.error(error.message); stop(1); });
  publicRelay.listen(8081, "0.0.0.0");
  console.log("Replit preview ready on port 5000 (Expo web + /api).");
}

process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
main().catch((error) => { console.error(error.message); stop(1); });
