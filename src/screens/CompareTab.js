// src/screens/CompareTab.js
import React, { useState, useRef } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Dimensions, PanResponder } from "react-native";
import { COLORS, calcScore, getGrade, getScoreColor, formatPrice, sqmToPyeong } from "../constants";
import Svg, { Polygon, Line, Text as SvgText, Circle } from "react-native-svg";

const SCREEN_WIDTH = Dimensions.get("window").width;
const CHART_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

function PropertyCard({ property, criteria, onPress, rank }) {
  const activeCriteria = criteria.filter(c => !c.hidden);
  const { percent } = calcScore(property, activeCriteria);
  const grade = getGrade(percent);
  const rankEmoji = rank === 0 ? "\u{1F947}" : rank === 1 ? "\u{1F948}" : rank === 2 ? "\u{1F949}" : null;

  // 등급 라벨에서 이모지 제거 (안전한 방식)
  const gradeText = grade.label.replace(/[^\p{L}\p{N}\s]/gu, "").trim();

  return (
    <TouchableOpacity onPress={onPress} style={styles.card}>
      <View style={styles.cardTopRow}>
        {rankEmoji ? <Text style={styles.rankEmoji}>{rankEmoji}</Text> : <Text style={[styles.rankNum, { color: COLORS.textFaint }]}>{rank + 1}</Text>}
        <View style={{ flex: 1 }}>
          <Text style={styles.propName}>{property.name || "이름 없음"}</Text>
          {property.address ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.propAddr}>{property.address}</Text>
              {property.selectedArea ? (
                <View style={styles.areaBadge}>
                  <Text style={styles.areaBadgeText}>
                    {property.selectedArea === "전체" ? "전체" : (() => {
                      const group = property.selectedAreaGroup;
                      if (group?.supplyPyeong) return group.supplyPyeong + "평";
                      const ci = property.complexInfo?.exclusiveAreas?.find(e =>
                        e.groupedExclusiveAreas
                          ? e.groupedExclusiveAreas.some(ea => Math.abs(ea - Number(property.selectedArea)) < 1)
                          : Math.abs(e.area - Number(property.selectedArea)) < 2
                      );
                      return (ci?.supplyPyeong || sqmToPyeong(property.selectedArea)) + "평";
                    })()}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {property.price ? <Text style={styles.propPrice}>{Number(property.price).toLocaleString()}원</Text> : null}
        </View>
        <View style={[styles.gradeBadge, { backgroundColor: grade.color + "22" }]}>
          <Text style={[styles.gradeBadgeText, { color: grade.color }]}>{gradeText}</Text>
        </View>
      </View>

      {/* 실거래 정보 */}
      {property.recentPrice ? (
        <View style={styles.txInfo}>
          <View style={styles.txInfoItem}>
            <Text style={styles.txInfoLabel}>최고가</Text>
            <Text style={[styles.txInfoValue, { color: "#f59e0b" }]}>{formatPrice(property.highestPrice)}</Text>
          </View>
          <View style={styles.txInfoItem}>
            <Text style={styles.txInfoLabel}>최근 실거래</Text>
            <Text style={styles.txInfoValue}>{formatPrice(property.recentPrice)}</Text>
          </View>
          {property.pricePercentile != null && (
            <View style={styles.txInfoItem}>
              <Text style={styles.txInfoLabel}>구 내</Text>
              <Text style={[styles.txInfoValue, { color: "#6366f1" }]}>상위 {property.pricePercentile}%</Text>
            </View>
          )}
        </View>
      ) : null}

      {/* Progress bar */}
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${percent}%`, backgroundColor: grade.color }]} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
        <Text style={styles.subText}>{activeCriteria.filter(c => property.scores[c.id] > 0).length}/{activeCriteria.length} 항목</Text>
        <Text style={[styles.percentText, { color: grade.color }]}>{percent}%</Text>
      </View>
    </TouchableOpacity>
  );
}

// 순수 View 기반 막대 차트
function SimpleBarChart({ properties }) {
  if (properties.length === 0) return null;
  const allValues = properties.flatMap(p => [p.recentPrice || 0, p.highestPrice || 0, p.regionAvg || 0]);
  const maxVal = Math.max(...allValues, 1);
  const barHeight = 160;

  return (
    <View style={styles.chartCard}>
      <Text style={styles.chartTitle}>가격 비교 (만원)</Text>
      <View style={{ flexDirection: "row", alignItems: "flex-end", height: barHeight, paddingHorizontal: 8, gap: 12 }}>
        {properties.slice(0, 4).map((p, i) => {
          const hasTx = !!p.recentPrice;
          const recent = p.recentPrice || 0;
          const highest = p.highestPrice || 0;
          const avg = p.regionAvg || 0;
          return (
            <View key={p.id} style={{ flex: 1, alignItems: "center", gap: 2 }}>
              {hasTx ? (
                <View style={{ flexDirection: "row", alignItems: "flex-end", height: barHeight - 20, gap: 2, width: "100%" }}>
                  {/* 최고가 */}
                  <View style={{ flex: 1, justifyContent: "flex-end", alignItems: "center" }}>
                    <Text style={{ color: COLORS.textFaint, fontSize: 8, marginBottom: 2 }}>{formatPrice(highest)}</Text>
                    <View style={{ width: "100%", height: maxVal > 0 ? (highest / maxVal) * (barHeight - 40) : 0, backgroundColor: CHART_COLORS[i], borderRadius: 3 }} />
                  </View>
                  {/* 최근 거래가 */}
                  <View style={{ flex: 1, justifyContent: "flex-end", alignItems: "center" }}>
                    <Text style={{ color: COLORS.textFaint, fontSize: 8, marginBottom: 2 }}>{formatPrice(recent)}</Text>
                    <View style={{ width: "100%", height: maxVal > 0 ? (recent / maxVal) * (barHeight - 40) : 0, backgroundColor: CHART_COLORS[i] + "88", borderRadius: 3 }} />
                  </View>
                  {/* 구 평균 */}
                  <View style={{ flex: 1, justifyContent: "flex-end", alignItems: "center" }}>
                    <Text style={{ color: COLORS.textFaint, fontSize: 8, marginBottom: 2 }}>{formatPrice(avg)}</Text>
                    <View style={{ width: "100%", height: maxVal > 0 ? (avg / maxVal) * (barHeight - 40) : 0, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 3 }} />
                  </View>
                </View>
              ) : (
                <View style={{ height: barHeight - 20, justifyContent: "center", alignItems: "center", width: "100%" }}>
                  <Text style={{ color: COLORS.textFaint, fontSize: 10 }}>거래 없음</Text>
                </View>
              )}
              <Text style={{ color: COLORS.textMuted, fontSize: 10, marginTop: 4 }} numberOfLines={1}>{(p.name || "").slice(0, 5)}</Text>
            </View>
          );
        })}
      </View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "rgba(255,255,255,1)" }]} />
          <Text style={styles.legendText}>최고가</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "rgba(255,255,255,0.5)" }]} />
          <Text style={styles.legendText}>최근 거래</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "rgba(255,255,255,0.2)" }]} />
          <Text style={styles.legendText}>구 평균</Text>
        </View>
      </View>
    </View>
  );
}

// SVG 기반 꺾은선 차트 (인터랙티브, 고정 6개월 X축)
function SimpleLineChart({ dataSets, allProperties }) {
  if (dataSets.length === 0) return null;
  const [activeIdx, setActiveIdx] = useState(null);
  const chartRef = useRef(null);
  const layoutRef = useRef({ x: 0 });

  const chartW = SCREEN_WIDTH - 80;
  const chartH = 160;
  const padL = 45, padR = 10, padT = 10, padB = 30;
  const drawW = chartW - padL - padR;
  const drawH = chartH - padT - padB;
  const numSlots = 6; // 고정 6개월

  // value가 있는 데이터만으로 min/max 계산
  const allValues = dataSets.flatMap(ds => ds.data.filter(d => d.value != null).map(d => d.value));
  if (allValues.length === 0) return null;
  const minVal = Math.min(...allValues) * 0.95;
  const maxVal = Math.max(...allValues) * 1.05;
  const range = maxVal - minVal || 1;

  const getX = (idx) => padL + (idx / (numSlots - 1)) * drawW;
  const getY = (val) => padT + drawH - ((val - minVal) / range) * drawH;

  // X 좌표 → 가장 가까운 월 인덱스로 스냅
  const snapToIndex = (touchX) => {
    const localX = touchX - layoutRef.current.x;
    if (localX < padL || localX > chartW - padR) return null;
    const ratio = (localX - padL) / drawW;
    const idx = Math.round(ratio * (numSlots - 1));
    return Math.max(0, Math.min(numSlots - 1, idx));
  };

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => setActiveIdx(snapToIndex(e.nativeEvent.pageX)),
    onPanResponderMove: (e) => setActiveIdx(snapToIndex(e.nativeEvent.pageX)),
    onPanResponderRelease: () => setActiveIdx(null),
    onPanResponderTerminate: () => setActiveIdx(null),
  })).current;

  const activeX = activeIdx != null ? getX(activeIdx) : null;

  return (
    <View style={styles.chartCard}>
      <Text style={styles.chartTitle}>시세 추이 - 최근 6개월 (억원)</Text>

      {/* 툴팁 */}
      {activeIdx != null && (
        <View style={styles.tooltipRow}>
          {dataSets.map((ds, si) => {
            const d = ds.data[activeIdx];
            if (!d || d.value == null) return null;
            return (
              <View key={si} style={[styles.tooltipBox, { borderColor: ds.color }]}>
                <Text style={styles.tooltipName}>{ds.name}</Text>
                <Text style={styles.tooltipPrice}>{formatPrice(d.amount)}</Text>
                <Text style={styles.tooltipDate}>{d.date}</Text>
                {d.totalCount > 1 && (
                  <Text style={styles.tooltipCount}>{d.totalCount}건 중 최고가</Text>
                )}
              </View>
            );
          })}
        </View>
      )}

      <View
        ref={chartRef}
        onLayout={() => { chartRef.current?.measureInWindow((x) => { layoutRef.current.x = x; }); }}
        {...panResponder.panHandlers}
      >
        <Svg width={chartW} height={chartH}>
          {/* Y축 가이드 */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
            const y = padT + drawH * (1 - ratio);
            const val = minVal + range * ratio;
            return (
              <React.Fragment key={i}>
                <Line x1={padL} y1={y} x2={chartW - padR} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
                <SvgText x={padL - 5} y={y + 3} textAnchor="end" fill={COLORS.textFaint} fontSize={9}>
                  {val.toFixed(1)}
                </SvgText>
              </React.Fragment>
            );
          })}

          {/* 수직 가이드 라인 */}
          {activeX != null && (
            <Line x1={activeX} y1={padT} x2={activeX} y2={padT + drawH} stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
          )}

          {/* 데이터 라인 — 실선(거래 있음) / 점선(거래 없는 구간) */}
          {dataSets.map((ds, si) => {
            // 거래가 있는 포인트들의 좌표
            const filledPoints = ds.data.map((d, i) => d.value != null ? { i, x: getX(i), y: getY(d.value) } : null).filter(Boolean);
            // 인접한 거래 포인트 쌍을 연결 — 사이에 빈 달이 있으면 점선, 없으면 실선
            const segments = [];
            for (let k = 0; k < filledPoints.length - 1; k++) {
              const from = filledPoints[k];
              const to = filledPoints[k + 1];
              const gap = to.i - from.i > 1; // 사이에 빈 달이 있는지
              segments.push({ from, to, dashed: gap });
            }
            return (
              <React.Fragment key={si}>
                {segments.map((seg, k) => (
                  <Line key={`line-${k}`}
                    x1={seg.from.x} y1={seg.from.y} x2={seg.to.x} y2={seg.to.y}
                    stroke={ds.color} strokeWidth={seg.dashed ? 1 : 2}
                    strokeDasharray={seg.dashed ? "4,3" : "none"}
                    opacity={seg.dashed ? 0.4 : 1}
                  />
                ))}
                {filledPoints.map((pt) => {
                  const isActive = activeIdx === pt.i;
                  return <Circle key={pt.i} cx={pt.x} cy={pt.y} r={isActive ? 5 : 3} fill={ds.color} stroke={isActive ? "#fff" : "none"} strokeWidth={isActive ? 2 : 0} />;
                })}
              </React.Fragment>
            );
          })}

          {/* X축 라벨 — 고정 6개월 */}
          {dataSets[0].data.map((d, i) => (
            <SvgText key={i} x={getX(i)} y={chartH - 5} textAnchor="middle" fill={COLORS.textFaint} fontSize={9}>
              {d.label}
            </SvgText>
          ))}
        </Svg>
      </View>
      <View style={styles.legendRow}>
        {(allProperties || []).slice(0, 4).map((p, i) => {
          const hasData = dataSets.some(ds => ds.name === p.name);
          return (
            <View key={i} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: CHART_COLORS[i], opacity: hasData ? 1 : 0.3 }]} />
              <Text style={[styles.legendText, !hasData && { opacity: 0.4 }]}>
                {(p.name || "").slice(0, 6)}{!hasData ? " (없음)" : ""}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// 레이더 차트 컴포넌트
function RadarChart({ properties, criteria }) {
  const activeCriteria = criteria.filter(c => !c.hidden);
  if (activeCriteria.length < 3 || properties.length === 0) return null;

  const axes = activeCriteria.slice(0, 8);
  const size = SCREEN_WIDTH - 80;
  const cx = size / 2, cy = size / 2;
  const maxR = size / 2 - 30;
  const levels = 5;
  const angleStep = (2 * Math.PI) / axes.length;

  const getPoint = (index, value) => {
    const angle = (index * angleStep) - Math.PI / 2;
    const r = (value / 5) * maxR;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };

  return (
    <View style={styles.chartCard}>
      <Text style={styles.chartTitle}>종합 비교</Text>
      <Svg width={size} height={size + 20}>
        {/* 배경 격자 */}
        {Array.from({ length: levels }, (_, i) => {
          const r = ((i + 1) / levels) * maxR;
          const points = axes.map((_, j) => {
            const angle = (j * angleStep) - Math.PI / 2;
            return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
          }).join(" ");
          return <Polygon key={i} points={points} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />;
        })}

        {/* 축 선 */}
        {axes.map((_, i) => {
          const p = getPoint(i, 5);
          return <Line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />;
        })}

        {/* 데이터 다각형 */}
        {properties.slice(0, 4).map((prop, pi) => {
          const points = axes.map((c, i) => {
            const score = prop.scores[c.id] || 0;
            const p = getPoint(i, score);
            return `${p.x},${p.y}`;
          }).join(" ");
          return (
            <Polygon key={pi} points={points}
              fill={CHART_COLORS[pi] + "22"} stroke={CHART_COLORS[pi]} strokeWidth={2} />
          );
        })}

        {/* 축 라벨 */}
        {axes.map((c, i) => {
          const p = getPoint(i, 5.8);
          return (
            <SvgText key={i} x={p.x} y={p.y} textAnchor="middle" alignmentBaseline="middle"
              fill={COLORS.textFaint} fontSize={10}>{c.name.slice(0, 4)}</SvgText>
          );
        })}
      </Svg>
      {/* 범례 */}
      <View style={styles.legendRow}>
        {properties.slice(0, 4).map((p, i) => (
          <View key={i} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: CHART_COLORS[i] }]} />
            <Text style={styles.legendText}>{(p.name || "").slice(0, 6)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function CompareTab({ criteria, properties, onGoToScore }) {
  const activeCriteria = criteria.filter(c => !c.hidden);
  const sorted = [...properties].sort((a, b) => {
    const diff = calcScore(b, activeCriteria).percent - calcScore(a, activeCriteria).percent;
    if (diff !== 0) return diff;
    const priceA = Number(a.price) || Infinity;
    const priceB = Number(b.price) || Infinity;
    if (priceA !== priceB) return priceA - priceB;
    const highA = a.highestPrice || 0;
    const highB = b.highestPrice || 0;
    return highB - highA;
  });

  if (properties.length < 2) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📊</Text>
        <Text style={styles.emptyText}>비교하려면 매물을 2개 이상 추가해주세요</Text>
        <TouchableOpacity onPress={onGoToScore} style={styles.addBtn}>
          <Text style={styles.addBtnText}>+ 매물 추가하러 가기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 실거래 데이터가 있는 매물
  const propsWithTx = sorted.filter(p => p.recentPrice);

  // 꺾은선 차트 데이터 — 고정 6개월 X축, 월별 최고가 집계
  const hasLineData = propsWithTx.some(p => p.transactionHistory && p.transactionHistory.length > 0);
  let lineDataSets = [];
  let monthLabels = [];
  if (hasLineData) {
    // 최근 6개월 라벨 생성 (예: ["2025.10", "2025.11", ..., "2026.03"])
    const now = new Date();
    for (let m = 5; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      monthLabels.push(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    lineDataSets = sorted.map((p, i) => {
      const txs = p.transactionHistory || [];
      // 월별 그룹핑: 최고가 선택, 총 건수 기록
      const monthMap = new Map();
      txs.forEach(t => {
        const ym = t.dealDate.slice(0, 7); // "2026.01"
        if (!monthLabels.includes(ym)) return;
        const existing = monthMap.get(ym);
        if (!existing) {
          monthMap.set(ym, { ...t, totalCount: 1 });
        } else {
          existing.totalCount += 1;
          if (t.dealAmount > existing.dealAmount) {
            existing.dealAmount = t.dealAmount;
            existing.floor = t.floor;
            existing.aptDong = t.aptDong;
            existing.dealDate = t.dealDate;
          }
        }
      });
      // 6개월 슬롯에 맞춰 데이터 배열 (거래 없는 달은 null)
      const data = monthLabels.map(ym => {
        const entry = monthMap.get(ym);
        if (!entry) return { value: null, label: Number(ym.slice(5)) + "월", date: null, amount: null, totalCount: 0 };
        return {
          value: entry.dealAmount / 10000,
          label: Number(ym.slice(5)) + "월",
          date: entry.dealDate,
          amount: entry.dealAmount,
          totalCount: entry.totalCount,
        };
      });
      const hasAnyData = data.some(d => d.value != null);
      if (!hasAnyData) return null;
      return { data, color: CHART_COLORS[i], name: p.name };
    }).filter(Boolean);
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionTitle}>점수 높은 순으로 정렬</Text>

      {sorted.map((p, i) => (
        <PropertyCard
          key={p.id} property={p} criteria={criteria} rank={i}
          onPress={() => onGoToScore(p.id)}
        />
      ))}

      {/* 가격 비교 막대 차트 */}
      {sorted.length >= 2 && (
        <SimpleBarChart properties={sorted} />
      )}

      {/* 시세 추이 꺾은선 차트 */}
      {lineDataSets.length > 0 && (
        <SimpleLineChart dataSets={lineDataSets} allProperties={sorted} />
      )}

      {/* 레이더 차트 */}
      <RadarChart properties={sorted} criteria={criteria} />

      {/* Detail comparison table */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>항목별 상세 비교</Text>
      <View style={styles.table}>
        <View style={{ flexDirection: "row" }}>
          {/* Fixed left label column */}
          <View style={styles.tableLabelColumn}>
            <View style={[styles.tableLabelCellBox, styles.tableHeader, styles.tableRowHeight]}>
              <Text style={{ color: COLORS.textFaint, fontSize: 12, fontWeight: "700" }}>항목</Text>
            </View>
            {activeCriteria.map(c => (
              <View key={c.id} style={[styles.tableLabelCellBox, styles.tableDataRowHeight]}>
                <Text style={{ fontSize: 12, color: COLORS.textMuted }}>{c.name}</Text>
                <Text style={{ fontSize: 10, color: COLORS.textFaint }}>중요도 {c.weight}</Text>
              </View>
            ))}
          </View>

          {/* Scrollable score columns */}
          <ScrollView horizontal showsHorizontalScrollIndicator={true} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
            <View style={{ flex: 1 }}>
              {/* Header row */}
              <View style={[styles.tableScoreRow, styles.tableHeader, styles.tableRowHeight]}>
                {sorted.map(p => (
                  <Text key={p.id} style={[styles.tableCell, styles.tableScoreCell, { color: "#818cf8" }]}>
                    {(p.name || "").length > 4 ? (p.name || "").slice(0, 4) + ".." : p.name}
                  </Text>
                ))}
              </View>
              {/* Data rows */}
              {activeCriteria.map(c => {
                const scores  = sorted.map(p => p.scores[c.id] || 0);
                const maxScore = Math.max(...scores);
                return (
                  <View key={c.id} style={[styles.tableScoreRow, styles.tableDataRowHeight]}>
                    {scores.map((s, i) => {
                      const isTop = s === maxScore && scores.filter(x => x === maxScore).length === 1 && maxScore > 0;
                      return (
                        <View key={i} style={[styles.tableCell, styles.tableScoreCell]}>
                          {s > 0
                            ? <Text style={{ fontSize: 15, fontWeight: "800", color: isTop ? getScoreColor(s) : "#64748b" }}>
                                {s}{isTop ? "\u2605" : ""}
                              </Text>
                            : <Text style={{ color: "#374151", fontSize: 12 }}>-</Text>
                          }
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: COLORS.bg, padding: 16 },
  emptyContainer:  { flex: 1, backgroundColor: COLORS.bg, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyIcon:       { fontSize: 48, marginBottom: 16 },
  emptyText:       { color: COLORS.textFaint, fontSize: 14, textAlign: "center", lineHeight: 24, marginBottom: 20 },
  addBtn:          { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, backgroundColor: COLORS.primary },
  addBtnText:      { color: "#fff", fontWeight: "700", fontSize: 14 },
  sectionTitle:    { fontSize: 13, fontWeight: "700", color: COLORS.textMuted, marginBottom: 12 },
  card:            { backgroundColor: COLORS.surfaceAlt, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 16, padding: 16, marginBottom: 10 },
  cardTopRow:      { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  rankEmoji:       { fontSize: 22, width: 32, textAlign: "center" },
  rankNum:         { fontSize: 16, fontWeight: "900", width: 32, textAlign: "center" },
  propName:        { fontSize: 15, fontWeight: "700", color: COLORS.text },
  propAddr:        { fontSize: 12, color: COLORS.textFaint, marginTop: 2 },
  propPrice:       { fontSize: 12, color: "#818cf8", fontWeight: "700", marginTop: 2 },
  gradeBadge:      { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  gradeBadgeText:  { fontSize: 11, fontWeight: "700" },
  areaBadge:       { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  areaBadgeText:   { color: COLORS.textFaint, fontSize: 10, fontWeight: "600" },

  // 실거래 정보
  txInfo:        { flexDirection: "row", gap: 12, marginBottom: 10, paddingHorizontal: 4 },
  txInfoItem:    { flex: 1 },
  txInfoLabel:   { color: COLORS.textFaint, fontSize: 10, marginBottom: 2 },
  txInfoValue:   { color: COLORS.text, fontSize: 12, fontWeight: "700" },

  barBg:           { height: 6, backgroundColor: "#1e1e2e", borderRadius: 10, overflow: "hidden" },
  barFill:         { height: "100%", borderRadius: 10 },
  subText:         { fontSize: 11, color: COLORS.textFaint },
  percentText:     { fontSize: 16, fontWeight: "800" },

  // 차트
  chartCard:     { backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 16, marginBottom: 16, marginTop: 8 },
  chartTitle:    { fontSize: 13, fontWeight: "700", color: COLORS.textMuted, marginBottom: 12 },
  chartSubtext:  { color: COLORS.textFaint, fontSize: 10, textAlign: "center", marginTop: 8 },
  legendRow:     { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12, marginTop: 10 },
  legendItem:    { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot:     { width: 8, height: 8, borderRadius: 4 },
  legendText:    { color: COLORS.textFaint, fontSize: 10 },
  tooltipRow:    { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginBottom: 6 },
  tooltipBox:    { backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignItems: "center" },
  tooltipName:   { color: COLORS.textMuted, fontSize: 9, marginBottom: 1 },
  tooltipPrice:  { color: "#fff", fontSize: 11, fontWeight: "700" },
  tooltipDate:   { color: COLORS.textFaint, fontSize: 9 },
  tooltipCount:  { color: "#f59e0b", fontSize: 8, marginTop: 1 },

  // 테이블
  table:             { backgroundColor: "rgba(255,255,255,0.02)", borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, overflow: "hidden" },
  tableLabelColumn:  { width: 100, borderRightWidth: 1, borderRightColor: "rgba(255,255,255,0.06)" },
  tableLabelCellBox: { paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)", justifyContent: "center" },
  tableScoreRow:     { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)" },
  tableRowHeight:    { height: 38 },
  tableDataRowHeight: { height: 44 },
  tableHeader:       { backgroundColor: "rgba(255,255,255,0.05)" },
  tableCell:         { alignItems: "center", justifyContent: "center" },
  tableScoreCell:    { flex: 1, minWidth: 50, alignItems: "center", justifyContent: "center", textAlign: "center", textAlignVertical: "center" },
});
