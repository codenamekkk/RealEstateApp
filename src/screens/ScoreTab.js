// src/screens/ScoreTab.js
import React, { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, StyleSheet,
} from "react-native";
import { COLORS, SCORE_LABELS, SCORE_COLORS, calcScore, getGrade } from "../constants";

function ScoreButton({ value, selected, onPress, color }) {
  return (
    <TouchableOpacity
      onPress={() => onPress(value)}
      style={[
        styles.scoreBtn,
        { borderColor: selected ? color : "#2a2a3a", backgroundColor: selected ? color : "transparent" },
      ]}
    >
      <Text style={{ color: selected ? "#fff" : "#888", fontWeight: "700", fontSize: 13 }}>{value}</Text>
    </TouchableOpacity>
  );
}

export default function ScoreTab({ criteria, properties, setScore, addProperty, removeProperty, updateProp }) {
  const [selectedPropId, setSelectedPropId] = useState(properties[0]?.id);
  const activeCriteria = criteria.filter(c => !c.hidden);
  const selectedProp   = properties.find(p => p.id === selectedPropId) || properties[0];

  function handleAddProperty() {
    const newId = addProperty();
    setSelectedPropId(newId);
  }

  function handleRemoveProperty(id) {
    const nextId = removeProperty(id, selectedPropId);
    setSelectedPropId(nextId);
  }

  const { percent } = selectedProp ? calcScore(selectedProp, activeCriteria) : { percent: 0 };
  const grade = getGrade(percent);

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">

      {/* Property tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.propRow}>
        {properties.map(p => (
          <TouchableOpacity
            key={p.id}
            onPress={() => setSelectedPropId(p.id)}
            style={[styles.propTab, selectedPropId === p.id && styles.propTabActive]}
          >
            <Text style={[styles.propTabText, selectedPropId === p.id && styles.propTabTextActive]}>
              {p.name || "이름없음"}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity onPress={handleAddProperty} style={styles.propTabAdd}>
          <Text style={{ color: COLORS.textFaint, fontSize: 12, fontWeight: "700" }}>+ 추가</Text>
        </TouchableOpacity>
      </ScrollView>

      {selectedProp && (
        <>
          {/* Property info */}
          <View style={styles.card}>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
              <TextInput
                value={selectedProp.name}
                onChangeText={v => updateProp(selectedProp.id, "name", v)}
                placeholder="매물 이름"
                placeholderTextColor={COLORS.textFaint}
                style={styles.nameInput}
              />
              {properties.length > 1 && (
                <TouchableOpacity onPress={() => handleRemoveProperty(selectedProp.id)} style={styles.deleteBtn}>
                  <Text style={{ color: COLORS.danger, fontSize: 13 }}>삭제</Text>
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              value={selectedProp.address}
              onChangeText={v => updateProp(selectedProp.id, "address", v)}
              placeholder="주소 (선택)"
              placeholderTextColor={COLORS.textFaint}
              style={styles.addressInput}
            />
          </View>

          {/* Score summary */}
          <View style={[styles.summaryCard, { borderColor: grade.color + "55", backgroundColor: grade.color + "11" }]}>
            <View>
              <Text style={styles.summaryLabel}>종합 점수</Text>
              <Text style={[styles.summaryPercent, { color: grade.color }]}>
                {percent}<Text style={{ fontSize: 18 }}>%</Text>
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[styles.gradeLabel, { color: grade.color }]}>{grade.label}</Text>
              <Text style={styles.gradeSubLabel}>
                {activeCriteria.filter(c => selectedProp.scores[c.id] > 0).length}/{activeCriteria.length}개 항목 입력
              </Text>
            </View>
          </View>

          {/* Criteria */}
          {activeCriteria.map(c => {
            const score = selectedProp.scores[c.id] || 0;
            const color = score > 0 ? SCORE_COLORS[score] : "#374151";
            return (
              <View key={c.id} style={[styles.criteriaCard, { borderColor: score > 0 ? color + "44" : COLORS.border }]}>
                <View style={styles.criteriaHeader}>
                  <View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={styles.criteriaName}>{c.name}</Text>
                      <View style={styles.weightBadge}>
                        <Text style={styles.weightBadgeText}>중요도 {c.weight}</Text>
                      </View>
                    </View>
                    {c.description ? <Text style={styles.criteriaDesc}>{c.description}</Text> : null}
                  </View>
                  {score > 0 && <Text style={[styles.scoreLabel, { color }]}>{SCORE_LABELS[score]}</Text>}
                </View>
                <View style={styles.scoreRow}>
                  {[1, 2, 3, 4, 5].map(v => (
                    <ScoreButton key={v} value={v} selected={score === v}
                      onPress={val => setScore(selectedProp.id, c.id, val)} color={SCORE_COLORS[v]} />
                  ))}
                </View>
              </View>
            );
          })}

          {/* Memo */}
          <TextInput
            value={selectedProp.memo}
            onChangeText={v => updateProp(selectedProp.id, "memo", v)}
            placeholder="메모 (장단점, 특이사항 등)"
            placeholderTextColor={COLORS.textFaint}
            multiline
            numberOfLines={3}
            style={styles.memoInput}
          />
        </>
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: COLORS.bg, padding: 16 },
  propRow:     { marginBottom: 14 },
  propTab:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.1)", marginRight: 8 },
  propTabActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primarySoft },
  propTabText:   { color: COLORS.textMuted, fontSize: 12, fontWeight: "700" },
  propTabTextActive: { color: "#818cf8" },
  propTabAdd:  { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.2)", borderStyle: "dashed" },
  card:        { backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 16, marginBottom: 16 },
  nameInput:   { flex: 1, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, color: COLORS.text, fontSize: 14, fontWeight: "700" },
  addressInput: { backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, color: COLORS.textMuted, fontSize: 12 },
  deleteBtn:   { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.08)" },
  summaryCard: { borderWidth: 1, borderRadius: 16, padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  summaryLabel: { fontSize: 12, color: COLORS.textFaint, marginBottom: 2 },
  summaryPercent: { fontSize: 38, fontWeight: "900", lineHeight: 42 },
  gradeLabel:   { fontSize: 15, fontWeight: "800" },
  gradeSubLabel: { fontSize: 11, color: COLORS.textFaint, marginTop: 4 },
  criteriaCard: { backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 },
  criteriaHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  criteriaName:   { fontSize: 14, fontWeight: "700", color: COLORS.text },
  criteriaDesc:   { fontSize: 11, color: COLORS.textDimmer, marginTop: 2 },
  scoreLabel:     { fontSize: 11, fontWeight: "700" },
  weightBadge:    { backgroundColor: COLORS.primarySoft, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1 },
  weightBadgeText: { color: "#818cf8", fontSize: 10, fontWeight: "700" },
  scoreRow:    { flexDirection: "row", gap: 8 },
  scoreBtn:    { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  memoInput:   { backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 14, color: COLORS.textMuted, fontSize: 13, marginTop: 6, textAlignVertical: "top" },
});
