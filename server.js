const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

wss.on("connection", (ws) => {
  ws.id = Math.random().toString(36).slice(2);
  ws.room = null;
  ws.role = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "join") {
      const room = String(msg.room || "").trim().toUpperCase().slice(0, 20);
      const role = msg.role === "broadcaster" ? "broadcaster" : "viewer";
      if (!room) return send(ws, { type: "error", message: "Room ID kosong." });

      if (!rooms.has(room)) rooms.set(room, new Set());
      const clients = rooms.get(room);

      // Keep one broadcaster per room.
      if (role === "broadcaster") {
        for (const c of clients) {
          if (c.role === "broadcaster") {
            return send(ws, { type: "error", message: "Room ini sudah punya broadcaster." });
          }
        }
      }

      ws.room = room;
      ws.role = role;
      clients.add(ws);

      send(ws, {
        type: "joined",
        room,
        role,
        viewers: [...clients].filter(c => c.role === "viewer").length
      });

      if (role === "viewer") {
        const broadcaster = [...clients].find(c => c.role === "broadcaster");
        if (broadcaster) {
          send(broadcaster, { type: "viewer-joined", viewerId: ws.id });
        }
      }

      return;
    }

    // Relay WebRTC signaling messages to the other peer in the same room.
    if (!ws.room) return;
    const clients = rooms.get(ws.room) || new Set();

    for (const c of clients) {
      if (c !== ws && c.readyState === WebSocket.OPEN) {
        send(c, { ...msg, from: ws.id });
      }
    }
  });

  ws.on("close", () => {
    if (!ws.room) return;
    const clients = rooms.get(ws.room);
    if (!clients) return;
    clients.delete(ws);

    for (const c of clients) {
      send(c, {
        type: "peer-left",
        role: ws.role
      });
    }

    if (clients.size === 0) rooms.delete(ws.room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`WebRTC screen share running on port ${PORT}`);
});
