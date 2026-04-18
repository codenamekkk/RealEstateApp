# 실거래 데이터 매칭·갱신 버그 수정 계획

작성일: 2026-04-18
대상 파일: `server/index.js`, `server/rooms.db` 스키마
배포 영향: Render 재배포 1회 필요

---

## 1. 발견된 문제

### 1.1 최근 거래 누락 (예: 안암골벽산 2026-03 거래 2건)
네이버 부동산에는 2026-03 매매 거래 2건(10억·8층 / 9.5억·14층)이 표시되지만, 앱에는 노출되지 않음. 전체 월간 캐시가 2026-03-16 이후 33일째 갱신되지 않은 상태.

### 1.2 동일 단지 거래 대량 누락 (안암골벽산 검색 시 71건 중 1건만 노출)
앱에서 "제기안암골벽산" 검색 시 매매 거래가 단 1건만 표시됨. 로컬 DB에는 해당 단지 거래 71건이 이미 적재되어 있음에도 조회 결과에서 제외됨.

### 1.3 해제(취소) 거래 미처리 (잠재적 문제)
MOLIT API가 계약 해제 거래를 별도 필드로 구분해 제공하나, 앱은 이를 저장·필터링하지 않음. 현재 해제된 거래는 없지만, 향후 발생 시 허위·취소 거래가 영구 노출되는 버그가 발생할 수 있음.

---

## 2. 원인 분석

### 2.1 캐시 TTL 로직 결함
[server/index.js:497](../server/index.js#L497) `ensureCached()`, [server/index.js:566](../server/index.js#L566) `ensureRentCached()`

```js
if (log && (!isCurrentMonth || (now - log.fetched_at) < 86400)) {
  return; // 캐시 유효
}
```

| 조건 | TTL |
|---|---|
| 현재 월 | 24시간 |
| 과거 월 | **무한 (재호출 없음)** |

부동산 거래 신고 마감은 **계약일로부터 30일**. 따라서 직전 1~2개월 데이터는 시간이 지나며 점진적으로 채워지지만, 현재 로직은 한 번 fetch한 과거 월을 영영 다시 호출하지 않아 신고 지연 데이터가 영구 누락됨.

**검증**: `api_fetch_log` 확인 시 동대문구(11230)의 2026-03 이하 모든 월이 2026-03-16~17에 마지막 fetch 이후 갱신 없음.

### 2.2 INSERT 로직에서 `kapt_code` 컬럼 누락
[server/index.js:509-513](../server/index.js#L509-L513)

```js
INSERT OR IGNORE INTO transaction_cache
(lawd_cd, deal_ymd, apt_nm, apt_dong, exclu_use_ar, deal_amount, floor, build_year, umd_nm, jibun, deal_year, deal_month, deal_day)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

스키마에 `kapt_code` 컬럼은 존재하나 INSERT 쿼리에 포함되지 않음. MOLIT 응답의 `aptSeq` 필드(단지 고유 식별자, 예: `"11230-84"`)가 한 번도 저장된 적 없음.

**영향**: 조회 시 1순위 매칭 키인 `kapt_code` 기반 조인([server/index.js:697-701](../server/index.js#L697-L701))이 항상 실패. 전체 `transaction_cache` 행이 `kapt_code=NULL`.

### 2.3 기존 캐시의 `jibun` 누락
[server/index.js:521-523](../server/index.js#L521-L523)

현재 코드는 `bonbun`+`bubun` 필드로부터 jibun을 조합하도록 작성되어 있으나, 이 패치는 **2026-03-22 커밋 `7bbaf45`에서 추가**됨. 반면 동대문구(11230) 캐시 10,009건은 **2026-03-16~17에 적재**되어 패치 이전 버전의 코드로 저장됨.

**결과**: 동대문구 전체 10,009건 모두 `jibun=""`. 기존 데이터에 대한 백필이 한 번도 수행되지 않음.

**영향**: 조회 시 2순위 매칭 키인 `(umd_nm, jibun)` 기반 조인([server/index.js:704-708](../server/index.js#L704-L708))도 실패.

### 2.4 3순위 fallback(apt_nm)의 정규화 부재
[server/index.js:711-725](../server/index.js#L711-L725)

검색 entry의 `aptNm="제기안암골벽산"` vs DB의 `apt_nm="안암골벽산"` 불일치. LIKE 매칭은 `${cleanName}%` 패턴이라 prefix가 다르면 실패.

**결과**: 1·2·3순위 매칭 모두 실패 → 71건 중 1건(별도 경로로 우연히 매칭된 것으로 추정)만 노출.

### 2.5 해제 거래 필드 미처리
MOLIT 응답은 `cdealType`(해제 시 `"O"`), `cdealDay`(해제일) 필드를 제공. 현재 스키마와 INSERT 모두 이 두 컬럼을 다루지 않음. 조회 시 필터링도 없음.

---

## 3. 해결 방법 및 작업 계획

### 3.1 작업 순서

| 단계 | 작업 | 파일/대상 | 비고 |
|---|---|---|---|
| **S1** | TTL 로직 수정 — 최근 3개월은 1일 TTL, 그 이전은 영구 캐시 | `server/index.js` (`ensureCached`, `ensureRentCached`) | 로직만 변경 |
| **S2** | 스키마 마이그레이션 — `transaction_cache`/`rent_cache`에 `cdeal_type`, `cdeal_day` 컬럼 추가 | `server/rooms.db` | `ALTER TABLE`, 서버 기동 시 idempotent 실행 |
| **S3** | INSERT 보강 — `kapt_code`(=aptSeq), `cdeal_type`, `cdeal_day` 저장 추가 | `server/index.js` (매매·전월세 양쪽) | 기존 컬럼은 유지 |
| **S4** | INSERT 전략 변경 — 월 단위 fetch 시 `INSERT OR IGNORE` → **월 캐시 DELETE 후 INSERT** 로 변경 | `server/index.js` | 가격 정정·해제 거래 반영 |
| **S5** | SELECT 필터 — 조회 시 `cdeal_type='O'` 행 제외 | `queryByJibun()` 및 관련 쿼리 | 해제 거래 숨김 |
| **S6** | 기존 데이터 백필 — `api_fetch_log` 해당 행 DELETE → 다음 조회 시 자연 재fetch로 `kapt_code`/`jibun`/`cdeal_*` 채움 | 런타임 또는 관리 스크립트 | 배포 직후 lazy 갱신 |
| **S7** | 로컬 검증 — 안암골벽산 검색 시 71건 정상 매칭 확인, 2026-03 거래 2건 노출 확인 | 개발 환경 | |
| **S8** | Render 배포 | | `memory/project_deploy.md` 참고 |

### 3.2 S1 상세 — TTL 로직

```js
// 최근 3개월은 1일 TTL (신고 30일 마감 + 해제 거래 가능성)
const yy = parseInt(dealYmd.slice(0, 4));
const mm = parseInt(dealYmd.slice(4, 6));
const today = new Date();
const monthsAgo = (today.getFullYear() - yy) * 12 + (today.getMonth() + 1 - mm);
const ttl = monthsAgo <= 3 ? 86400 : Infinity;

if (log && (now - log.fetched_at) < ttl) return;
```

`ensureCached()`·`ensureRentCached()` 양쪽에 동일 패턴 적용.

### 3.3 S2 상세 — 스키마 마이그레이션

서버 기동 시점에 idempotent 실행:

```js
try { db.exec("ALTER TABLE transaction_cache ADD COLUMN cdeal_type TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE transaction_cache ADD COLUMN cdeal_day TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE rent_cache ADD COLUMN cdeal_type TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE rent_cache ADD COLUMN cdeal_day TEXT DEFAULT ''"); } catch {}
```

### 3.4 S3 상세 — INSERT 보강

```js
INSERT OR IGNORE INTO transaction_cache
(lawd_cd, deal_ymd, apt_nm, apt_dong, exclu_use_ar, deal_amount, floor, build_year, umd_nm, jibun, deal_year, deal_month, deal_day, kapt_code, cdeal_type, cdeal_day)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

MOLIT 응답 파싱 시:
- `kapt_code = String(item.aptSeq || "").trim() || null`
- `cdeal_type = String(item.cdealType || "").trim()`
- `cdeal_day = String(item.cdealDay || "").trim()`

### 3.5 S4 상세 — INSERT 전략 변경

기존 `INSERT OR IGNORE`는 UNIQUE 제약 충돌 시 무시. 가격 정정·해제 표시 업데이트가 반영되지 않음.

변경: fetch 성공 시 해당 `(lawd_cd, deal_ymd)` 월의 기존 캐시를 DELETE 후 전량 재삽입.

```js
const tx = db.transaction(() => {
  db.prepare("DELETE FROM transaction_cache WHERE lawd_cd = ? AND deal_ymd = ?").run(lawdCd, dealYmd);
  for (const item of items) { /* INSERT */ }
  // api_fetch_log 업데이트
});
```

### 3.6 S5 상세 — 조회 필터

[`queryByJibun()`](../server/index.js#L670) 내 모든 SELECT에 `AND (cdeal_type IS NULL OR cdeal_type <> 'O')` 추가.

### 3.7 S6 상세 — 백필 전략

두 가지 선택지:

**A. Lazy 자연 갱신 (권장)**
- 배포 직후 `api_fetch_log` DELETE (또는 `fetched_at` 초기화)
- 사용자가 조회하면 TTL 로직이 재fetch 트리거
- 부하 분산, 단순

**B. 배포 직후 일괄 백필**
- 관리용 스크립트 실행: 모든 법정동코드 × 최근 N개월 재호출
- 즉시 정합 확보, 단 MOLIT API 호출량 큼

기본은 A. 문제가 심한 지역(동대문구 등)만 수동 트리거.

### 3.8 검증 기준 (S7)

- [ ] 서버 기동 후 `transaction_cache` ALTER 성공 (`PRAGMA table_info`)
- [ ] 안암골벽산 raw MOLIT 호출 → `aptSeq="11230-84"` 저장 확인
- [ ] 검색 "제기안암골벽산" 또는 "약령시로 25" → 매매 71건+α 매칭 확인
- [ ] 2026-03 거래 4건(10억/9.5억/10.85억/10.5억) 노출 확인
- [ ] 해제 거래(`cdealType='O'`)가 있는 월 샘플로 필터 동작 검증

### 3.9 롤백 계획

- 코드: 이전 커밋으로 revert
- DB: ALTER로 추가된 컬럼은 이전 버전에서 무시되므로 자동 호환. 수동 롤백 불필요.

---

## 4. 별도 고려 사항

### 4.1 대상 API 범위
본 작업은 매매(`transaction_cache`) 및 전월세(`rent_cache`) 양쪽 모두 적용. 건축물대장(`building_info_cache`)·좌표(`coord_cache`) 등은 별개.

### 4.2 검색명 정규화 불필요
`kapt_code` 1순위 매칭이 복구되면 3순위 apt_nm fallback은 거의 사용되지 않음. 별도 alias 매핑 작업 생략 가능.

### 4.3 네이버와의 데이터 차이
- 네이버 108타입 화면은 특정 전용면적(84.98㎡)만 필터링하므로 116.69㎡ 거래는 제외됨. 이는 UI 필터 차이일 뿐 데이터 누락 아님.
- 본 수정으로 앱은 MOLIT 원본과 거의 동일한 수준의 정합성 달성 예정.
