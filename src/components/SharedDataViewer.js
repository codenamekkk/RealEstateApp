// src/components/SharedDataViewer.js
import React, { useState, useEffect } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS, calcScore, getGrade, getScoreColor } from "../constants";

export default function SharedDataViewer({ targetId, targetNickname, fetchSharedData, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null); // { nickname, criteria, properties }

  useEffect(() => {
    loadData();
  }, [targetId]);

  async function loadData() {
    setLoading(true);
    setError(null);
    const result = await fetchSharedData(targetId);
    if (result) {
      setData(result);
    } else {
      setError("데이터를 불러올 수 없습니다");
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <Header nickname={targetNickname} onClose={onClose} onRefresh={loadData} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>데이터 불러오는 중...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <Header nickname={targetNickname} onClose={onClose} onRefresh={loadData} />
        <View style={styles.center}>
          <Text style={styles.errorIcon}>😢</Text>
          <Text style={styles.errorText}>{error || "데이터를 불러올 수 없습니다"}</Text>
          <TouchableOpacity onPress={loadData} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const { criteria, properties } = data;
  const activeCriteria = criteria.filter(c => !c.hidden);
  const sorted = [...properties].sort((a, b) =>
    calcScore(b, activeCriteria).percent - calcScore(a, activeCriteria).percent
  );

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <Header nickname={data.nickname || targetNickname} onClose={onClose} onRefresh={loadData} />

      <ScrollView style={styles.scroll}>
        {/* Read-only badge */}
        <View style={styles.readOnlyBadge}>
          <Text style={styles.readOnlyText}>👁️ 읽기 전용 — {data.nickname || targetNickname}님의 데이터</Text>
        </View>

        {properties.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>등록된 매물이 없습니다</Text>
          </View>
        ) : (
          <>
            {/* Ranking cards */}
            <Text style={styles.sectionTitle}>📈 점수 높은 순으로 정렬</Text>
            {sorted.map((p, i) => {
              const { percent } = calcScore(p, activeCriteria);
              const grade = getGrade(percent);
              const rankEmoji = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;

              return (
                <View key={p.id} style={styles.card}>
                  <View style={styles.cardTopRow}>
                    {rankEmoji
                      ? <Text style={styles.rankEmoji}>{rankEmoji}</Text>
                      : <Text style={styles.rankNum}>{i + 1}</Text>}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.propName}>{p.name || "이름 없음"}</Text>
                      {p.address ? <Text style={styles.propAddr}>{p.address}</Text> : null}
                    </View>
                    <View style={[styles.gradeBadge, { backgroundColor: grade.color + "22" }]}>
                      <Text style={[styles.gradeBadgeText, { color: grade.color }]}>
                        {grade.label.replace(/ [^\w]/u, "")}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.barBg}>
                    <View style={[styles.barFill, { width: `${percent}%`, backgroundColor: grade.color }]} />
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                    <Text style={styles.subText}>
                      {activeCriteria.filter(c => p.scores[c.id] > 0).length}/{activeCriteria.length} 항목
                    </Text>
                    <Text style={[styles.percentText, { color: grade.color }]}>{percent}%</Text>
                  </View>
                </View>
              );
            })}

            {/* Detail table */}
            {sorted.length >= 2 && (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 24 }]}>📋 항목별 상세 비교</Text>
                <View style={styles.table}>
                  <View style={[styles.tableRow, styles.tableHeader]}>
                    <Text style={[styles.tableCell, styles.tableLabelCell, { color: COLORS.textFaint }]}>항목</Text>
                    {sorted.map(p => (
                      <Text key={p.id} style={[styles.tableCell, styles.tableScoreCell, { color: "#818cf8" }]}>
                        {(p.name || "").length > 4 ? (p.name || "").slice(0, 4) + ".." : p.name}
                      </Text>
                    ))}
                  </View>

                  {activeCriteria.map(c => {
                    const scores = sorted.map(p => p.scores[c.id] || 0);
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
                                ? <Text style={{ fontSize: 15, fontWeight: "800", color: isTop ? getScoreColor(s) : "#64748b" }}>
                                    {s}{isTop ? "★" : ""}
                                  </Text>
                                : <Text style={{ color: "#374151", fontSize: 12 }}>-</Text>}
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </View>
              </>
            )}
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ nickname, onClose, onRefresh }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onClose} style={styles.backBtn}>
        <Text style={styles.backBtnText}>← 돌아가기</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{nickname}의 분석</Text>
      <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn}>
        <Text style={styles.refreshBtnText}>새로고침</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  loadingText: { color: COLORS.textFaint, marginTop: 12, fontSize: 13 },
  errorIcon: { fontSize: 40, marginBottom: 12 },
  errorText: { color: COLORS.textMuted, fontSize: 14, marginBottom: 16 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: COLORS.primary },
  retryBtnText: { color: "#fff", fontWeight: "700" },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  backBtn: { paddingVertical: 4 },
  backBtnText: { color: "#818cf8", fontSize: 13, fontWeight: "700" },
  headerTitle: { fontSize: 15, fontWeight: "800", color: COLORS.text },
  refreshBtn: { paddingVertical: 4 },
  refreshBtnText: { color: COLORS.textFaint, fontSize: 12, fontWeight: "600" },

  scroll: { flex: 1, padding: 16 },
  readOnlyBadge: { backgroundColor: "rgba(99,102,241,0.1)", borderWidth: 1, borderColor: "rgba(99,102,241,0.25)", borderRadius: 10, padding: 10, marginBottom: 16, alignItems: "center" },
  readOnlyText: { color: "#818cf8", fontSize: 12, fontWeight: "600" },

  emptyBox: { backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 30, alignItems: "center" },
  emptyText: { color: COLORS.textFaint, fontSize: 13 },

  sectionTitle: { fontSize: 13, fontWeight: "700", color: COLORS.textMuted, marginBottom: 12 },
  card: { backgroundColor: COLORS.surfaceAlt, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 16, padding: 16, marginBottom: 10 },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  rankEmoji: { fontSize: 22, width: 32, textAlign: "center" },
  rankNum: { fontSize: 16, fontWeight: "900", width: 32, textAlign: "center", color: COLORS.textFaint },
  propName: { fontSize: 15, fontWeight: "700", color: COLORS.text },
  propAddr: { fontSize: 12, color: COLORS.textFaint, marginTop: 2 },
  gradeBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  gradeBadgeText: { fontSize: 11, fontWeight: "700" },
  barBg: { height: 6, backgroundColor: "#1e1e2e", borderRadius: 10, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 10 },
  subText: { fontSize: 11, color: COLORS.textFaint },
  percentText: { fontSize: 16, fontWeight: "800" },

  table: { backgroundColor: "rgba(255,255,255,0.02)", borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, overflow: "hidden" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)", paddingHorizontal: 14, paddingVertical: 10, alignItems: "center" },
  tableHeader: { backgroundColor: "rgba(255,255,255,0.05)" },
  tableCell: { alignItems: "center", justifyContent: "center" },
  tableLabelCell: { flex: 1 },
  tableScoreCell: { width: 60, alignItems: "center" },
});
