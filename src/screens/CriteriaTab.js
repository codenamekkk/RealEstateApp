// src/screens/CriteriaTab.js
import React, { useState, useEffect } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, StyleSheet, Keyboard, Platform,
} from "react-native";
import { COLORS } from "../constants";

export default function CriteriaTab({ criteria, addCriteria, removeCriteria, toggleHidden, updateCriteria }) {
  const [newName, setNewName] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const hiddenCount = criteria.filter(c => c.hidden).length;

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">

      {/* Info banner */}
      <View style={styles.infoBanner}>
        <Text style={styles.infoText}>💡 중요도(1~5)가 높을수록 해당 항목이 총점에 더 큰 영향을 미칩니다.</Text>
      </View>

      {criteria.map(c => (
        <View key={c.id} style={[styles.card, c.hidden && styles.cardHidden]}>
          <View style={styles.cardTop}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {c.hidden && (
                  <View style={styles.hiddenBadge}><Text style={styles.hiddenBadgeText}>숨김</Text></View>
                )}
                <TextInput
                  value={c.name}
                  onChangeText={v => updateCriteria(c.id, "name", v)}
                  style={[styles.nameInput, c.hidden && { color: COLORS.textDimmer }]}
                />
              </View>
              <TextInput
                value={c.description}
                onChangeText={v => updateCriteria(c.id, "description", v)}
                placeholder="설명 추가..."
                placeholderTextColor={COLORS.textFaint}
                style={styles.descInput}
              />
            </View>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <TouchableOpacity onPress={() => toggleHidden(c.id)} style={[styles.hideBtn, c.hidden && styles.hideBtnActive]}>
                <Text style={[styles.hideBtnText, c.hidden && styles.hideBtnTextActive]}>
                  {c.hidden ? "👁 복원" : "🙈 숨김"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => removeCriteria(c.id)} style={styles.deleteBtn}>
                <Text style={styles.deleteBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          {!c.hidden && (
            <View style={styles.weightRow}>
              <Text style={styles.weightLabel}>중요도</Text>
              {[1, 2, 3, 4, 5].map(v => (
                <TouchableOpacity
                  key={v}
                  onPress={() => updateCriteria(c.id, "weight", v)}
                  style={[styles.weightBtn, c.weight === v && styles.weightBtnActive]}
                >
                  <Text style={[styles.weightBtnText, c.weight === v && styles.weightBtnTextActive]}>{v}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      ))}

      {hiddenCount > 0 && (
        <View style={styles.hiddenSummary}>
          <Text style={styles.hiddenSummaryText}>
            🙈 현재 <Text style={{ color: "#818cf8", fontWeight: "700" }}>{hiddenCount}개</Text> 항목이 숨겨져 있습니다. 점수 계산에서 제외됩니다.
          </Text>
        </View>
      )}

      {/* Add criteria */}
      <View style={styles.addRow}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={() => { addCriteria(newName); setNewName(""); }}
          placeholder="새 항목 이름 입력..."
          placeholderTextColor={COLORS.textFaint}
          style={styles.addInput}
          returnKeyType="done"
        />
        <TouchableOpacity
          onPress={() => { addCriteria(newName); setNewName(""); }}
          style={styles.addBtn}
        >
          <Text style={styles.addBtnText}>추가</Text>
        </TouchableOpacity>
      </View>
      <View style={{ height: 40 + keyboardHeight }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: COLORS.bg, padding: 16 },
  infoBanner:   { backgroundColor: "rgba(99,102,241,0.08)", borderWidth: 1, borderColor: "rgba(99,102,241,0.2)", borderRadius: 12, padding: 12, marginBottom: 16 },
  infoText:     { fontSize: 12, color: "#818cf8", lineHeight: 18 },
  card:         { backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 14, marginBottom: 10 },
  cardHidden:   { opacity: 0.55, borderStyle: "dashed" },
  cardTop:      { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  nameInput:    { color: COLORS.text, fontSize: 14, fontWeight: "700", paddingVertical: 0 },
  descInput:    { color: COLORS.textDimmer, fontSize: 12, marginTop: 2, paddingVertical: 0 },
  hiddenBadge:  { backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  hiddenBadgeText: { fontSize: 10, color: COLORS.textDimmer, fontWeight: "700" },
  hideBtn:      { borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  hideBtnActive: { borderColor: "rgba(99,102,241,0.3)", backgroundColor: "rgba(99,102,241,0.15)" },
  hideBtnText:  { color: COLORS.textDimmer, fontSize: 12 },
  hideBtnTextActive: { color: "#818cf8" },
  deleteBtn:    { borderWidth: 1, borderColor: "rgba(239,68,68,0.2)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  deleteBtnText: { color: "rgba(239,68,68,0.5)", fontSize: 13 },
  weightRow:    { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  weightLabel:  { fontSize: 12, color: COLORS.textFaint },
  weightBtn:    { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: "#2a2a3a", alignItems: "center", justifyContent: "center" },
  weightBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  weightBtnText: { fontSize: 12, fontWeight: "700", color: COLORS.textFaint },
  weightBtnTextActive: { color: "#fff" },
  hiddenSummary: { backgroundColor: "rgba(99,102,241,0.06)", borderWidth: 1, borderColor: "rgba(99,102,241,0.15)", borderRadius: 10, padding: 10, marginBottom: 14 },
  hiddenSummaryText: { fontSize: 12, color: COLORS.textFaint },
  addRow:   { flexDirection: "row", gap: 8 },
  addInput: { flex: 1, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: COLORS.text, fontSize: 14 },
  addBtn:   { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: COLORS.primary, justifyContent: "center" },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
