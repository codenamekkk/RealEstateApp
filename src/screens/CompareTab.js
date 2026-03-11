// src/screens/CompareTab.js
import React from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { COLORS, SCORE_COLORS, calcScore, getGrade } from "../constants";

function PropertyCard({ property, criteria, onPress, rank }) {
  const activeCriteria = criteria.filter(c => !c.hidden);
  const { percent, totalScore, max } = calcScore(property, activeCriteria);
  const grade = getGrade(percent);
  const rankEmoji = rank === 0 ? "🥇" : rank === 1 ? "🥈" : rank === 2 ? "🥉" : null;

  return (
    <TouchableOpacity onPress={onPress} style={styles.card}>
      {/* Rank + grade badge */}
      <View style={styles.cardTopRow}>
        {rankEmoji ? <Text style={styles.rankEmoji}>{rankEmoji}</Text> : <Text style={[styles.rankNum, { color: COLORS.textFaint }]}>{rank + 1}</Text>}
        <View style={{ flex: 1 }}>
          <Text style={styles.propName}>{property.name || "이름 없음"}</Text>
          {property.address ? <Text style={styles.propAddr}>{property.address}</Text> : null}
        </View>
        <View style={[styles.gradeBadge, { backgroundColor: grade.color + "22" }]}>
          <Text style={[styles.gradeBadgeText, { color: grade.color }]}>{grade.label.replace(/ [^\w]/u, "")}</Text>
        </View>
      </View>

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

export default function CompareTab({ criteria, properties, onGoToScore }) {
  const activeCriteria = criteria.filter(c => !c.hidden);
  const sorted = [...properties].sort((a, b) =>
    calcScore(b, activeCriteria).percent - calcScore(a, activeCriteria).percent
  );

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

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionTitle}>📈 점수 높은 순으로 정렬</Text>

      {sorted.map((p, i) => (
        <PropertyCard
          key={p.id} property={p} criteria={criteria} rank={i}
          onPress={() => onGoToScore(p.id)}
        />
      ))}

      {/* Detail comparison table */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>📋 항목별 상세 비교</Text>
      <View style={styles.table}>
        {/* Header */}
        <View style={[styles.tableRow, styles.tableHeader]}>
          <Text style={[styles.tableCell, styles.tableLabelCell, { color: COLORS.textFaint }]}>항목</Text>
          {sorted.map(p => (
            <Text key={p.id} style={[styles.tableCell, styles.tableScoreCell, { color: "#818cf8" }]}>
              {(p.name || "").length > 4 ? (p.name || "").slice(0, 4) + ".." : p.name}
            </Text>
          ))}
        </View>

        {activeCriteria.map(c => {
          const scores  = sorted.map(p => p.scores[c.id] || 0);
          const maxScore = Math.max(...scores);
          return (
            <View key={c.id} style={styles.tableRow}>
              <View style={[styles.tableCell, styles.tableLabelCell]}>
                <Text style={{ fontSize: 12, color: COLORS.textMuted }}>{c.name}</Text>
                <Text style={{ fontSize: 10, color: COLORS.textFaint }}>중요도 {c.weight}</Text>
              </View>
              {scores.map((s, i) => {
                const isTop = s === maxScore && scores.filter(x => x === maxScore).length === 1 && maxScore > 0;
                return (
                  <View key={i} style={[styles.tableCell, styles.tableScoreCell]}>
                    {s > 0
                      ? <Text style={{ fontSize: 15, fontWeight: "800", color: isTop ? SCORE_COLORS[s] : "#64748b" }}>
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
  gradeBadge:      { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  gradeBadgeText:  { fontSize: 11, fontWeight: "700" },
  barBg:           { height: 6, backgroundColor: "#1e1e2e", borderRadius: 10, overflow: "hidden" },
  barFill:         { height: "100%", borderRadius: 10 },
  subText:         { fontSize: 11, color: COLORS.textFaint },
  percentText:     { fontSize: 16, fontWeight: "800" },
  table:           { backgroundColor: "rgba(255,255,255,0.02)", borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, overflow: "hidden" },
  tableRow:        { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)", paddingHorizontal: 14, paddingVertical: 10, alignItems: "center" },
  tableHeader:     { backgroundColor: "rgba(255,255,255,0.05)" },
  tableCell:       { alignItems: "center", justifyContent: "center" },
  tableLabelCell:  { flex: 1 },
  tableScoreCell:  { width: 60, alignItems: "center" },
});
