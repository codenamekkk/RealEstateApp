// src/constants.js

export const DEFAULT_CRITERIA = [
  { id: 1, name: "매매가격",       weight: 5, description: "예산 대비 가격 적정성",            hidden: false },
  { id: 2, name: "교통 접근성",    weight: 4, description: "대중교통 및 도로 접근성",          hidden: false },
  { id: 3, name: "학군",           weight: 3, description: "주변 학교 수준 및 학원가",         hidden: false },
  { id: 4, name: "편의시설",       weight: 3, description: "마트, 병원, 공원 등",              hidden: false },
  { id: 5, name: "일조량/향",      weight: 2, description: "채광 및 집의 방향",               hidden: false },
  { id: 6, name: "층수/뷰",        weight: 2, description: "층수 및 전망",                    hidden: false },
  { id: 7, name: "건물 연식",      weight: 3, description: "신축 여부, 관리 상태",             hidden: false },
  { id: 8, name: "소음/환경",      weight: 2, description: "주변 소음 및 환경",               hidden: false },
  { id: 9, name: "재개발/리모델링",weight: 4, description: "재개발·재건축·리모델링 가능성",   hidden: false },
];

export const SCORE_LABELS = ["", "매우 나쁨", "나쁨", "보통", "좋음", "매우 좋음"];
export const SCORE_COLORS = ["", "#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981"];

export const COLORS = {
  bg:          "#0d0d14",
  surface:     "#16162a",
  surfaceAlt:  "rgba(255,255,255,0.03)",
  border:      "rgba(255,255,255,0.08)",
  borderFaint: "rgba(255,255,255,0.05)",
  primary:     "#6366f1",
  primarySoft: "rgba(99,102,241,0.15)",
  primaryBorder:"rgba(99,102,241,0.3)",
  text:        "#e2e8f0",
  textMuted:   "#94a3b8",
  textFaint:   "#64748b",
  textDimmer:  "#475569",
  danger:      "#ef4444",
  dangerSoft:  "rgba(239,68,68,0.08)",
};

export function generateId(len = 6) {
  return Math.random().toString(36).substring(2, 2 + len).toUpperCase();
}

export function getGrade(percent) {
  if (percent >= 80) return { label: "강력 추천 ✨", color: "#10b981" };
  if (percent >= 65) return { label: "추천 👍",      color: "#22c55e" };
  if (percent >= 50) return { label: "검토 필요 🤔", color: "#eab308" };
  if (percent >= 35) return { label: "비추천 👎",    color: "#f97316" };
  return               { label: "부적합 ❌",         color: "#ef4444" };
}

export function calcScore(property, activeCriteria) {
  const totalWeight = activeCriteria.reduce((s, c) => s + c.weight, 0);
  const totalScore  = activeCriteria.reduce((s, c) => {
    const raw = Number(property.scores[c.id]);
    const score = Number.isFinite(raw) ? raw : 0;
    return s + score * c.weight;
  }, 0);
  const max = totalWeight * 5;
  return { percent: max > 0 ? Math.round((totalScore / max) * 100) : 0, totalScore, max };
}
