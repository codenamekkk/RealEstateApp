require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const Database = require("better-sqlite3");

// ── Database ────────────────────────────────────────────────────
const db = new Database("rooms.db");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    nickname    TEXT NOT NULL,
    criteria    TEXT NOT NULL DEFAULT '[]',
    properties  TEXT NOT NULL DEFAULT '[]',
    updated_at  INTEGER DEFAULT (unixepoch())
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS share_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id     TEXT NOT NULL,
    to_id       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  INTEGER DEFAULT (unixepoch()),
    UNIQUE(from_id, to_id)
  )
`);

// ── Express + Socket.io ─────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 사용자 ID → socket ID 매핑
const userSockets = new Map();

// ── REST API ────────────────────────────────────────────────────

// 사용자 등록/업데이트
app.post("/api/users", (req, res) => {
  const { id, nickname } = req.body;
  if (!id || !nickname) return res.status(400).json({ error: "id, nickname 필수" });

  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (existing) {
    db.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(nickname, id);
  } else {
    db.prepare("INSERT INTO users (id, nickname) VALUES (?, ?)").run(id, nickname);
  }
  res.json({ ok: true });
});

// 사용자 조회
app.get("/api/users/:id", (req, res) => {
  const user = db.prepare("SELECT id, nickname FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "존재하지 않는 아이디입니다" });
  res.json(user);
});

// 닉네임 변경
app.patch("/api/users/:id/nickname", (req, res) => {
  const { nickname } = req.body;
  if (!nickname) return res.status(400).json({ error: "nickname 필수" });
  db.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(nickname, req.params.id);
  res.json({ ok: true });
});

// 사용자 데이터(criteria, properties) 저장
app.put("/api/users/:id/data", (req, res) => {
  const { criteria, properties } = req.body;
  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE users SET criteria = ?, properties = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(criteria), JSON.stringify(properties), now, req.params.id);

  // 나를 구독 중인 사람들에게 실시간 알림
  const subscribers = db.prepare(
    "SELECT from_id FROM share_requests WHERE to_id = ? AND status = 'approved'"
  ).all(req.params.id);

  for (const sub of subscribers) {
    const socketId = userSockets.get(sub.from_id);
    if (socketId) {
      io.to(socketId).emit("shared-data-updated", {
        userId: req.params.id,
        criteria,
        properties,
      });
    }
  }

  res.json({ ok: true });
});

// 공유 신청
app.post("/api/share-requests", (req, res) => {
  const { fromId, toId } = req.body;
  if (!fromId || !toId) return res.status(400).json({ error: "fromId, toId 필수" });
  if (fromId === toId) return res.status(400).json({ error: "자기 자신에게는 신청할 수 없습니다" });

  // 상대방 존재 확인
  const target = db.prepare("SELECT id, nickname FROM users WHERE id = ?").get(toId);
  if (!target) return res.status(404).json({ error: "존재하지 않는 아이디입니다" });

  // 이미 신청했는지 확인
  const existing = db.prepare("SELECT * FROM share_requests WHERE from_id = ? AND to_id = ?").get(fromId, toId);
  if (existing) {
    if (existing.status === "approved") return res.status(400).json({ error: "이미 공유 승인된 상태입니다" });
    if (existing.status === "pending") return res.status(400).json({ error: "이미 공유 신청한 상태입니다" });
    // rejected면 다시 신청 가능
    db.prepare("UPDATE share_requests SET status = 'pending', created_at = unixepoch() WHERE from_id = ? AND to_id = ?")
      .run(fromId, toId);
  } else {
    db.prepare("INSERT INTO share_requests (from_id, to_id) VALUES (?, ?)").run(fromId, toId);
  }

  // 상대방에게 실시간 알림
  const socketId = userSockets.get(toId);
  if (socketId) {
    const fromUser = db.prepare("SELECT id, nickname FROM users WHERE id = ?").get(fromId);
    io.to(socketId).emit("new-share-request", { fromId, fromNickname: fromUser?.nickname || fromId });
  }

  res.json({ ok: true, targetNickname: target.nickname });
});

// 공유 신청 승인/거절
app.patch("/api/share-requests/:id", (req, res) => {
  const { status } = req.body; // approved | rejected
  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status는 approved 또는 rejected" });
  }

  const request = db.prepare("SELECT * FROM share_requests WHERE id = ?").get(req.params.id);
  if (!request) return res.status(404).json({ error: "요청을 찾을 수 없습니다" });

  db.prepare("UPDATE share_requests SET status = ? WHERE id = ?").run(status, req.params.id);

  // 신청자에게 결과 알림
  const socketId = userSockets.get(request.from_id);
  const toUser = db.prepare("SELECT id, nickname FROM users WHERE id = ?").get(request.to_id);
  if (socketId) {
    io.to(socketId).emit("share-request-result", {
      requestId: request.id,
      toId: request.to_id,
      toNickname: toUser?.nickname || request.to_id,
      status,
    });
  }

  res.json({ ok: true });
});

// 나에게 온 공유 신청 목록 (pending)
app.get("/api/share-requests/incoming/:userId", (req, res) => {
  const rows = db.prepare(`
    SELECT sr.id, sr.from_id, sr.status, sr.created_at, u.nickname as from_nickname
    FROM share_requests sr
    LEFT JOIN users u ON sr.from_id = u.id
    WHERE sr.to_id = ? AND sr.status = 'pending'
    ORDER BY sr.created_at DESC
  `).all(req.params.userId);
  res.json(rows);
});

// 내가 공유하고 있는 사람 목록 (내 데이터를 보는 사람들)
app.get("/api/shares/sharing/:userId", (req, res) => {
  const rows = db.prepare(`
    SELECT sr.id, sr.from_id, u.nickname as from_nickname
    FROM share_requests sr
    LEFT JOIN users u ON sr.from_id = u.id
    WHERE sr.to_id = ? AND sr.status = 'approved'
    ORDER BY sr.created_at DESC
  `).all(req.params.userId);
  res.json(rows);
});

// 내가 공유 받는 사람 목록 (내가 보고 있는 데이터의 주인들)
app.get("/api/shares/receiving/:userId", (req, res) => {
  const rows = db.prepare(`
    SELECT sr.id, sr.to_id, u.nickname as to_nickname
    FROM share_requests sr
    LEFT JOIN users u ON sr.to_id = u.id
    WHERE sr.from_id = ? AND sr.status = 'approved'
    ORDER BY sr.created_at DESC
  `).all(req.params.userId);
  res.json(rows);
});

// 특정 사용자의 데이터 조회 (공유 받은 사람만 접근 가능)
app.get("/api/users/:targetId/shared-data", (req, res) => {
  const { requesterId } = req.query;
  if (!requesterId) return res.status(400).json({ error: "requesterId 필수" });

  // 권한 확인
  const approved = db.prepare(
    "SELECT id FROM share_requests WHERE from_id = ? AND to_id = ? AND status = 'approved'"
  ).get(requesterId, req.params.targetId);
  if (!approved) return res.status(403).json({ error: "공유 권한이 없습니다" });

  const user = db.prepare("SELECT criteria, properties, nickname FROM users WHERE id = ?").get(req.params.targetId);
  if (!user) return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });

  res.json({
    nickname: user.nickname,
    criteria: JSON.parse(user.criteria),
    properties: JSON.parse(user.properties),
  });
});

// 공유 취소 (공유함에서 삭제 또는 공유받음에서 삭제)
app.delete("/api/share-requests/:id", (req, res) => {
  db.prepare("DELETE FROM share_requests WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ── WebSocket ───────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[Socket] 연결: ${socket.id}`);

  socket.on("register", (userId) => {
    userSockets.set(userId, socket.id);
    console.log(`[Socket] 사용자 등록: ${userId} → ${socket.id}`);
  });

  socket.on("disconnect", () => {
    // 매핑 제거
    for (const [userId, sid] of userSockets) {
      if (sid === socket.id) { userSockets.delete(userId); break; }
    }
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
