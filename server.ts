import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Simple In-Memory Queue for Signals
  let pendingSignal: any = null;

  // Log everything!
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] REQ: ${req.method} ${req.url}`);
    next();
  });

  // 1. Web App calls this
  app.post("/api/trade", (req, res) => {
    const { side, symbol, volume, sl, tp } = req.body;
    pendingSignal = { id: Date.now(), side, symbol, volume: volume || 0.01, sl: parseFloat(sl), tp: parseFloat(tp), timestamp: new Date().toISOString() };
    console.log("🚀 TRADE QUEUED:", side);
    res.json({ status: "success", version: "v5" });
  });

  // 2. MetaTrader EA calls this (Explicit Paths)
  app.all("/poll", (req, res) => {
    if (pendingSignal) {
      const signal = { ...pendingSignal };
      pendingSignal = null; 
      console.log("✅ SIGNAL SENT TO MT5:", signal.side);
      return res.json(signal);
    }
    res.json({ status: "idle", version: "v5" });
  });

  app.get("/test", (req, res) => {
    console.log("PING TEST HIT");
    res.send("SERVER OMEGA V5 ALIVE!");
  });

  app.get("/ping", (req, res) => res.send("pong"));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ALPHA OMEGA BRIDGE RUNNING ON http://localhost:${PORT}`);
  });
}

startServer();
