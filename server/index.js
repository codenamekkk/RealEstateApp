require("dotenv").config();
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
const KAKAO_API_KEY = process.env.KAKAO_REST_API_KEY || "";
const MOLIT_API_KEY = process.env.MOLIT_API_KEY || "";

if (!KAKAO_API_KEY) console.warn("⚠️ KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다");
if (!MOLIT_API_KEY) console.warn("⚠️ MOLIT_API_KEY 환경변수가 설정되지 않았습니다");

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
  const url = `http://openapi.molit.go.kr:8081/OpenAPI_ToolInstallPackage/service/rest/RTMSOBJSvc/getRTMSDataSvcAptTrade?serviceKey=${MOLIT_API_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=9999&pageNo=1`;
  const res = await fetch(url, { timeout: 15000 });
  const xml = await res.text();
  const json = xmlParser.parse(xml);
  const items = json?.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

async function ensureCached(lawdCd, dealYmd) {
  const log = db.prepare("SELECT fetched_at FROM api_fetch_log WHERE lawd_cd = ? AND deal_ymd = ?").get(lawdCd, dealYmd);
  const now = Math.floor(Date.now() / 1000);
  const currentYm = new Date().toISOString().slice(0, 7).replace("-", "");
  const isCurrentMonth = dealYmd === currentYm;

  if (log && (!isCurrentMonth || (now - log.fetched_at) < 86400)) {
    return; // 캐시 유효
  }

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

// ── 아파트 검색 (카카오 프록시) ─────────────────────────────────────
app.get("/api/search/apartment", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "query 필수" });
  if (!KAKAO_API_KEY) return res.status(503).json({ error: "카카오 API 키 미설정" });

  try {
    const kakaoRes = await fetch(
      `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query + " 아파트")}&size=15`,
      { headers: { Authorization: `KakaoAK ${KAKAO_API_KEY}` }, timeout: 10000 }
    );
    const data = await kakaoRes.json();
    const results = (data.documents || []).map(d => ({
      placeName: d.place_name,
      addressName: d.address_name,
      roadAddressName: d.road_address_name || "",
      x: d.x,
      y: d.y,
      categoryName: d.category_name || "",
    }));
    res.json(results);
  } catch (e) {
    console.error("카카오 검색 실패:", e.message);
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
  const { aptNm, lawdCd } = req.query;
  if (!aptNm || !lawdCd) return res.status(400).json({ error: "aptNm, lawdCd 필수" });
  if (!MOLIT_API_KEY) return res.status(503).json({ error: "국토교통부 API 키 미설정" });

  try {
    const months = getMonthRange(6);
    for (const ym of months) {
      await ensureCached(lawdCd, ym);
    }

    const rows = db.prepare(`
      SELECT DISTINCT exclu_use_ar FROM transaction_cache
      WHERE lawd_cd = ? AND apt_nm = ?
      ORDER BY exclu_use_ar
    `).all(lawdCd, aptNm);

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
  const { aptNm, lawdCd, area, months: monthsStr } = req.query;
  if (!aptNm || !lawdCd) return res.status(400).json({ error: "aptNm, lawdCd 필수" });
  if (!MOLIT_API_KEY) return res.status(503).json({ error: "국토교통부 API 키 미설정" });

  try {
    const numMonths = parseInt(monthsStr) || 12;
    const monthList = getMonthRange(numMonths);
    for (const ym of monthList) {
      await ensureCached(lawdCd, ym);
    }

    let query = `SELECT * FROM transaction_cache WHERE lawd_cd = ? AND apt_nm = ?`;
    const params = [lawdCd, aptNm];

    if (area && area !== "전체") {
      const areaNum = parseFloat(area);
      query += ` AND exclu_use_ar BETWEEN ? AND ?`;
      params.push(areaNum - 2, areaNum + 2);
    }
    query += ` ORDER BY deal_year DESC, deal_month DESC, deal_day DESC`;

    const rows = db.prepare(query).all(...params);

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
        };
      } else {
        if (r.deal_amount > dongMap[key].highestPrice) {
          dongMap[key].highestPrice = r.deal_amount;
          dongMap[key].highestDate = `${r.deal_year}.${String(r.deal_month).padStart(2, "0")}.${String(r.deal_day).padStart(2, "0")}`;
          dongMap[key].highestFloor = r.floor;
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

    res.json({
      transactions,
      dongSummary: Object.values(dongMap),
    });
  } catch (e) {
    console.error("실거래 조회 실패:", e.message);
    res.status(500).json({ error: "실거래 조회 실패" });
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
    for (const ym of months) {
      await ensureCached(lawdCd, ym);
    }

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

    // 인접 구 비교 (같은 시도)
    const sidoPrefix = lawdCd.slice(0, 2);
    const neighborGus = db.prepare(`
      SELECT lawd_cd, gu_nm FROM region_codes
      WHERE lawd_cd LIKE ? AND lawd_cd != ?
    `).all(`${sidoPrefix}%`, lawdCd);

    const neighborComparison = [];
    // 현재 구 추가
    const currentGu = db.prepare("SELECT gu_nm FROM region_codes WHERE lawd_cd = ?").get(lawdCd);
    if (currentGu && guAvg) {
      neighborComparison.push({ guNm: currentGu.gu_nm, avg: guAvg });
    }

    // 인접 구 (최대 5개, 거래 데이터가 있는 것만)
    for (const ng of neighborGus.slice(0, 10)) {
      const ngPrices = db.prepare(`
        SELECT deal_amount FROM transaction_cache
        WHERE lawd_cd = ? AND exclu_use_ar BETWEEN ? AND ?
      `).all(ng.lawd_cd, areaNum - 5, areaNum + 5).map(r => r.deal_amount);

      if (ngPrices.length > 0) {
        neighborComparison.push({
          guNm: ng.gu_nm,
          avg: Math.round(ngPrices.reduce((s, p) => s + p, 0) / ngPrices.length),
        });
      }
      if (neighborComparison.length >= 6) break;
    }

    neighborComparison.sort((a, b) => b.avg - a.avg);

    res.json({ guAvg, dongAvg, percentile, dongPercentile, neighborComparison });
  } catch (e) {
    console.error("지역 분석 실패:", e.message);
    res.status(500).json({ error: "지역 분석 실패" });
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
