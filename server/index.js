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
    deal_year     INTEGER,
    deal_month    INTEGER,
    deal_day      INTEGER,
    fetched_at    INTEGER DEFAULT (unixepoch()),
    UNIQUE(lawd_cd, deal_ymd, apt_nm, apt_dong, exclu_use_ar, deal_amount, floor, deal_day)
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_txn_lawd_apt ON transaction_cache(lawd_cd, apt_nm)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_txn_lawd_ymd ON transaction_cache(lawd_cd, deal_ymd)`);

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
    deal_year     INTEGER,
    deal_month    INTEGER,
    deal_day      INTEGER,
    fetched_at    INTEGER DEFAULT (unixepoch()),
    UNIQUE(lawd_cd, deal_ymd, apt_nm, exclu_use_ar, deposit, monthly_rent, floor, deal_day)
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_rent_lawd_apt ON rent_cache(lawd_cd, apt_nm)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_rent_lawd_ymd ON rent_cache(lawd_cd, deal_ymd)`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rent_fetch_log (
    lawd_cd    TEXT NOT NULL,
    deal_ymd   TEXT NOT NULL,
    fetched_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY(lawd_cd, deal_ymd)
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

// ── 법정동코드 (동 레벨) 테이블 ────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS dong_codes (
    sigungu_cd  TEXT NOT NULL,
    bjdong_cd   TEXT NOT NULL,
    dong_nm     TEXT NOT NULL,
    PRIMARY KEY(sigungu_cd, bjdong_cd)
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_dong_codes_nm ON dong_codes(sigungu_cd, dong_nm)`);

// ── API 키 ───────────────────────────────────────────────────────
const KREB_API_KEY = process.env.KREB_API_KEY || "";
const MOLIT_API_KEY = process.env.MOLIT_API_KEY || "";
const BUILDING_API_KEY = process.env.BUILDING_API_KEY || "";
const MOLIT_HOUSING_API_KEY = process.env.MOLIT_HOUSING_API_KEY || "";
const JUSO_API_KEY = process.env.JUSO_API_KEY || "";

if (!KREB_API_KEY) console.warn("⚠️ KREB_API_KEY 환경변수가 설정되지 않았습니다");
if (!MOLIT_API_KEY) console.warn("⚠️ MOLIT_API_KEY 환경변수가 설정되지 않았습니다");
if (!BUILDING_API_KEY) console.warn("⚠️ BUILDING_API_KEY 환경변수가 설정되지 않았습니다");

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
async function fetchMolitData(lawdCd, dealYmd) {
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${MOLIT_API_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=9999&pageNo=1`;
  console.log("[MOLIT] 요청:", url.replace(MOLIT_API_KEY, "***KEY***"));
  const res = await fetch(url, { timeout: 15000 });
  const xml = await res.text();
  console.log("[MOLIT] 응답 상태:", res.status, "길이:", xml.length, "앞부분:", xml.slice(0, 300));
  const json = xmlParser.parse(xml);
  const items = json?.response?.body?.items?.item;
  if (!items) {
    console.log("[MOLIT] items 없음. 파싱 결과:", JSON.stringify(json).slice(0, 500));
    return [];
  }
  return Array.isArray(items) ? items : [items];
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
      (lawd_cd, deal_ymd, apt_nm, apt_dong, exclu_use_ar, deal_amount, floor, build_year, umd_nm, deal_year, deal_month, deal_day)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          parseInt(item.dealYear) || null,
          parseInt(item.dealMonth) || null,
          parseInt(item.dealDay) || null
        );
      }
      db.prepare("INSERT OR REPLACE INTO api_fetch_log (lawd_cd, deal_ymd, fetched_at) VALUES (?, ?, ?)").run(lawdCd, dealYmd, now);
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
    const r = await fetch(url, { timeout: 15000 });
    const text = await r.text();
    const parsed = xmlParser.parse(text);
    const items = parsed?.response?.body?.items?.item;
    const list = !items ? [] : Array.isArray(items) ? items : [items];

    const insert = db.prepare(`
      INSERT OR IGNORE INTO rent_cache
      (lawd_cd, deal_ymd, apt_nm, exclu_use_ar, deposit, monthly_rent, floor, build_year, umd_nm, deal_year, deal_month, deal_day)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          parseInt(item.dealYear) || null,
          parseInt(item.dealMonth) || null,
          parseInt(item.dealDay) || null
        );
      }
      db.prepare("INSERT OR REPLACE INTO rent_fetch_log (lawd_cd, deal_ymd, fetched_at) VALUES (?, ?, ?)").run(lawdCd, dealYmd, now);
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
  if (!KREB_API_KEY) return res.status(503).json({ error: "KREB API 키 미설정" });

  try {
    // 도로명주소 패턴 감지 (로, 길, 대로 + 숫자)
    const isRoadName = /(?:로|길|대로)\s*\d/.test(query);

    // 1. 도로명주소 검색 (juso.go.kr)
    let jusoResults = [];
    if (isRoadName && JUSO_API_KEY) {
      try {
        const jusoUrl = `https://business.juso.go.kr/addrlink/addrLinkApi.do?confmKey=${JUSO_API_KEY}&keyword=${encodeURIComponent(query)}&resultType=json&countPerPage=10&currentPage=1`;
        const jusoRes = await fetch(jusoUrl, { timeout: 10000 });
        const jusoData = await jusoRes.json();
        const jusos = jusoData?.results?.juso || [];
        // 아파트만 필터 (bdNm에 값이 있는 항목) → 병렬 KREB 조회
        const aptJusos = jusos.filter(j => j.bdNm);
        const krebPromises = aptJusos.map(j => {
          const jibunDong = j.emdNm || "";
          const condType = encodeURIComponent("cond[단지종류::EQ]") + "=1";
          const condAddr = encodeURIComponent("cond[주소::LIKE]") + "=" + encodeURIComponent(jibunDong);
          const condName = encodeURIComponent("cond[단지명_공시가격::LIKE]") + "=" + encodeURIComponent(j.bdNm.replace(/아파트|단지/g, "").trim());
          const krebUrl = `https://api.odcloud.kr/api/15106861/v1/uddi:46a20910-19aa-462e-ba09-e897b77d0e76?serviceKey=${KREB_API_KEY}&page=1&perPage=5&${condType}&${condAddr}&${condName}`;
          return fetch(krebUrl, { timeout: 10000 }).then(r => r.json()).catch(() => ({ data: [] }));
        });
        const krebResults = await Promise.all(krebPromises);
        for (const krebRes of krebResults) {
          for (const item of (krebRes.data || [])) {
            const pnu = String(item["필지고유번호"] || "");
            jusoResults.push({
              aptName: (item["단지명_공시가격"] || "").trim(),
              address: (item["주소"] || "").trim(),
              buildYear: item["사용승인일"] ? item["사용승인일"].slice(0, 4) : null,
              units: parseInt(item["세대수"]) || null,
              buildings: parseInt(item["동수"]) || null,
              complexId: item["단지고유번호"] || null,
              bjdongCd: pnu.length >= 10 ? pnu.substring(5, 10) : null,
            });
          }
        }
      } catch (e) {
        console.warn("[JUSO] 도로명주소 검색 실패:", e.message);
      }
    }

    // 2. KREB 이름/지번주소 검색 (기존)
    const condType = encodeURIComponent("cond[단지종류::EQ]") + "=1";
    const baseUrl = `https://api.odcloud.kr/api/15106861/v1/uddi:46a20910-19aa-462e-ba09-e897b77d0e76?serviceKey=${KREB_API_KEY}&page=1&perPage=15&${condType}`;

    const condName = encodeURIComponent("cond[단지명_공시가격::LIKE]") + "=" + encodeURIComponent(query);
    const condAddr = encodeURIComponent("cond[주소::LIKE]") + "=" + encodeURIComponent(query);

    const [nameRes, addrRes] = await Promise.all([
      fetch(`${baseUrl}&${condName}`, { timeout: 10000 }).then(r => r.json()).catch(() => ({ data: [] })),
      fetch(`${baseUrl}&${condAddr}`, { timeout: 10000 }).then(r => r.json()).catch(() => ({ data: [] })),
    ]);

    // 3. 결과 합침 (도로명 결과 우선)
    const seen = new Set();
    const allItems = [...jusoResults];
    for (const item of [...(nameRes.data || []), ...(addrRes.data || [])]) {
      const pnu = String(item["필지고유번호"] || "");
      allItems.push({
        aptName: (item["단지명_공시가격"] || "").trim(),
        address: (item["주소"] || "").trim(),
        buildYear: item["사용승인일"] ? item["사용승인일"].slice(0, 4) : null,
        units: parseInt(item["세대수"]) || null,
        buildings: parseInt(item["동수"]) || null,
        complexId: item["단지고유번호"] || null,
        bjdongCd: pnu.length >= 10 ? pnu.substring(5, 10) : null,
      });
    }

    const results = [];
    for (const item of allItems) {
      const id = item.complexId;
      if (seen.has(id)) continue;
      seen.add(id);
      results.push(item);
      if (results.length >= 20) break;
    }
    res.json(results);
  } catch (e) {
    console.error("KREB 검색 실패:", e.message);
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
  const { aptNm, lawdCd, buildYear } = req.query;
  if (!aptNm || !lawdCd) return res.status(400).json({ error: "aptNm, lawdCd 필수" });
  if (!MOLIT_API_KEY) return res.status(503).json({ error: "국토교통부 API 키 미설정" });

  try {
    const months = getMonthRange(6);
    await Promise.all(months.map(ym => ensureCached(lawdCd, ym)));

    const cleanName = aptNm.replace(/아파트|단지|APT/gi, "").trim();
    let areaQuery = `
      SELECT DISTINCT exclu_use_ar FROM transaction_cache
      WHERE lawd_cd = ? AND (apt_nm = ? OR apt_nm LIKE ? OR ? LIKE '%' || apt_nm || '%')
    `;
    const areaParams = [lawdCd, cleanName, `${cleanName}%`, cleanName];
    if (buildYear) {
      areaQuery += ` AND build_year = ?`;
      areaParams.push(parseInt(buildYear));
    }
    areaQuery += ` ORDER BY exclu_use_ar`;
    const rows = db.prepare(areaQuery).all(...areaParams);

    const areas = rows.map(r => ({
      area: r.exclu_use_ar,
      areaPyeong: Math.round(r.exclu_use_ar / 3.3058),
    }));
    res.json(areas);
  } catch (e) {
    console.error("평수 조회 실패:", e.message);
    res.status(500).json({ error: "평수 조회 실패" });
  }
});

// ── 실거래 조회 ─────────────────────────────────────────────────────
app.get("/api/apartment/transactions", async (req, res) => {
  const { aptNm, lawdCd, area, months: monthsStr, buildYear } = req.query;
  if (!aptNm || !lawdCd) return res.status(400).json({ error: "aptNm, lawdCd 필수" });
  if (!MOLIT_API_KEY) return res.status(503).json({ error: "국토교통부 API 키 미설정" });

  try {
    const numMonths = parseInt(monthsStr) || 12;
    const monthList = getMonthRange(numMonths);
    await Promise.all(monthList.map(ym => ensureCached(lawdCd, ym)));

    // 전체기간 데이터를 위해 추가 캐시 확보 (백그라운드, 응답 차단 안함)
    const allTimeMonthCount = buildYear
      ? Math.min((new Date().getFullYear() - parseInt(buildYear)) * 12 + 12, 120)
      : 60;
    const allTimeMonths = getMonthRange(allTimeMonthCount).filter(m => !monthList.includes(m));
    if (allTimeMonths.length > 0) {
      Promise.allSettled(allTimeMonths.map(ym => ensureCached(lawdCd, ym))).catch(() => {});
    }

    const cleanName = aptNm.replace(/아파트|단지|APT/gi, "").trim();
    let query = `SELECT * FROM transaction_cache WHERE lawd_cd = ? AND (apt_nm = ? OR apt_nm LIKE ? OR ? LIKE '%' || apt_nm || '%')`;
    const params = [lawdCd, cleanName, `${cleanName}%`, cleanName];

    if (buildYear) {
      query += ` AND build_year = ?`;
      params.push(parseInt(buildYear));
    }

    // 최근 데이터 조회 (month 필터 적용)
    let recentQuery = query + ` AND deal_ymd IN (${monthList.map(() => "?").join(",")})`;
    const recentParams = [...params, ...monthList];

    if (area && area !== "전체") {
      const areaNum = parseFloat(area);
      query += ` AND exclu_use_ar BETWEEN ? AND ?`;
      params.push(areaNum - 2, areaNum + 2);
      recentQuery += ` AND exclu_use_ar BETWEEN ? AND ?`;
      recentParams.push(areaNum - 2, areaNum + 2);
    }
    recentQuery += ` ORDER BY deal_year DESC, deal_month DESC, deal_day DESC`;
    query += ` ORDER BY deal_year DESC, deal_month DESC, deal_day DESC`;

    const rows = db.prepare(recentQuery).all(...recentParams);

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
          areaPyeong: Math.round(r.exclu_use_ar / 3.3058),
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

    const transactions = rows.slice(0, 100).map(r => ({
      dealDate: `${r.deal_year}.${String(r.deal_month).padStart(2, "0")}.${String(r.deal_day).padStart(2, "0")}`,
      dealAmount: r.deal_amount,
      floor: r.floor,
      aptDong: r.apt_dong || "미확인",
      excluUseAr: r.exclu_use_ar,
      buildYear: r.build_year,
    }));

    // 전체기간 최고/최저가 조회 (캐시된 전체 데이터에서)
    let allTimeQuery = `SELECT * FROM transaction_cache WHERE lawd_cd = ? AND (apt_nm = ? OR apt_nm LIKE ? OR ? LIKE '%' || apt_nm || '%')`;
    const allTimeParams = [lawdCd, cleanName, `${cleanName}%`, cleanName];
    if (buildYear) {
      allTimeQuery += ` AND build_year = ?`;
      allTimeParams.push(parseInt(buildYear));
    }
    if (area && area !== "전체") {
      const areaNum2 = parseFloat(area);
      allTimeQuery += ` AND exclu_use_ar BETWEEN ? AND ?`;
      allTimeParams.push(areaNum2 - 2, areaNum2 + 2);
    }
    const formatRow = (r) => r ? {
      price: r.deal_amount,
      date: `${r.deal_year}.${String(r.deal_month).padStart(2, "0")}.${String(r.deal_day).padStart(2, "0")}`,
      dong: r.apt_dong || "미확인",
      floor: r.floor,
      area: r.exclu_use_ar,
    } : null;
    const allTimeHighest = db.prepare(allTimeQuery + ` ORDER BY deal_amount DESC LIMIT 1`).get(...allTimeParams);
    const allTimeLowest = db.prepare(allTimeQuery + ` ORDER BY deal_amount ASC LIMIT 1`).get(...allTimeParams);

    res.json({
      transactions,
      dongSummary: Object.values(dongMap),
      allTimePriceRange: {
        highest: formatRow(allTimeHighest),
        lowest: formatRow(allTimeLowest),
      },
    });
  } catch (e) {
    console.error("실거래 조회 실패:", e.message, e.stack);
    res.status(500).json({ error: "실거래 조회 실패", detail: e.message });
  }
});

// ── 전월세 실거래 조회 (캐시 기반) ──────────────────────────────────────
app.get("/api/apartment/rent", async (req, res) => {
  const { aptNm, lawdCd, area, months = 12, buildYear } = req.query;
  if (!aptNm || !lawdCd) return res.status(400).json({ error: "aptNm, lawdCd 필수" });
  if (!MOLIT_API_KEY) return res.status(503).json({ error: "국토교통부 API 키 미설정" });

  try {
    const monthList = getMonthRange(parseInt(months));

    // 캐시 확보 (동시성 제어 포함)
    await Promise.all(monthList.map(ym => ensureRentCached(lawdCd, ym)));

    // DB에서 조회
    const cleanName = aptNm.replace(/아파트|단지|APT/gi, "").trim();
    let query = `SELECT * FROM rent_cache WHERE lawd_cd = ? AND (apt_nm = ? OR apt_nm LIKE ? OR ? LIKE '%' || apt_nm || '%')`;
    const params = [lawdCd, cleanName, `${cleanName}%`, cleanName];

    if (buildYear) {
      query += ` AND build_year = ?`;
      params.push(parseInt(buildYear));
    }
    if (area && area !== "전체") {
      const areaNum = parseFloat(area);
      query += ` AND exclu_use_ar BETWEEN ? AND ?`;
      params.push(areaNum - 2, areaNum + 2);
    }
    query += ` ORDER BY deal_year DESC, deal_month DESC, deal_day DESC`;

    const rows = db.prepare(query).all(...params);

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
        areaPyeong: Math.round(r.exclu_use_ar / 3.3058),
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
    const areaNum = parseFloat(area);
    const priceNum = parseInt(price);
    const months = getMonthRange(12);
    await Promise.all(months.map(ym => ensureCached(lawdCd, ym)));

    // 구 내 동일 평수 모든 거래
    const guRows = db.prepare(`
      SELECT deal_amount, umd_nm FROM transaction_cache
      WHERE lawd_cd = ? AND exclu_use_ar BETWEEN ? AND ?
    `).all(lawdCd, areaNum - 5, areaNum + 5);

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
      WHERE lawd_cd = ? ${areaNum ? "AND exclu_use_ar BETWEEN ? AND ?" : ""}
      GROUP BY umd_nm
      HAVING cnt >= 2
    `).all(...(areaNum ? [lawdCd, areaNum - 5, areaNum + 5] : [lawdCd]));

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

// ── 건축물대장 API (Building Registry) ──────────────────────────────

const BUILDING_API_BASE = "https://apis.data.go.kr/1613000/BldRgstHubService";
const HOUSING_API_BASE = "https://apis.data.go.kr/1613000";

/**
 * 건축물대장 API 응답 파싱 (에러 감지 + 재시도 포함)
 * data.go.kr API는 rate limit 시 body 없이 에러 헤더만 반환
 */
async function fetchBuildingApi(url, label, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      console.log(`[BUILDING] ${label} 재시도 ${attempt}/${retries} (300ms 대기)`);
      await new Promise(r => setTimeout(r, 300));
    }
    const res = await fetch(url, { timeout: 15000 });
    const data = await res.json();
    const resultCode = data?.response?.header?.resultCode;
    const resultMsg = data?.response?.header?.resultMsg || "";
    if (resultCode && resultCode !== "00") {
      console.warn(`[BUILDING] ${label} API 에러: code=${resultCode}, msg=${resultMsg}`);
      if (attempt < retries) continue; // 재시도
      return { items: null, error: resultMsg };
    }
    const items = data?.response?.body?.items?.item;
    return { items: items || null, error: null };
  }
  return { items: null, error: "max retries exceeded" };
}

/**
 * 단지목록 API: 법정동코드 10자리로 kaptCode 조회
 */
async function findKaptCode(bjdCode10, aptName) {
  if (!MOLIT_HOUSING_API_KEY) return null;
  try {
    const url = `${HOUSING_API_BASE}/AptListService3/getLegaldongAptList3?serviceKey=${MOLIT_HOUSING_API_KEY}&bjdCode=${bjdCode10}&pageNo=1&numOfRows=50`;
    const res = await fetch(url, { timeout: 10000 });
    const data = await res.json();
    const items = data?.response?.body?.items;
    if (!items || !Array.isArray(items)) return null;

    // 이름 매칭
    const cleanName = aptName.replace(/아파트|단지|APT/gi, "").trim();
    const match = items.find(it =>
      it.kaptName && (
        it.kaptName.includes(cleanName) ||
        cleanName.includes(it.kaptName.replace(/^[가-힣]+(?:시|구|동)/, ""))
      )
    );
    return match ? match.kaptCode : null;
  } catch (e) {
    console.error("[HOUSING] 단지목록 조회 실패:", e.message);
    return null;
  }
}

/**
 * 공동주택 기본정보 API: kaptCode로 상세정보 조회
 */
async function fetchHousingBasicInfo(kaptCode) {
  if (!MOLIT_HOUSING_API_KEY || !kaptCode) return null;
  try {
    const url = `${HOUSING_API_BASE}/AptBasisInfoServiceV4/getAphusBassInfoV4?ServiceKey=${MOLIT_HOUSING_API_KEY}&kaptCode=${kaptCode}`;
    const res = await fetch(url, { timeout: 10000 });
    const data = await res.json();
    return data?.response?.body?.item || null;
  } catch (e) {
    console.error("[HOUSING] 기본정보 조회 실패:", e.message);
    return null;
  }
}

/**
 * 주소 파싱: KREB 주소에서 동이름, 번지를 추출
 * 예: "서울특별시 동대문구 청량리동 60" → { dongNm: "청량리동", bun: "0060", ji: "0000" }
 * 예: "서울특별시 동대문구 청량리동 60-5" → { dongNm: "청량리동", bun: "0060", ji: "0005" }
 */
function parseKrebAddress(address) {
  const parts = address.trim().split(/\s+/);
  let dongNm = "";
  let bunJi = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (/[동읍면리가로]$/.test(part) && part.length >= 2) {
      dongNm = part;
      // 번지는 동이름 다음에 오는 숫자(들)
      if (i + 1 < parts.length) {
        bunJi = parts.slice(i + 1).join(" ");
      }
      break;
    }
  }

  let bun = "0000";
  let ji = "0000";

  if (bunJi) {
    const match = bunJi.match(/^(\d+)(?:-(\d+))?/);
    if (match) {
      bun = String(match[1]).padStart(4, "0");
      ji = match[2] ? String(match[2]).padStart(4, "0") : "0000";
    }
  }

  return { dongNm, bun, ji };
}

/**
 * 법정동코드 조회: 동이름으로 bjdongCd 조회
 * 1. 먼저 dong_codes 테이블에서 캐시 확인
 * 2. 없으면 단지목록 API로 시군구 내 단지를 조회하여 bjdCode 추출 후 캐시
 */
async function resolveBjdongCd(sigunguCd, dongNm) {
  // 1. 캐시 확인
  const cached = db.prepare(
    "SELECT bjdong_cd FROM dong_codes WHERE sigungu_cd = ? AND dong_nm = ?"
  ).get(sigunguCd, dongNm);
  if (cached) return cached.bjdong_cd;

  // 2. 단지목록 API로 시군구 내 모든 단지 조회하여 bjdCode 수집
  try {
    console.log("[DONG] 단지목록 API로 법정동코드 조회:", sigunguCd, dongNm);
    const url = `https://apis.data.go.kr/1613000/AptListService3/getSigunguAptList3?serviceKey=${MOLIT_HOUSING_API_KEY}&sigunguCode=${sigunguCd}&pageNo=1&numOfRows=1000`;
    const res = await fetch(url, { timeout: 15000 });
    const data = await res.json();
    const items = data?.response?.body?.items || [];

    if (items.length === 0) {
      console.log("[DONG] 단지목록 결과 없음");
      return null;
    }

    // bjdCode에서 동코드 추출하여 캐시
    const insertDong = db.prepare(
      "INSERT OR IGNORE INTO dong_codes (sigungu_cd, bjdong_cd, dong_nm) VALUES (?, ?, ?)"
    );
    const seenCodes = new Set();
    const tx = db.transaction(() => {
      for (const item of items) {
        const bjdCode = item.bjdCode;
        if (!bjdCode || bjdCode.length < 10 || seenCodes.has(bjdCode)) continue;
        seenCodes.add(bjdCode);
        const itemSigungu = bjdCode.substring(0, 5);
        const itemBjdong = bjdCode.substring(5, 10);
        const itemDongNm = item.as3 || "";
        if (itemDongNm && itemSigungu === sigunguCd) {
          insertDong.run(itemSigungu, itemBjdong, itemDongNm);
        }
      }
    });
    tx();

    // 다시 캐시에서 확인
    const result = db.prepare(
      "SELECT bjdong_cd FROM dong_codes WHERE sigungu_cd = ? AND dong_nm = ?"
    ).get(sigunguCd, dongNm);
    if (result) return result.bjdong_cd;

    // 부분 매칭 시도 (동이름에서 '동' 제거 후 LIKE 검색)
    const baseName = dongNm.replace(/[동읍면리가로]$/, "");
    const likeResult = db.prepare(
      "SELECT bjdong_cd FROM dong_codes WHERE sigungu_cd = ? AND dong_nm LIKE ?"
    ).get(sigunguCd, `${baseName}%`);
    if (likeResult) return likeResult.bjdong_cd;

    return null;
  } catch (e) {
    console.error("[DONG] 법정동코드 조회 실패:", e.message);
    return null;
  }
}

/**
 * 건축물대장 표제부 조회
 */
async function fetchBuildingTitle(sigunguCd, bjdongCd, bun, ji) {
  const url = `${BUILDING_API_BASE}/getBrTitleInfo?serviceKey=${BUILDING_API_KEY}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&bun=${bun}&ji=${ji}&numOfRows=100&pageNo=1&_type=json`;
  console.log("[BUILDING] 표제부 요청:", url.replace(BUILDING_API_KEY, "***KEY***"));
  const { items, error } = await fetchBuildingApi(url, "표제부", 1);
  if (error) console.warn("[BUILDING] 표제부 조회 실패:", error);
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

/**
 * 건축물대장 총괄표제부 조회 (용적률, 건폐율, 주차대수 등 단지 전체 정보)
 */
async function fetchBuildingRecapTitle(sigunguCd, bjdongCd, bun, ji) {
  const url = `${BUILDING_API_BASE}/getBrRecapTitleInfo?serviceKey=${BUILDING_API_KEY}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&bun=${bun}&ji=${ji}&numOfRows=10&pageNo=1&_type=json`;
  console.log("[BUILDING] 총괄표제부 요청:", url.replace(BUILDING_API_KEY, "***KEY***"));
  const { items, error } = await fetchBuildingApi(url, "총괄표제부", 2);
  if (error) console.warn("[BUILDING] 총괄표제부 조회 실패:", error);
  if (!items) {
    console.warn("[BUILDING] 총괄표제부 데이터 없음 (items=null)");
    return null;
  }
  const arr = Array.isArray(items) ? items : [items];
  const result = arr[0] || null;
  if (result) {
    console.log(`[BUILDING] 총괄표제부 확인: vlRat=${result.vlRat}, bcRat=${result.bcRat}, totPkngCnt=${result.totPkngCnt}, hhldCnt=${result.hhldCnt}`);
  }
  return result;
}

/**
 * 건축물대장 전유공용면적 조회
 */
async function fetchBuildingArea(sigunguCd, bjdongCd, bun, ji) {
  const url = `${BUILDING_API_BASE}/getBrExposPubuseAreaInfo?serviceKey=${BUILDING_API_KEY}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&bun=${bun}&ji=${ji}&numOfRows=500&pageNo=1&_type=json`;
  console.log("[BUILDING] 전유면적 요청:", url.replace(BUILDING_API_KEY, "***KEY***"));
  const { items, error } = await fetchBuildingApi(url, "전유면적", 1);
  if (error) console.warn("[BUILDING] 전유면적 조회 실패:", error);
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

// ── 건축물대장 단지 정보 조회 엔드포인트 ─────────────────────────────
app.get("/api/apartment/complex-info", async (req, res) => {
  const { lawdCd, address } = req.query;
  if (!lawdCd || !address) return res.status(400).json({ error: "lawdCd, address 필수" });
  if (!BUILDING_API_KEY) return res.status(503).json({ error: "건축물대장 API 키 미설정" });

  try {
    const { dongNm, bun, ji } = parseKrebAddress(address);
    if (!dongNm) {
      return res.status(400).json({ error: "주소에서 동 이름을 찾을 수 없습니다" });
    }

    console.log(`[COMPLEX] 파싱 결과: dongNm=${dongNm}, bun=${bun}, ji=${ji}, lawdCd=${lawdCd}`);

    // bjdongCd 조회: 쿼리 파라미터로 전달된 값 우선, 없으면 단지목록 API로 조회
    let bjdongCd = req.query.bjdongCd || null;
    if (!bjdongCd) {
      bjdongCd = await resolveBjdongCd(lawdCd, dongNm);
    }
    if (!bjdongCd) {
      return res.status(404).json({ error: `법정동코드를 찾을 수 없습니다: ${dongNm}` });
    }

    console.log(`[COMPLEX] bjdongCd 확인: ${bjdongCd}`);

    // 건축물대장 API는 동일 서비스 동시 호출 시 rate limit 발생 가능
    // → 건축물대장 3건은 순차 호출, 공동주택 코드 조회는 별도 서비스이므로 병렬
    const bjdCode10 = lawdCd + bjdongCd;
    const [buildingResult, kaptCode] = await Promise.all([
      (async () => {
        const titleItems = await fetchBuildingTitle(lawdCd, bjdongCd, bun, ji);
        const recapTitle = await fetchBuildingRecapTitle(lawdCd, bjdongCd, bun, ji);
        const areaItems = await fetchBuildingArea(lawdCd, bjdongCd, bun, ji);
        return { titleItems, recapTitle, areaItems };
      })(),
      findKaptCode(bjdCode10, req.query.aptName || ""),
    ]);
    const { titleItems, recapTitle, areaItems } = buildingResult;

    // kaptCode로 공동주택 기본정보 조회
    const housingInfo = kaptCode ? await fetchHousingBasicInfo(kaptCode) : null;

    if (titleItems.length === 0) {
      return res.status(404).json({ error: "건축물대장 정보를 찾을 수 없습니다" });
    }

    // 총괄표제부에서 단지 전체 정보 (용적률, 건폐율, 주차, 세대수)
    let totalHhld = parseInt(recapTitle?.hhldCnt) || 0;
    let totalPkng = parseInt(recapTitle?.totPkngCnt) || 0;
    let bcRat = parseFloat(recapTitle?.bcRat) || 0;
    let vlRat = parseFloat(recapTitle?.vlRat) || 0;
    let totArea = parseFloat(recapTitle?.totArea) || 0;

    // 표제부에서 동별 정보 (최고층, 지하층, 사용승인일)
    let maxFloor = 0;
    let maxUgrndFloor = 0;
    let useAprDay = "";
    const buildingNames = [];

    for (const item of titleItems) {
      const grndFlr = parseInt(item.grndFlrCnt) || 0;
      const ugrndFlr = parseInt(item.ugrndFlrCnt) || 0;

      if (grndFlr > maxFloor) maxFloor = grndFlr;
      if (ugrndFlr > maxUgrndFloor) maxUgrndFloor = ugrndFlr;
      if (!useAprDay && item.useAprDay) useAprDay = String(item.useAprDay);

      if (item.bldNm) buildingNames.push(item.bldNm);
    }

    // 호별 그룹핑으로 전용면적 + 주거공용면적 → 공급면적 계산
    const unitMap = {};
    for (const item of areaItems) {
      const key = (item.dongNm || "") + "-" + (item.hoNm || "");
      if (!unitMap[key]) unitMap[key] = { exclusive: 0, mainPurps: "", pubItems: [] };
      const gbNm = String(item.exposPubuseGbCdNm || "").trim();
      if (gbNm === "전유") {
        unitMap[key].exclusive = parseFloat(item.area) || 0;
        unitMap[key].mainPurps = item.mainPurpsCdNm || "";
      } else if (gbNm === "공용") {
        unitMap[key].pubItems.push({
          area: parseFloat(item.area) || 0,
          etcPurps: item.etcPurps || "",
          mainAtch: item.mainAtchGbCdNm || "",
        });
      }
    }

    // 전용면적 타입별 공급면적 산출 (아파트 용도만, 10㎡ 초과)
    const supplyByExclusive = {};
    for (const unit of Object.values(unitMap)) {
      if (!unit.exclusive || unit.exclusive <= 10) continue;
      if (unit.mainPurps && unit.mainPurps !== "아파트") continue;
      const areaKey = Math.round(unit.exclusive * 100) / 100;
      if (supplyByExclusive[areaKey]) continue; // 타입별 1개만 필요
      // 주거공용 = 주건축물 공용 중 주차장/펌프실/전기실/기계실 제외
      const residentialCommon = unit.pubItems
        .filter(p => p.mainAtch === "주건축물" && !/주차|펌프|전기|기계/.test(p.etcPurps))
        .reduce((sum, p) => sum + p.area, 0);
      supplyByExclusive[areaKey] = areaKey + residentialCommon;
    }

    // 면적 정렬 및 평수 변환
    const sortedAreas = Object.keys(supplyByExclusive).map(Number).sort((a, b) => a - b);
    const areaList = sortedAreas.map(a => {
      const supplyArea = Math.round(supplyByExclusive[a]);
      return {
        area: a,
        areaPyeong: Math.round(a / 3.3058),
        supplyArea,
        supplyPyeong: Math.round(supplyArea / 3.3058),
      };
    });

    // 사용승인일 포맷
    let useAprDate = "";
    if (useAprDay && useAprDay.length >= 8) {
      useAprDate = `${useAprDay.substring(0, 4)}.${useAprDay.substring(4, 6)}.${useAprDay.substring(6, 8)}`;
    }

    // 세대당 주차대수
    const parkingPerUnit = totalHhld > 0 ? Math.round((totalPkng / totalHhld) * 100) / 100 : 0;

    const result = {
      buildingCount: titleItems.length,
      buildingNames,
      maxFloor,
      maxUgrndFloor,
      totalHouseholds: totalHhld,
      totalParking: totalPkng,
      parkingPerUnit,
      bcRat: Math.round(bcRat * 100) / 100,
      vlRat: Math.round(vlRat * 100) / 100,
      useAprDate,
      totArea: Math.round(totArea * 100) / 100,
      exclusiveAreas: areaList,
      // 공동주택 기본정보 (단지목록 API에서 조회)
      heatType: housingInfo?.codeHeatNm || null,
      constructor: housingInfo?.kaptBcompany || null,
      developer: housingInfo?.kaptAcompany || null,
      manageTel: housingInfo?.kaptTel ? housingInfo.kaptTel.replace(/[^0-9]/g, "").replace(/^(02)(\d{3,4})(\d{4})$/, "$1-$2-$3").replace(/^(0\d{2})(\d{3,4})(\d{4})$/, "$1-$2-$3") : null,
      manageType: housingInfo?.codeMgrNm || null,
      hallType: housingInfo?.codeHallNm || null,
      doroJuso: housingInfo?.doroJuso || null,
    };

    console.log(`[COMPLEX] 결과: ${titleItems.length}개동, 최고${maxFloor}층, 용적률${vlRat}%`);
    res.json(result);
  } catch (e) {
    console.error("건축물대장 조회 실패:", e.message, e.stack);
    res.status(500).json({ error: "건축물대장 조회 실패", detail: e.message });
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
