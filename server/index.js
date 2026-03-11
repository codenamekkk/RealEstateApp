require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const Database = require("better-sqlite3");
const crypto = require("crypto");

// ── Database ────────────────────────────────────────────────────
const db = new Database("rooms.db");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    code        TEXT PRIMARY KEY,
    creator_id  TEXT NOT NULL,
    partner_id  TEXT,
    criteria    TEXT NOT NULL,
    properties  TEXT NOT NULL,
    updated_by  TEXT,
    created_at  INTEGER DEFAULT (unixepoch()),
    updated_at  INTEGER DEFAULT (unixepoch())
  )
`);

function generateCode(len = 6) {
  return crypto.randomBytes(4).toString("hex").substring(0, len).toUpperCase();
}

// ── Express + Socket.io ─────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// ── REST API ────────────────────────────────────────────────────

// 방 생성
app.post("/api/rooms", (req, res) => {
  const { creatorId, partnerId, criteria, properties } = req.body;
  if (!creatorId || !criteria || !properties) {
    return res.status(400).json({ error: "creatorId, criteria, properties 필수" });
  }

  const code = generateCode();
  db.prepare(`
    INSERT INTO rooms (code, creator_id, partner_id, criteria, properties, updated_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(code, creatorId, partnerId || null, JSON.stringify(criteria), JSON.stringify(properties), creatorId);

  res.json({ code });
});

// 방 조회
app.get("/api/rooms/:code", (req, res) => {
  const row = db.prepare("SELECT * FROM rooms WHERE code = ?").get(req.params.code);
  if (!row) return res.status(404).json({ error: "방을 찾을 수 없습니다" });

  res.json({
    code: row.code,
    creatorId: row.creator_id,
    partnerId: row.partner_id,
    criteria: JSON.parse(row.criteria),
    properties: JSON.parse(row.properties),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  });
});

// 방 삭제
app.delete("/api/rooms/:code", (req, res) => {
  const result = db.prepare("DELETE FROM rooms WHERE code = ?").run(req.params.code);
  if (result.changes === 0) return res.status(404).json({ error: "방을 찾을 수 없습니다" });

  io.to(req.params.code).emit("room-closed");
  res.json({ ok: true });
});

// ── WebSocket ───────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[Socket] 연결: ${socket.id}`);

  // 방 입장
  socket.on("join-room", (code) => {
    socket.join(code);
    console.log(`[Socket] ${socket.id} → 방 ${code} 입장`);
  });

  // 방 퇴장
  socket.on("leave-room", (code) => {
    socket.leave(code);
    console.log(`[Socket] ${socket.id} → 방 ${code} 퇴장`);
  });

  // 데이터 동기화
  socket.on("sync-data", ({ code, criteria, properties, updatedBy }) => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      UPDATE rooms SET criteria = ?, properties = ?, updated_by = ?, updated_at = ?
      WHERE code = ?
    `).run(JSON.stringify(criteria), JSON.stringify(properties), updatedBy, now, code);

    // 보낸 사람 제외, 같은 방의 다른 사람에게 전달
    socket.to(code).emit("room-updated", { criteria, properties, updatedBy });
  });

  socket.on("disconnect", () => {
    console.log(`[Socket] 연결 해제: ${socket.id}`);
  });
});

// ── Health check ────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── Start ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🏠 부동산 평가 서버 실행 중: http://localhost:${PORT}`);
});
