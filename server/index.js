require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const Database = require("better-sqlite3");
const fetch = require("node-fetch");
const { XMLParser } = require("fast-xml-parser");
const path = require("path");
const fs = require("fs");

const xmlParser = new XMLParser();

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

// ── 실거래가 관련 테이블 ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS region_codes (
    lawd_cd   TEXT PRIMARY KEY,
    sido_nm   TEXT NOT NULL,
    gu_nm     TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS transaction_cache (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    lawd_cd       TEXT NOT NULL,
    deal_ymd      TEXT NOT NULL,
    apt_nm        TEXT NOT NULL,
    apt_dong      TEXT DEFAULT '',
    exclu_use_ar  REAL NOT NULL,
    deal_amount   INTEGER NOT NULL,
    floor         INTEGER,
    build_year    INTEGER,
    umd_nm        TEXT,
    jibun         TEXT DEFAULT '',
    deal_year     INTEGER,
    deal_month    INTEGER,
    deal_day      INTEGER,
    fetched_at    INTEGER DEFAULT (unixepoch()),
    UNIQUE(lawd_cd, deal_ymd, apt_nm, apt_dong, exclu_use_ar, deal_amount, floor, deal_day)
  )
`);

// jibun 컬럼이 없으면 추가 (기존 DB 마이그레이션)
try { db.exec(`ALTER TABLE transaction_cache ADD COLUMN jibun TEXT DEFAULT ''`); } catch(e) { /* 이미 존재 */ }

db.exec(`CREATE INDEX IF NOT EXISTS idx_txn_lawd_apt ON transaction_cache(lawd_cd, apt_nm)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_txn_lawd_ymd ON transaction_cache(lawd_cd, deal_ymd)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_txn_lawd_jibun ON transaction_cache(lawd_cd, umd_nm, jibun)`);

db.exec(`
  CREATE TABLE IF NOT EXISTS api_fetch_log (
    lawd_cd    TEXT NOT NULL,
    deal_ymd   TEXT NOT NULL,
    fetched_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY(lawd_cd, deal_ymd)
  )
`);

// ── 전월세 캐시 테이블 ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS rent_cache (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    lawd_cd       TEXT NOT NULL,
    deal_ymd      TEXT NOT NULL,
    apt_nm        TEXT NOT NULL,
    exclu_use_ar  REAL NOT NULL,
    deposit       INTEGER NOT NULL,
    monthly_rent  INTEGER NOT NULL DEFAULT 0,
    floor         INTEGER,
    build_year    INTEGER,
    umd_nm        TEXT,
    jibun         TEXT DEFAULT '',
    deal_year     INTEGER,
    deal_month    INTEGER,
    deal_day      INTEGER,
    fetched_at    INTEGER DEFAULT (unixepoch()),
    UNIQUE(lawd_cd, deal_ymd, apt_nm, exclu_use_ar, deposit, monthly_rent, floor, deal_day)
  )
`);

// jibun 컬럼이 없으면 추가 (기존 DB 마이그레이션)
try { db.exec(`ALTER TABLE rent_cache ADD COLUMN jibun TEXT DEFAULT ''`); } catch(e) { /* 이미 존재 */ }

db.exec(`CREATE INDEX IF NOT EXISTS idx_rent_lawd_apt ON rent_cache(lawd_cd, apt_nm)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_rent_lawd_ymd ON rent_cache(lawd_cd, deal_ymd)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_rent_lawd_jibun ON rent_cache(lawd_cd, umd_nm, jibun)`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rent_fetch_log (
    lawd_cd    TEXT NOT NULL,
    deal_ymd   TEXT NOT NULL,
    fetched_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY(lawd_cd, deal_ymd)
  )
`);

// ── KB부동산 캐시 테이블 ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS kb_complex_cache (
    cache_key    TEXT PRIMARY KEY,
    complex_data TEXT,
    type_data    TEXT,
    brif_data    TEXT,
    fetched_at   INTEGER DEFAULT (unixepoch())
  )
`);

// ── 좌표 캐시 테이블 ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS coord_cache (
    gu_dong_key TEXT PRIMARY KEY,
    x           REAL,
    y           REAL,
    fetched_at  INTEGER DEFAULT (unixepoch())
  )
`);

// ── 법정동코드 시딩 ──────────────────────────────────────────────
const regionCount = db.prepare("SELECT COUNT(*) as cnt FROM region_codes").get();
if (regionCount.cnt === 0) {
  const dataPath = path.join(__dirname, "data", "region_codes.json");
  if (fs.existsSync(dataPath)) {
    const regions = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    const insert = db.prepare("INSERT OR IGNORE INTO region_codes (lawd_cd, sido_nm, gu_nm) VALUES (?, ?, ?)");
    const tx = db.transaction(() => {
      for (const r of regions) {
        insert.run(r.lawdCd, r.sidoNm, r.guNm);
      }
    });
    tx();
    console.log(`✅ 법정동코드 ${regions.length}건 로드 완료`);
  } else {
    console.warn("⚠️ server/data/region_codes.json 파일을 찾을 수 없습니다");
  }
}

// ── API 키 ───────────────────────────────────────────────────────
const MOLIT_API_KEY = process.env.MOLIT_API_KEY || "";
const JUSO_API_KEY = process.env.JUSO_API_KEY || "";
const KB_TOKEN = process.env.KB_TOKEN || "";
const KB_BASE_URL = "https://api.kbland.kr";

if (!MOLIT_API_KEY) console.warn("⚠️ MOLIT_API_KEY 환경변수가 설정되지 않았습니다");
if (!KB_TOKEN) console.warn("⚠️ KB_TOKEN 환경변수가 설정되지 않았습니다");
console.log(`[ENV] KB_TOKEN: ${KB_TOKEN ? KB_TOKEN.substring(0, 8) + '...' : 'NOT SET'}`);

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

  let parsedCriteria, parsedProperties;
  try { parsedCriteria = JSON.parse(user.criteria); } catch { parsedCriteria = []; }
  try { parsedProperties = JSON.parse(user.properties); } catch { parsedProperties = []; }

  res.json({
    nickname: user.nickname,
    criteria: parsedCriteria,
    properties: parsedProperties,
  });
});

// 공유 취소 (공유함에서 삭제 또는 공유받음에서 삭제)
app.delete("/api/share-requests/:id", (req, res) => {
  db.prepare("DELETE FROM share_requests WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ── 국토교통부 API 연동 ────────────────────────────────────────────
const RATE_LIMIT_CODES = new Set(["22", "99"]);

async function fetchMolitData(lawdCd, dealYmd, maxRetries = 3) {
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${MOLIT_API_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=9999&pageNo=1`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log("[MOLIT] 요청:", url.replace(MOLIT_API_KEY, "***KEY***"), attempt > 0 ? `(재시도 ${attempt})` : "");
      const res = await fetch(url, { timeout: 15000 });
      if (!res.ok) {
        console.warn(`[MOLIT] HTTP 에러: ${res.status} ${res.statusText}`);
        if (res.status === 429 && attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
          console.log(`[MOLIT] 429 Rate Limit — ${delay}ms 후 재시도...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        return [];
      }
      const xml = await res.text();
      console.log("[MOLIT] 응답 상태:", res.status, "길이:", xml.length, "앞부분:", xml.slice(0, 300));
      const json = xmlParser.parse(xml);

      // resultCode 체크 (rate limit 등 API 에러 감지)
      const resultCode = String(json?.response?.header?.resultCode || "");
      if (resultCode && resultCode !== "00") {
        const resultMsg = json?.response?.header?.resultMsg || "UNKNOWN";
        console.warn(`[MOLIT] API 에러: ${resultCode} - ${resultMsg}`);
        if (RATE_LIMIT_CODES.has(resultCode) && attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          console.log(`[MOLIT] ${delay}ms 후 재시도...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        return [];
      }

      const items = json?.response?.body?.items?.item;
      if (!items) {
        console.log("[MOLIT] items 없음. 파싱 결과:", JSON.stringify(json).slice(0, 500));
        return [];
      }
      return Array.isArray(items) ? items : [items];
    } catch (e) {
      console.warn(`[MOLIT] 요청 실패:`, e.message);
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[MOLIT] ${delay}ms 후 재시도...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return [];
    }
  }
  return [];
}

// 스로틀 배치 호출: batchSize개씩 나눠서 delayMs 간격으로 순차 호출
async function throttledBatchFetch(months, lawdCd, ensureFn, { batchSize = 5, delayMs = 300 } = {}) {
  for (let i = 0; i < months.length; i += batchSize) {
    const batch = months.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(ym => ensureFn(lawdCd, ym)));
    if (i + batchSize < months.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// 동시성 제어: 동일 키에 대한 중복 MOLIT 호출 방지
const _cacheInflight = new Map();

async function ensureCached(lawdCd, dealYmd) {
  const log = db.prepare("SELECT fetched_at FROM api_fetch_log WHERE lawd_cd = ? AND deal_ymd = ?").get(lawdCd, dealYmd);
  const now = Math.floor(Date.now() / 1000);
  const currentYm = new Date().toISOString().slice(0, 7).replace("-", "");
  const isCurrentMonth = dealYmd === currentYm;

  if (log && (!isCurrentMonth || (now - log.fetched_at) < 86400)) {
    return; // 캐시 유효
  }

  // 이미 진행 중인 동일 요청이 있으면 그 결과를 기다림
  const key = `${lawdCd}_${dealYmd}`;
  if (_cacheInflight.has(key)) {
    return _cacheInflight.get(key);
  }

  const promise = (async () => {
    const items = await fetchMolitData(lawdCd, dealYmd);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO transaction_cache
      (lawd_cd, deal_ymd, apt_nm, apt_dong, exclu_use_ar, deal_amount, floor, build_year, umd_nm, jibun, deal_year, deal_month, deal_day)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (const item of items) {
        const amount = parseInt(String(item.dealAmount || "0").replace(/,/g, "").trim());
        const area = parseFloat(item.excluUseAr || 0);
        if (!item.aptNm || !amount || !area) continue;
        insert.run(
          lawdCd, dealYmd,
          String(item.aptNm).trim(),
          String(item.aptDong || "").trim(),
          area, amount,
          parseInt(item.floor) || null,
          parseInt(item.buildYear) || null,
          String(item.umdNm || "").trim(),
          String(item.jibun || "").trim(),
          parseInt(item.dealYear) || null,
          parseInt(item.dealMonth) || null,
          parseInt(item.dealDay) || null
        );
      }
      // 데이터가 있거나 현재 월일 때만 로그 기록 (과거 월 빈 결과는 다음에 재시도)
      if (items.length > 0 || isCurrentMonth) {
        db.prepare("INSERT OR REPLACE INTO api_fetch_log (lawd_cd, deal_ymd, fetched_at) VALUES (?, ?, ?)").run(lawdCd, dealYmd, now);
      }
    });
    tx();
  })();

  _cacheInflight.set(key, promise);
  try {
    await promise;
  } finally {
    _cacheInflight.delete(key);
  }
}

// 전월세 캐싱 (매매 캐싱과 동일한 패턴)
const _rentInflight = new Map();

async function ensureRentCached(lawdCd, dealYmd) {
  const log = db.prepare("SELECT fetched_at FROM rent_fetch_log WHERE lawd_cd = ? AND deal_ymd = ?").get(lawdCd, dealYmd);
  const now = Math.floor(Date.now() / 1000);
  const currentYm = new Date().toISOString().slice(0, 7).replace("-", "");
  const isCurrentMonth = dealYmd === currentYm;

  if (log && (!isCurrentMonth || (now - log.fetched_at) < 86400)) {
    return;
  }

  const key = `rent_${lawdCd}_${dealYmd}`;
  if (_rentInflight.has(key)) {
    return _rentInflight.get(key);
  }

  const promise = (async () => {
    const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent?serviceKey=${MOLIT_API_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=9999`;
    let list = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, { timeout: 15000 });
        if (!r.ok) {
          console.warn(`[RENT] HTTP 에러: ${r.status} ${r.statusText}`);
          if (r.status === 429 && attempt < 2) {
            const delay = Math.pow(2, attempt) * 2000;
            console.log(`[RENT] 429 Rate Limit — ${delay}ms 후 재시도...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          break;
        }
        const text = await r.text();
        const parsed = xmlParser.parse(text);

        const resultCode = String(parsed?.response?.header?.resultCode || "");
        if (resultCode && resultCode !== "00") {
          console.warn(`[RENT] API 에러: ${resultCode} - ${parsed?.response?.header?.resultMsg}`);
          if (RATE_LIMIT_CODES.has(resultCode) && attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            continue;
          }
          break;
        }

        const items = parsed?.response?.body?.items?.item;
        list = !items ? [] : Array.isArray(items) ? items : [items];
        break;
      } catch (e) {
        console.warn(`[RENT] 요청 실패:`, e.message);
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          continue;
        }
        break;
      }
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO rent_cache
      (lawd_cd, deal_ymd, apt_nm, exclu_use_ar, deposit, monthly_rent, floor, build_year, umd_nm, jibun, deal_year, deal_month, deal_day)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (const item of list) {
        const deposit = parseInt(String(item.deposit || "0").replace(/,/g, ""));
        const monthly = parseInt(String(item.monthlyRent || "0").replace(/,/g, ""));
        const area = parseFloat(item.excluUseAr || 0);
        if (!item.aptNm || !area) continue;
        insert.run(
          lawdCd, dealYmd,
          String(item.aptNm).trim(),
          area, deposit, monthly,
          parseInt(item.floor) || null,
          parseInt(item.buildYear) || null,
          String(item.umdNm || "").trim(),
          String(item.jibun || "").trim(),
          parseInt(item.dealYear) || null,
          parseInt(item.dealMonth) || null,
          parseInt(item.dealDay) || null
        );
      }
      // 데이터가 있거나 현재 월일 때만 로그 기록 (과거 월 빈 결과는 다음에 재시도)
      if (list.length > 0 || isCurrentMonth) {
        db.prepare("INSERT OR REPLACE INTO rent_fetch_log (lawd_cd, deal_ymd, fetched_at) VALUES (?, ?, ?)").run(lawdCd, dealYmd, now);
      }
    });
    tx();
  })();

  _rentInflight.set(key, promise);
  try {
    await promise;
  } finally {
    _rentInflight.delete(key);
  }
}

/**
 * 주소(번지) 기반으로 실거래 내역을 조회합니다.
 * jibun이 있으면: lawd_cd + umd_nm + jibun으로 정확 매칭 (이름 무관)
 * jibun이 없으면: 기존 apt_nm 기반 매칭 (fallback)
 */
function queryByJibun(db, tableName, lawdCd, { umdNm, jibun, aptNm, buildYear, area, monthList } = {}, orderBy = "") {
  const buildFilters = () => {
    let where = "";
    const params = [];
    if (buildYear) { where += " AND build_year = ?"; params.push(parseInt(buildYear)); }
    if (area && area !== "전체") {
      const areaValues = String(area).split(",").map(Number).filter(n => !isNaN(n));
      if (areaValues.length > 1) {
        where += ` AND exclu_use_ar IN (${areaValues.map(() => "?").join(",")})`;
        params.push(...areaValues);
      } else {
        where += " AND exclu_use_ar IN (?)";
        params.push(areaValues[0]);
      }
    }
    if (monthList && monthList.length > 0) {
      where += ` AND deal_ymd IN (${monthList.map(() => "?").join(",")})`;
      params.push(...monthList);
    }
    return { where, params };
  };

  const { where: filterWhere, params: filterParams } = buildFilters();

  // 영문 약어 ↔ 한글 변환 맵 (아파트 이름 매칭용)
  const ABBR_MAP = [
    ["SK", "에스케이"], ["LG", "엘지"], ["GS", "지에스"], ["KCC", "케이씨씨"],
    ["e편한세상", "이편한세상"], ["SKVIEW", "에스케이뷰"], ["VIEW", "뷰"],
    ["IPARK", "아이파크"], ["Xi", "자이"], ["XI", "자이"],
  ];

  function normalizeAptName(name) {
    let n = name.replace(/아파트|단지|APT/gi, "").trim();
    // 영문→한글 변환 버전도 생성
    const variants = [n];
    for (const [eng, kor] of ABBR_MAP) {
      if (n.toUpperCase().includes(eng.toUpperCase())) {
        variants.push(n.replace(new RegExp(eng, "gi"), kor));
      }
      if (n.includes(kor)) {
        variants.push(n.replace(new RegExp(kor, "g"), eng));
      }
    }
    return [...new Set(variants)];
  }

  // jibun 기반 매칭 (우선)
  if (umdNm && jibun) {
    const q = `SELECT * FROM ${tableName} WHERE lawd_cd = ? AND umd_nm = ? AND jibun = ?${filterWhere}${orderBy}`;
    const rows = db.prepare(q).all(lawdCd, umdNm, jibun, ...filterParams);
    if (rows.length > 0) return rows;
  }

  // fallback: apt_nm 기반 매칭 (jibun이 없거나 빈 문자열로 저장된 경우)
  if (aptNm) {
    const nameVariants = normalizeAptName(aptNm);
    let umdFilter = umdNm ? " AND umd_nm = ?" : "";
    let umdParams = umdNm ? [umdNm] : [];

    // 1) 정확히 일치하는 이름 (변환 포함)
    for (const variant of nameVariants) {
      const exactQ = `SELECT * FROM ${tableName} WHERE lawd_cd = ? AND apt_nm = ?${umdFilter}${filterWhere}${orderBy}`;
      const exactRows = db.prepare(exactQ).all(lawdCd, variant, ...umdParams, ...filterParams);
      if (exactRows.length > 0) return exactRows;
    }

    // 2) LIKE 전방 일치 (변환 포함)
    for (const variant of nameVariants) {
      const candidateQ = `SELECT DISTINCT apt_nm FROM ${tableName} WHERE lawd_cd = ? AND apt_nm LIKE ?${umdFilter}${filterWhere} ORDER BY LENGTH(apt_nm) ASC LIMIT 1`;
      const candidate = db.prepare(candidateQ).get(lawdCd, `${variant}%`, ...umdParams, ...filterParams);
      if (candidate) {
        const matchQ = `SELECT * FROM ${tableName} WHERE lawd_cd = ? AND apt_nm = ?${umdFilter}${filterWhere}${orderBy}`;
        return db.prepare(matchQ).all(lawdCd, candidate.apt_nm, ...umdParams, ...filterParams);
      }
    }
  }

  return [];
}

function getMonthRange(months) {
  const result = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    result.push(ym);
  }
  return result;
}

// ── 아파트 검색 (한국부동산원 API) ───────────────────────────────────
app.get("/api/search/apartment", async (req, res) => {
  const { query } = req.query;
  if (!query || query.length < 2) return res.json([]);
  if (!KB_TOKEN) return res.status(503).json({ error: "KB_TOKEN 미설정" });

  try {
    // KB 자동완성 검색 (이름으로 전국 검색)
    const params = new URLSearchParams();
    params.set("컬렉션설정명", "COL_AT_JUSO:100;COL_AT_SCHOOL:100;COL_AT_SUBWAY:100;COL_AT_HSCM:100;COL_AT_VILLA:100");
    params.set("검색키워드", query);

    const kbRes = await fetchKB("/land-complex/serch/autoKywrSerch", {
      "컬렉션설정명": "COL_AT_JUSO:100;COL_AT_SCHOOL:100;COL_AT_SUBWAY:100;COL_AT_HSCM:100;COL_AT_VILLA:100",
      "검색키워드": query,
    });
    const hscm = kbRes?.data?.[0]?.COL_AT_HSCM || [];

    const results = [];
    const seen = new Set();
    for (const item of hscm) {
      const name = (item.text || "").trim();
      const addr = (item.addr || "").trim();
      const key = `${name}_${addr}`;
      if (seen.has(key) || !name) continue;
      seen.add(key);
      results.push({
        aptName: name,
        address: addr,
        buildYear: null,
        units: null,
        buildings: null,
      });
      if (results.length >= 20) break;
    }

    res.json(results);
  } catch (e) {
    console.error("KB 검색 실패:", e.message);
    res.status(500).json({ error: "검색 서비스 오류" });
  }
});

// ── 지역코드 조회 ──────────────────────────────────────────────────
app.get("/api/region-code", (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: "address 필수" });

  const parts = address.split(/\s+/);
  let guNm = "", umdNm = "", sidoNm = "";

  for (const part of parts) {
    if (/[시도]$/.test(part) && !sidoNm && (part.length > 2 || /특별|광역/.test(part))) {
      sidoNm = part;
    }
    if (/[구군시]$/.test(part) && part.length >= 2) {
      if (/구$/.test(part)) { guNm = part; }
      else if (/군$/.test(part) && !guNm) { guNm = part; }
      else if (/시$/.test(part) && !guNm && sidoNm) { guNm = part; }
    }
    if (/[동읍면]$/.test(part) && part.length >= 2 && !umdNm) {
      umdNm = part;
    }
  }

  if (!guNm) return res.status(400).json({ error: "주소에서 구/군/시를 찾을 수 없습니다" });

  let row;
  if (sidoNm) {
    row = db.prepare("SELECT * FROM region_codes WHERE gu_nm = ? AND sido_nm LIKE ?").get(guNm, `%${sidoNm.slice(0, 2)}%`);
  }
  if (!row) {
    row = db.prepare("SELECT * FROM region_codes WHERE gu_nm = ?").get(guNm);
  }
  if (!row) return res.status(404).json({ error: "지역코드를 찾을 수 없습니다" });

  res.json({ lawdCd: row.lawd_cd, sidoNm: row.sido_nm, guNm: row.gu_nm, umdNm });
});

// ── 아파트 평수 목록 조회 ───────────────────────────────────────────
app.get("/api/apartment/areas", async (req, res) => {
  const { aptNm, lawdCd, buildYear, umdNm, jibun } = req.query;
  if (!lawdCd) return res.status(400).json({ error: "lawdCd 필수" });
  if (!MOLIT_API_KEY) return res.status(503).json({ error: "국토교통부 API 키 미설정" });

  try {
    const months = getMonthRange(6);
    await Promise.all(months.map(ym => ensureCached(lawdCd, ym)));

    const rows = queryByJibun(db, "transaction_cache", lawdCd, { umdNm, jibun, aptNm, buildYear }, ` ORDER BY exclu_use_ar`);

    // DISTINCT 처리
    const seen = new Set();
    const areas = [];
    for (const r of rows) {
      if (!seen.has(r.exclu_use_ar)) {
        seen.add(r.exclu_use_ar);
        areas.push({ area: r.exclu_use_ar, areaPyeong: Math.floor(r.exclu_use_ar / 3.3058) });
      }
    }
    res.json(areas);
  } catch (e) {
    console.error("평수 조회 실패:", e.message);
    res.status(500).json({ error: "평수 조회 실패" });
  }
});

// ── 실거래 조회 (Phase 1: 즉시 응답 + Phase 2: 백그라운드 전체기간 캐싱) ──
const _backgroundJobs = new Map(); // 전체기간 백그라운드 캐싱 진행 상태

app.get("/api/apartment/transactions", async (req, res) => {
  const { aptNm, lawdCd, area, months: monthsStr, buildYear, umdNm, jibun } = req.query;
  if (!lawdCd) return res.status(400).json({ error: "lawdCd 필수" });
  if (!MOLIT_API_KEY) return res.status(503).json({ error: "국토교통부 API 키 미설정" });

  try {
    // Phase 1: 최근 기간만 즉시 호출 (rate limit 방지: 4개씩 300ms 딜레이)
    const numMonths = parseInt(monthsStr) || 12;
    const monthList = getMonthRange(numMonths);
    await throttledBatchFetch(monthList, lawdCd, ensureCached, { batchSize: 4, delayMs: 300 });

    // 최근 데이터 조회 (queryByJibun 사용)
    const orderBy = ` ORDER BY deal_year DESC, deal_month DESC, deal_day DESC`;
    const rows = queryByJibun(db, "transaction_cache", lawdCd, { umdNm, jibun, aptNm, buildYear, area, monthList }, orderBy);

    // 동별 요약 생성
    const dongMap = {};
    for (const r of rows) {
      const dong = r.apt_dong || "미확인";
      const areaKey = area && area !== "전체" ? area : String(r.exclu_use_ar);
      const key = `${dong}_${areaKey}`;

      if (!dongMap[key]) {
        dongMap[key] = {
          dong,
          area: r.exclu_use_ar,
          areaPyeong: Math.floor(r.exclu_use_ar / 3.3058),
          recentPrice: r.deal_amount,
          recentDate: `${r.deal_year}.${String(r.deal_month).padStart(2, "0")}.${String(r.deal_day).padStart(2, "0")}`,
          recentFloor: r.floor,
          highestPrice: r.deal_amount,
          highestDate: `${r.deal_year}.${String(r.deal_month).padStart(2, "0")}.${String(r.deal_day).padStart(2, "0")}`,
          highestFloor: r.floor,
          lowestPrice: r.deal_amount,
          lowestDate: `${r.deal_year}.${String(r.deal_month).padStart(2, "0")}.${String(r.deal_day).padStart(2, "0")}`,
          lowestFloor: r.floor,
        };
      } else {
        if (r.deal_amount > dongMap[key].highestPrice) {
          dongMap[key].highestPrice = r.deal_amount;
          dongMap[key].highestDate = `${r.deal_year}.${String(r.deal_month).padStart(2, "0")}.${String(r.deal_day).padStart(2, "0")}`;
          dongMap[key].highestFloor = r.floor;
        }
        if (r.deal_amount < dongMap[key].lowestPrice) {
          dongMap[key].lowestPrice = r.deal_amount;
          dongMap[key].lowestDate = `${r.deal_year}.${String(r.deal_month).padStart(2, "0")}.${String(r.deal_day).padStart(2, "0")}`;
          dongMap[key].lowestFloor = r.floor;
        }
      }
    }

    const transactions = rows.map(r => ({
      dealDate: `${r.deal_year}.${String(r.deal_month).padStart(2, "0")}.${String(r.deal_day).padStart(2, "0")}`,
      dealAmount: r.deal_amount,
      floor: r.floor,
      aptDong: r.apt_dong || "미확인",
      excluUseAr: r.exclu_use_ar,
      buildYear: r.build_year,
    }));

    // 즉시 응답 (allTimePriceRange는 null — 백그라운드에서 캐싱 후 별도 조회)
    res.json({
      transactions,
      dongSummary: Object.values(dongMap),
      allTimePriceRange: null,
    });

    // Phase 2: 전체기간 데이터 백그라운드 캐싱 (응답 이후 비동기)
    const apiStartYear = 2006;
    const maxMonths = (new Date().getFullYear() - apiStartYear) * 12 + new Date().getMonth() + 1;
    const allTimeMonthCount = buildYear
      ? Math.min((new Date().getFullYear() - parseInt(buildYear)) * 12 + 12, maxMonths)
      : maxMonths;
    const allTimeMonths = getMonthRange(allTimeMonthCount).filter(m => !monthList.includes(m));

    const jobKey = `${lawdCd}_${umdNm || ""}_${jibun || ""}`;
    if (allTimeMonths.length > 0 && (!_backgroundJobs.has(jobKey) || _backgroundJobs.get(jobKey).status !== "running")) {
      _backgroundJobs.set(jobKey, { status: "running" });
      (async () => {
        try {
          await throttledBatchFetch(allTimeMonths, lawdCd, ensureCached, { batchSize: 5, delayMs: 300 });
          _backgroundJobs.set(jobKey, { status: "done", completedAt: Date.now() });
          console.log(`[BACKGROUND] 전체기간 캐싱 완료: ${jobKey} (${allTimeMonths.length}개월)`);
        } catch (e) {
          _backgroundJobs.set(jobKey, { status: "error", error: e.message });
          console.error(`[BACKGROUND] 전체기간 캐싱 실패: ${jobKey}`, e.message);
        }
      })();
    }
  } catch (e) {
    console.error("실거래 조회 실패:", e.message, e.stack);
    res.status(500).json({ error: "실거래 조회 실패", detail: e.message });
  }
});

// ── 전체기간 최고/최저가 조회 (백그라운드 캐싱 완료 후 폴링) ────────────
app.get("/api/apartment/alltime-price-range", async (req, res) => {
  const { lawdCd, aptNm, area, buildYear, umdNm, jibun } = req.query;
  if (!lawdCd) return res.status(400).json({ error: "lawdCd 필수" });

  try {
    const jobKey = `${lawdCd}_${umdNm || ""}_${jibun || ""}`;
    const job = _backgroundJobs.get(jobKey);

    // 백그라운드 작업이 아직 진행 중이면 loading 반환
    if (job && job.status === "running") {
      return res.json({ status: "loading" });
    }

    // 에러 발생 시
    if (job && job.status === "error") {
      return res.json({ status: "error", message: job.error });
    }

    // 완료 또는 이전 세션에서 이미 캐시된 경우 — DB에서 직접 조회
    const formatRow = (r) => r ? {
      price: r.deal_amount,
      date: `${r.deal_year}.${String(r.deal_month).padStart(2, "0")}.${String(r.deal_day).padStart(2, "0")}`,
      dong: r.apt_dong || "미확인",
      floor: r.floor,
      area: r.exclu_use_ar,
    } : null;

    const allTimeRows = queryByJibun(db, "transaction_cache", lawdCd, { umdNm, jibun, aptNm, buildYear, area }, ` ORDER BY deal_amount DESC`);
    const allTimeHighest = allTimeRows.length > 0 ? allTimeRows[0] : null;
    const allTimeLowest = allTimeRows.length > 0 ? allTimeRows[allTimeRows.length - 1] : null;

    res.json({
      status: "done",
      allTimePriceRange: {
        highest: formatRow(allTimeHighest),
        lowest: formatRow(allTimeLowest),
      },
    });
  } catch (e) {
    console.error("전체기간 가격 조회 실패:", e.message);
    res.status(500).json({ status: "error", message: e.message });
  }
});

// ── 전월세 실거래 조회 (캐시 기반) ──────────────────────────────────────
app.get("/api/apartment/rent", async (req, res) => {
  const { aptNm, lawdCd, area, months = 12, buildYear, umdNm, jibun } = req.query;
  if (!lawdCd) return res.status(400).json({ error: "lawdCd 필수" });
  if (!MOLIT_API_KEY) return res.status(503).json({ error: "국토교통부 API 키 미설정" });

  try {
    const monthList = getMonthRange(parseInt(months));

    // 캐시 확보 (rate limit 방지: 5개씩 300ms 딜레이)
    await throttledBatchFetch(monthList, lawdCd, ensureRentCached, { batchSize: 5, delayMs: 300 });

    // DB에서 조회 (주소 기반 매칭)
    const rows = queryByJibun(db, "rent_cache", lawdCd,
      { umdNm, jibun, aptNm, buildYear, area, monthList },
      ` ORDER BY deal_year DESC, deal_month DESC, deal_day DESC`);

    // 전세/월세 분리
    const jeonse = [];
    const wolse = [];

    for (const r of rows) {
      const entry = {
        dealDate: `${r.deal_year}.${String(r.deal_month).padStart(2, "0")}.${String(r.deal_day).padStart(2, "0")}`,
        deposit: r.deposit,
        monthlyRent: r.monthly_rent,
        floor: r.floor || 0,
        excluUseAr: r.exclu_use_ar,
        areaPyeong: Math.floor(r.exclu_use_ar / 3.3058),
        umdNm: r.umd_nm || "",
        buildYear: r.build_year || 0,
      };

      if (r.monthly_rent > 0) {
        wolse.push(entry);
      } else {
        jeonse.push(entry);
      }
    }

    // 동별 요약 생성
    const makeSummary = (data, type) => {
      const map = {};
      for (const d of data) {
        const dong = d.umdNm || "미확인";
        const areaKey = area && area !== "전체" ? area : String(d.excluUseAr);
        const key = `${dong}_${areaKey}`;
        if (!map[key]) {
          map[key] = { dong, area: d.excluUseAr, areaPyeong: d.areaPyeong, recentDeposit: d.deposit, recentMonthly: d.monthlyRent, recentDate: d.dealDate, recentFloor: d.floor, count: 0 };
        }
        map[key].count++;
      }
      return Object.values(map);
    };

    res.json({
      jeonse: { transactions: jeonse, dongSummary: makeSummary(jeonse, "jeonse") },
      wolse: { transactions: wolse, dongSummary: makeSummary(wolse, "wolse") },
    });
  } catch (e) {
    console.error("전월세 조회 실패:", e.message);
    res.status(500).json({ error: "전월세 조회 실패" });
  }
});

// ── 지역 시세 분석 ──────────────────────────────────────────────────
app.get("/api/apartment/regional-analysis", async (req, res) => {
  const { lawdCd, umdNm, area, price } = req.query;
  if (!lawdCd || !area || !price) return res.status(400).json({ error: "lawdCd, area, price 필수" });
  if (!MOLIT_API_KEY) return res.status(503).json({ error: "국토교통부 API 키 미설정" });

  try {
    const priceNum = parseInt(price);
    const months = getMonthRange(12);
    await Promise.all(months.map(ym => ensureCached(lawdCd, ym)));

    // area가 콤마 구분이면 IN, 단일값이면 BETWEEN ±2
    const areaValues = String(area).split(",").map(Number).filter(n => !isNaN(n));
    let areaWhere, areaBinds;
    if (areaValues.length > 1) {
      areaWhere = `exclu_use_ar IN (${areaValues.map(() => "?").join(",")})`;
      areaBinds = areaValues;
    } else {
      areaWhere = `exclu_use_ar IN (?)`;
      areaBinds = [areaValues[0]];
    }

    // 구 내 동일 평수 모든 거래
    const guRows = db.prepare(`
      SELECT deal_amount, umd_nm FROM transaction_cache
      WHERE lawd_cd = ? AND ${areaWhere}
    `).all(lawdCd, ...areaBinds);

    const guPrices = guRows.map(r => r.deal_amount);
    const guAvg = guPrices.length > 0 ? Math.round(guPrices.reduce((s, p) => s + p, 0) / guPrices.length) : null;
    const percentile = guPrices.length > 0
      ? Math.round((guPrices.filter(p => p > priceNum).length / guPrices.length) * 100)
      : null;

    // 동 내 분석
    let dongAvg = null, dongPercentile = null;
    if (umdNm) {
      const dongPrices = guRows.filter(r => r.umd_nm === umdNm).map(r => r.deal_amount);
      if (dongPrices.length > 0) {
        dongAvg = Math.round(dongPrices.reduce((s, p) => s + p, 0) / dongPrices.length);
        dongPercentile = Math.round((dongPrices.filter(p => p > priceNum).length / dongPrices.length) * 100);
      }
    }

    // 인접 동 비교 (좌표 기반)
    const JUSO_COORD_KEY = process.env.JUSO_COORD_KEY;
    const neighborComparison = [];

    // 같은 구 내 모든 동별 평균
    const allDongs = db.prepare(`
      SELECT umd_nm, AVG(deal_amount) as avg_price, COUNT(*) as cnt
      FROM transaction_cache
      WHERE lawd_cd = ? AND ${areaWhere}
      GROUP BY umd_nm
      HAVING cnt >= 2
    `).all(lawdCd, ...areaBinds);

    if (JUSO_COORD_KEY && umdNm && allDongs.length > 1) {
      const guNmForCoord = req.query.guNm || "";

      // 캐시 우선 좌표 조회: DB에 있으면 바로 사용, 없으면 API 호출 후 캐시
      const getCoordCached = async (dongName) => {
        const cacheKey = `${guNmForCoord}_${dongName}`;
        const cached = db.prepare("SELECT x, y FROM coord_cache WHERE gu_dong_key = ?").get(cacheKey);
        if (cached) return { x: cached.x, y: cached.y };

        try {
          const keyword = encodeURIComponent(`${guNmForCoord} ${dongName}`);
          const addrRes = await fetch(`https://business.juso.go.kr/addrlink/addrLinkApi.do?confmKey=${process.env.JUSO_API_KEY}&keyword=${keyword}&resultType=json&countPerPage=1&currentPage=1`, { timeout: 5000 });
          const addrData = await addrRes.json();
          const j = addrData?.results?.juso?.[0];
          if (!j) return null;
          const coordRes = await fetch(`https://business.juso.go.kr/addrlink/addrCoordApi.do?confmKey=${JUSO_COORD_KEY}&admCd=${j.admCd}&rnMgtSn=${j.rnMgtSn}&udrtYn=${j.udrtYn}&buldMnnm=${j.buldMnnm}&buldSlno=${j.buldSlno}&resultType=json`, { timeout: 5000 });
          const coordData = await coordRes.json();
          const c = coordData?.results?.juso?.[0];
          if (!c) return null;
          const coord = { x: parseFloat(c.entX), y: parseFloat(c.entY) };
          db.prepare("INSERT OR REPLACE INTO coord_cache (gu_dong_key, x, y, fetched_at) VALUES (?, ?, ?, unixepoch())").run(cacheKey, coord.x, coord.y);
          return coord;
        } catch { return null; }
      };

      // 현재 동 + 모든 동 좌표 조회 (병렬, 캐시 활용)
      const dongNames = allDongs.map(d => d.umd_nm);
      const coordResults = await Promise.all(dongNames.map(d => getCoordCached(d)));

      // 현재 동 좌표 찾기
      const currentIdx = dongNames.indexOf(umdNm);
      const currentCoord = currentIdx >= 0 ? coordResults[currentIdx] : null;

      if (currentCoord) {
        // 거리 계산 후 가까운 4개 + 현재 동
        const dongsWithDist = allDongs.map((d, i) => {
          const coord = coordResults[i];
          const dist = coord
            ? Math.sqrt(Math.pow(coord.x - currentCoord.x, 2) + Math.pow(coord.y - currentCoord.y, 2))
            : Infinity;
          return { dongNm: d.umd_nm, avg: Math.round(d.avg_price), dist, isCurrent: d.umd_nm === umdNm };
        }).filter(d => d.dist < Infinity);

        dongsWithDist.sort((a, b) => a.dist - b.dist);
        const nearest = dongsWithDist.slice(0, 5); // 현재 동 포함 5개
        nearest.sort((a, b) => b.avg - a.avg);
        for (const n of nearest) {
          neighborComparison.push({ guNm: n.dongNm, avg: n.avg });
        }
      }
    }

    // 좌표 조회 실패 시 fallback: 같은 구 내 동별 평균 상위 5개
    if (neighborComparison.length === 0) {
      const sorted = allDongs.sort((a, b) => b.avg_price - a.avg_price);
      // 현재 동을 포함하여 5개
      const currentDong = sorted.find(d => d.umd_nm === umdNm);
      const others = sorted.filter(d => d.umd_nm !== umdNm).slice(0, 4);
      if (currentDong) neighborComparison.push({ guNm: currentDong.umd_nm, avg: Math.round(currentDong.avg_price) });
      for (const d of others) {
        neighborComparison.push({ guNm: d.umd_nm, avg: Math.round(d.avg_price) });
      }
      neighborComparison.sort((a, b) => b.avg - a.avg);
    }

    res.json({ guAvg, dongAvg, percentile, dongPercentile, neighborComparison });
  } catch (e) {
    console.error("지역 분석 실패:", e.message);
    res.status(500).json({ error: "지역 분석 실패" });
  }
});

// ── KB부동산 API ──────────────────────────────────────────────────

/**
 * KB부동산 API 공통 호출 래퍼
 */
async function fetchKB(endpoint, params = {}) {
  if (!KB_TOKEN) throw new Error("KB_TOKEN 미설정");
  const queryStr = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `${KB_BASE_URL}${endpoint}${queryStr ? "?" + queryStr : ""}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Authorization": `bearer ${KB_TOKEN}`,
      "WebService": "1",
      "Referer": "https://kbland.kr/",
    },
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`KB API ${res.status}: ${endpoint}`);
  const data = await res.json();
  if (data?.dataHeader?.resultCode !== "10000") {
    const msg = data?.dataBody?.message || data?.dataHeader?.message || "Unknown error";
    throw new Error(`KB API 오류: ${msg}`);
  }
  return data.dataBody;
}

/**
 * KB 법정동코드로 해당 지역 아파트 목록 조회
 */
async function searchKBComplex(lawdCd) {
  const body = await fetchKB("/land-price/price/fastPriceComplexName", { "법정동코드": lawdCd });
  return body?.data || [];
}

/**
 * KB 단지기본일련번호로 타입 정보 조회
 */
async function fetchKBTypInfo(complexSerial) {
  const body = await fetchKB("/land-complex/complex/typInfo", { "단지기본일련번호": complexSerial });
  return body?.data || [];
}

/**
 * KB 단지기본일련번호로 단지 기본정보 조회
 */
async function fetchKBComplexMain(complexSerial) {
  const body = await fetchKB("/land-complex/complex/main", { "단지기본일련번호": complexSerial });
  return body?.data || null;
}

/**
 * KB 단지기본일련번호로 단지 브리프 조회
 */
async function fetchKBComplexBrif(complexSerial) {
  const body = await fetchKB("/land-complex/complex/brif", { "단지기본일련번호": complexSerial });
  return body?.data || null;
}

/**
 * KB 단지 정보 캐시 통합 함수
 * type_data는 영구 캐시, complex_data/brif_data는 30일
 */
async function getKBComplexCached(complexSerial) {
  const cacheKey = String(complexSerial);
  const cached = db.prepare("SELECT complex_data, type_data, brif_data, fetched_at FROM kb_complex_cache WHERE cache_key = ?").get(cacheKey);

  const now = Math.floor(Date.now() / 1000);
  const THIRTY_DAYS = 30 * 24 * 60 * 60;

  // type_data는 영구 캐시 (공급면적 불변)
  if (cached?.type_data) {
    const types = JSON.parse(cached.type_data);
    let main = cached.complex_data ? JSON.parse(cached.complex_data) : null;
    let brif = cached.brif_data ? JSON.parse(cached.brif_data) : null;

    // complex_data/brif_data가 30일 지났으면 갱신
    if (!main || (now - cached.fetched_at > THIRTY_DAYS)) {
      try {
        const [newMain, newBrif] = await Promise.all([
          fetchKBComplexMain(complexSerial),
          fetchKBComplexBrif(complexSerial),
        ]);
        main = newMain;
        brif = newBrif;
        db.prepare("UPDATE kb_complex_cache SET complex_data = ?, brif_data = ?, fetched_at = unixepoch() WHERE cache_key = ?")
          .run(JSON.stringify(main), JSON.stringify(brif), cacheKey);
      } catch (e) {
        console.warn("[KB] 단지정보 갱신 실패 (캐시 사용):", e.message);
      }
    }

    console.log(`[KB] 캐시 히트: ${cacheKey} (${types.length}개 타입)`);
    return { main, types, brif };
  }

  // 캐시 미스: 3개 API 병렬 호출
  console.log(`[KB] 캐시 미스: ${cacheKey} - API 호출`);
  const [main, types, brif] = await Promise.all([
    fetchKBComplexMain(complexSerial),
    fetchKBTypInfo(complexSerial),
    fetchKBComplexBrif(complexSerial),
  ]);

  db.prepare("INSERT OR REPLACE INTO kb_complex_cache (cache_key, complex_data, type_data, brif_data) VALUES (?, ?, ?, ?)")
    .run(cacheKey, JSON.stringify(main), JSON.stringify(types), JSON.stringify(brif));

  console.log(`[KB] 캐시 저장: ${cacheKey} (${types.length}개 타입)`);
  return { main, types, brif };
}

/**
 * KB 법정동코드 + 아파트명으로 단지기본일련번호 매칭
 */
async function findKBComplexSerial(lawdCd, aptName) {
  if (!aptName || !lawdCd) return null;

  const allComplexes = await searchKBComplex(lawdCd);
  if (!allComplexes.length) return null;

  const normalize = (s) => (s || "")
    .replace(/[\s()（）\-·,.·]/g, "")
    .replace(/에스케이/g, "sk").replace(/엘지/g, "lg").replace(/지에스/g, "gs")
    .replace(/케이비/g, "kb").replace(/에이치/g, "h").replace(/디에이치/g, "dh")
    .replace(/아이파크/g, "ipark").replace(/자이/g, "xi")
    .toLowerCase();
  const target = normalize(aptName);

  // 1차: 정확 일치
  let match = allComplexes.find(c => normalize(c["단지명"]) === target);
  // 2차: 포함 매칭 (target을 포함하는 것 우선, 그 중 가장 짧은 것)
  if (!match) {
    // 2a: KB 이름이 target을 포함 (예: "동아청솔1차" includes "동아청솔")
    const containsTarget = allComplexes.filter(c => normalize(c["단지명"]).includes(target));
    if (containsTarget.length > 0) {
      containsTarget.sort((a, b) => normalize(a["단지명"]).length - normalize(b["단지명"]).length);
      match = containsTarget[0];
    }
    // 2b: target이 KB 이름을 포함 (예: "동아청솔" includes "동아") - 가장 긴 매칭 우선
    if (!match) {
      const targetContains = allComplexes.filter(c => target.includes(normalize(c["단지명"])));
      if (targetContains.length > 0) {
        targetContains.sort((a, b) => normalize(b["단지명"]).length - normalize(a["단지명"]).length);
        match = targetContains[0];
      }
    }
  }

  // 3차: 단어 분할 매칭 (target의 주요 단어가 KB 이름에 모두 포함)
  if (!match && target.length >= 3) {
    const tokens = (aptName || "").replace(/[\s()（）\-·,.·0-9]/g, " ").trim().split(/\s+/).filter(t => t.length >= 2);
    if (tokens.length >= 1) {
      const scored = allComplexes.map(c => {
        const n = normalize(c["단지명"]);
        const hits = tokens.filter(t => n.includes(normalize(t))).length;
        return { complex: c, hits, ratio: hits / tokens.length };
      }).filter(s => s.ratio >= 0.5 && s.hits >= 1);
      scored.sort((a, b) => b.ratio - a.ratio || b.hits - a.hits);
      if (scored.length > 0) match = scored[0].complex;
    }
  }

  if (match) {
    console.log(`[KB] 매칭 성공: "${aptName}" → "${match["단지명"]}" (ID: ${match["단지기본일련번호"]})`);
    return { serial: match["단지기본일련번호"], name: match["단지명"], address: match["주소"] };
  }

  console.log(`[KB] 매칭 실패: "${aptName}" (후보: ${allComplexes.slice(0, 5).map(c => c["단지명"]).join(", ")})`);
  return null;
}

// ── KB 기반 단지 정보 조회 엔드포인트 ─────────────────────────────
app.get("/api/apartment/complex-info", async (req, res) => {
  const { lawdCd, address, aptName } = req.query;
  if (!lawdCd) return res.status(400).json({ error: "lawdCd 필수" });
  if (!KB_TOKEN) return res.status(503).json({ error: "KB_TOKEN 미설정" });

  try {
    // KB 단지 매칭: lawdCd(5자리 구코드)를 10자리 법정동코드로 확장하여 검색
    // bjdongCd가 있으면 10자리, 없으면 5자리로 검색
    const bjdongCd = req.query.bjdongCd || "";
    const searchCode = bjdongCd ? (lawdCd + bjdongCd) : lawdCd;

    const kbMatch = await findKBComplexSerial(searchCode, aptName);
    if (!kbMatch) {
      // 5자리로 재시도
      let retryMatch = null;
      if (bjdongCd) {
        retryMatch = await findKBComplexSerial(lawdCd, aptName);
      }
      if (!retryMatch) {
        return res.status(404).json({ error: `KB에서 단지를 찾을 수 없습니다: ${aptName}` });
      }
      Object.assign(kbMatch || {}, retryMatch);
    }

    const serial = (kbMatch || {}).serial;
    if (!serial) {
      return res.status(404).json({ error: `KB에서 단지를 찾을 수 없습니다: ${aptName}` });
    }

    // KB 단지 정보 + 타입 정보 조회 (캐시)
    const { main, types, brif } = await getKBComplexCached(serial);

    // 면적 타입 생성: KB typInfo 기반, 같은 floor+타입은 하나로
    const typeList = [];
    const seenKey = new Set();
    for (const t of (types || [])) {
      const supplyRaw = parseFloat(t["공급면적"]);
      const exclRaw = parseFloat(t["전용면적"]);
      if (!supplyRaw || !exclRaw) continue;

      const supplyFloor = Math.floor(supplyRaw);
      const typeName = (t["주택형타입내용"] || "").trim();
      const key = `${supplyFloor}_${typeName}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);

      typeList.push({
        area: exclRaw,
        areaPyeong: Math.floor(exclRaw / 3.3058),
        supplyArea: supplyFloor,
        supplyPyeong: Math.floor(supplyFloor / 3.3058),
        typeName: typeName || null,
        groupedExclusiveAreas: [exclRaw],
        households: parseInt(t["세대수"]) || 0,
      });
    }

    // KB에서 타입명을 제공하면 그대로 유지 (A, B, C 등)

    const exclusiveAreas = typeList.sort((a, b) => a.supplyArea - b.supplyArea || (a.typeName || "").localeCompare(b.typeName || ""));

    // 응답 구성 (기존 호환)
    const totalHhld = parseInt(main?.["총세대수"]) || 0;
    const totalPkng = parseInt(main?.["총주차대수"]) || 0;

    const result = {
      kbComplexSerial: serial,
      buildingCount: parseInt(main?.["총동수"]) || 0,
      buildingNames: [],
      maxFloor: parseInt(main?.["최고층수"]) || 0,
      maxUgrndFloor: 0,
      totalHouseholds: totalHhld,
      totalParking: totalPkng,
      parkingPerUnit: totalHhld > 0 ? Math.round((totalPkng / totalHhld) * 100) / 100 : 0,
      bcRat: parseFloat(main?.["건폐율내용"]) || 0,
      vlRat: parseFloat(main?.["용적률내용"]) || 0,
      useAprDate: main?.["준공년월일"] ? main["준공년월일"].replace(/(\d{4})(\d{2})(\d{2})/, "$1.$2.$3") : null,
      totArea: parseFloat(main?.["연면적내용"]) || 0,
      exclusiveAreas,
      heatType: [main?.["난방방식구분명"], main?.["난방연료구분명"]].filter(Boolean).join(", ") || null,
      constructor: main?.["시공사명"]?.trim() || null,
      developer: main?.["시행업체명"]?.trim() || null,
      manageTel: main?.["관리사무소전화번호내용"]?.trim() || null,
      manageType: null,
      hallType: main?.["현관구조"]?.trim() || null,
      doroJuso: main?.["도로기본주소"] ? `${main["도로기본주소"]} ${main["도로명건물본번"] || ""}`.trim() : null,
      umdNm: main?.["읍면동명"]?.trim() || null,
      jibun: main?.["상세번지내용"]?.trim() || null,
    };

    console.log(`[COMPLEX] KB 조회 완료: ${aptName} → ${exclusiveAreas.length}개 타입`);
    res.json(result);
  } catch (e) {
    console.error("KB 단지정보 조회 실패:", e.message, e.stack);
    res.status(500).json({ error: "단지정보 조회 실패", detail: e.message });
  }
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
