// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const path = require('path');
const { FileStore } = require('metro-cache');

const config = getDefaultConfig(__dirname);

// Use a stable on-disk store (shared across web/android)
const root = process.env.METRO_CACHE_ROOT || path.join(__dirname, '.metro-cache');
config.cacheStores = [
  new FileStore({ root: path.join(root, 'cache') }),
];


// // Exclude unnecessary directories from file watching
// config.watchFolders = [__dirname];
// config.resolver.blacklistRE = /(.*)\/(__tests__|android|ios|build|dist|.git|node_modules\/.*\/android|node_modules\/.*\/ios|node_modules\/.*\/windows|node_modules\/.*\/macos)(\/.*)?$/;

// // Alternative: use a more aggressive exclusion pattern
// config.resolver.blacklistRE = /node_modules\/.*\/(android|ios|windows|macos|__tests__|\.git|.*\.android\.js|.*\.ios\.js)$/;

// Reduce the number of workers to decrease resource usage
config.maxWorkers = 2;

// Only the Replit development runner enables this same-origin API forwarding.
// Native builds and other development environments retain their original setup.
if (process.env.REPLIT_LOCAL_DEV === "1") {
  const http = require("node:http");
  const originalEnhance = config.server.enhanceMiddleware;
  config.server.enhanceMiddleware = (middleware, server) => {
    const next = originalEnhance ? originalEnhance(middleware, server) : middleware;
    return (req, res, ...args) => {
      if (req.url !== "/api" && !req.url.startsWith("/api/")) {
        return next(req, res, ...args);
      }
      const upstream = http.request({
        hostname: "127.0.0.1",
        port: 8000,
        path: req.url,
        method: req.method,
        headers: req.headers,
      }, (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      });
      upstream.on("error", (error) => {
        console.error(`API forwarding failed: ${error.message}`);
        if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Backend unavailable. Check the workflow logs.");
      });
      req.pipe(upstream);
    };
  };
}

module.exports = config;
