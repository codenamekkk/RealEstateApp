// src/screens/CompareTab.js
import React, { lazy, Suspense } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Dimensions, ActivityIndicator } from "react-native";
import { COLORS, calcScore, getGrade, getScoreColor, formatPrice } from "../constants";

// Lazy load chart libraries to prevent crash on startup
let BarChart, LineChart, Svg, Polygon, Circle, Line, SvgText;
let chartsLoaded = false;

function loadCharts() {
  if (chartsLoaded) return true;
  try {
    const gifted = require("react-native-gifted-charts");
    BarChart = gifted.BarChart;
    LineChart = gifted.LineChart;
    const svg = require("react-native-svg");
    Svg = svg.default || svg.Svg;
    Polygon = svg.Polygon;
    Circle = svg.Circle;
    Line = svg.Line;
    SvgText = svg.Text;
    chartsLoaded = true;
    return true;
  } catch (e) {
    console.warn("차트 라이브러리 로드 실패:", e.message);
    return false;
  }
}

const SCREEN_WIDTH = Dimensions.get("window").width;
const CHART_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

function PropertyCard({ property, criteria, onPress, rank }) {
  const activeCriteria = criteria.filter(c => !c.hidden);
  const { percent } = calcScore(property, activeCriteria);
  const grade = getGrade(percent);
  const rankEmoji = rank === 0 ? "🥇" : rank === 1 ? "🥈" : rank === 2 ? "🥉" : null;

  return (
    <TouchableOpacity onPress={onPress} style={styles.card}>
      <View style={styles.cardTopRow}>
        {rankEmoji ? <Text style={styles.rankEmoji}>{rankEmoji}</Text> : <Text style={[styles.rankNum, { color: COLORS.textFaint }]}>{rank + 1}</Text>}
        <View style={{ flex: 1 }}>
          <Text style={styles.propName}>{property.name || "이름 없음"}</Text>
          {property.address ? <Text style={styles.propAddr}>{property.address}</Text> : null}
          {property.price ? <Text style={styles.propPrice}>{Number(property.price).toLocaleString()}원</Text> : null}
        </View>
        <View style={[styles.gradeBadge, { backgroundColor: grade.color + "22" }]}>
          <Text style={[styles.gradeBadgeText, { color: grade.color }]}>{grade.label.replace(/ [^\w]/u, "")}</Text>
        </View>
      </View>

      {/* 실거래 정보 */}
      {property.recentPrice ? (
        <View style={styles.txInfo}>
          <View style={styles.txInfoItem}>
            <Text style={styles.txInfoLabel}>최근 실거래</Text>
            <Text style={styles.txInfoValue}>{formatPrice(property.recentPrice)}</Text>
          </View>
          <View style={styles.txInfoItem}>
            <Text style={styles.txInfoLabel}>최고가</Text>
            <Text style={[styles.txInfoValue, { color: "#f59e0b" }]}>{formatPrice(property.highestPrice)}</Text>
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

// 레이더 차트 컴포넌트
function RadarChart({ properties, criteria }) {
  const activeCriteria = criteria.filter(c => !c.hidden);
  if (activeCriteria.length < 3 || properties.length === 0) return null;
  if (!loadCharts()) return null;

  const axes = activeCriteria.slice(0, 8); // 최대 8축
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
      <Text style={styles.chartTitle}>🎯 종합 비교</Text>
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
    return priceA - priceB;
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

  // 막대 차트 데이터
  const barData = propsWithTx.length >= 2 ? propsWithTx.slice(0, 4).flatMap((p, i) => [
    { value: (p.recentPrice || 0) / 10000, label: i === 0 ? (p.name || "").slice(0, 3) : "", frontColor: CHART_COLORS[i], spacing: 2 },
    { value: (p.highestPrice || 0) / 10000, frontColor: CHART_COLORS[i] + "88", spacing: 2 },
    { value: (p.regionAvg || 0) / 10000, frontColor: "#ffffff33", spacing: i < propsWithTx.length - 1 ? 20 : 0 },
  ]) : [];

  // 꺾은선 차트 데이터
  const hasLineData = propsWithTx.some(p => p.transactionHistory && p.transactionHistory.length > 1);
  let lineDataSets = [];
  if (hasLineData) {
    lineDataSets = propsWithTx.slice(0, 3).map((p, i) => {
      const txs = [...(p.transactionHistory || [])].reverse().slice(-12);
      return {
        data: txs.map((t, j) => ({
          value: t.dealAmount / 10000,
          label: j % 3 === 0 ? t.dealDate.slice(2, 7) : "",
        })),
        color: CHART_COLORS[i],
        name: p.name,
      };
    }).filter(ds => ds.data.length > 1);
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionTitle}>📈 점수 높은 순으로 정렬</Text>

      {sorted.map((p, i) => (
        <PropertyCard
          key={p.id} property={p} criteria={criteria} rank={i}
          onPress={() => onGoToScore(p.id)}
        />
      ))}

      {/* 가격 비교 막대 차트 */}
      {barData.length > 0 && loadCharts() && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>📊 가격 비교 (억원)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <BarChart
              data={barData}
              barWidth={18}
              noOfSections={5}
              barBorderRadius={4}
              yAxisTextStyle={{ color: COLORS.textFaint, fontSize: 10 }}
              xAxisLabelTextStyle={{ color: COLORS.textMuted, fontSize: 10 }}
              xAxisColor="rgba(255,255,255,0.08)"
              yAxisColor="rgba(255,255,255,0.08)"
              backgroundColor="transparent"
              hideRules
              width={Math.max(SCREEN_WIDTH - 100, propsWithTx.length * 100)}
              height={180}
            />
          </ScrollView>
          <View style={styles.legendRow}>
            {propsWithTx.slice(0, 4).map((p, i) => (
              <View key={i} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: CHART_COLORS[i] }]} />
                <Text style={styles.legendText}>{(p.name || "").slice(0, 6)}</Text>
              </View>
            ))}
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: "#ffffff33" }]} />
              <Text style={styles.legendText}>구 평균</Text>
            </View>
          </View>
          <Text style={styles.chartSubtext}>진한색: 최근 거래 / 연한색: 최고가 / 회색: 구 평균</Text>
        </View>
      )}

      {/* 시세 추이 꺾은선 차트 */}
      {lineDataSets.length > 0 && loadCharts() && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>📈 시세 추이 (억원)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <LineChart
              data={lineDataSets[0]?.data || []}
              data2={lineDataSets[1]?.data}
              data3={lineDataSets[2]?.data}
              color1={lineDataSets[0] ? CHART_COLORS[0] : "transparent"}
              color2={lineDataSets[1] ? CHART_COLORS[1] : "transparent"}
              color3={lineDataSets[2] ? CHART_COLORS[2] : "transparent"}
              dataPointsColor1={CHART_COLORS[0]}
              dataPointsColor2={CHART_COLORS[1]}
              dataPointsColor3={CHART_COLORS[2]}
              curved
              thickness={2}
              noOfSections={5}
              yAxisTextStyle={{ color: COLORS.textFaint, fontSize: 10 }}
              xAxisLabelTextStyle={{ color: COLORS.textFaint, fontSize: 9 }}
              xAxisColor="rgba(255,255,255,0.08)"
              yAxisColor="rgba(255,255,255,0.08)"
              backgroundColor="transparent"
              hideRules
              width={Math.max(SCREEN_WIDTH - 100, 250)}
              height={180}
            />
          </ScrollView>
          <View style={styles.legendRow}>
            {lineDataSets.map((ds, i) => (
              <View key={i} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: CHART_COLORS[i] }]} />
                <Text style={styles.legendText}>{(ds.name || "").slice(0, 6)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* 레이더 차트 */}
      <RadarChart properties={sorted} criteria={criteria} />

      {/* Detail comparison table */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>📋 항목별 상세 비교</Text>
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
                                {s}{isTop ? "★" : ""}
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
