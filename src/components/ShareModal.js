// src/components/ShareModal.js
import React, { useState } from "react";
import {
  Modal, View, Text, TouchableOpacity,
  TextInput, StyleSheet, Alert,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { COLORS } from "../constants";

export default function ShareModal({
  visible, onClose,
  myId, sharedWith, roomCode,
  onCreateRoom, onLeaveRoom, onJoinRoom,
}) {
  const [view, setView]       = useState("menu"); // menu|create|join
  const [targetId, setTargetId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const isSharing = !!sharedWith;

  async function handleCopy() {
    await Clipboard.setStringAsync(roomCode);
    Alert.alert("복사됨", "입장 코드가 클립보드에 복사됐어요.");
  }

  function handleClose() { setView("menu"); onClose(); }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={handleClose}>
        <TouchableOpacity activeOpacity={1} style={styles.sheet}>

          {/* Handle bar */}
          <View style={styles.handle} />

          {/* My ID */}
          <View style={styles.idSection}>
            <Text style={styles.idLabel}>내 아이디</Text>
            <View style={styles.idRow}>
              <Text style={styles.idValue}>{myId}</Text>
              <Text style={styles.idHint}>공유 시 상대에게 알려주세요</Text>
            </View>
          </View>

          {isSharing ? (
            /* ── Currently sharing ── */
            <View>
              <View style={styles.sharingBox}>
                <Text style={styles.sharingTitle}>🔗 {sharedWith}와 공유 중</Text>
                <Text style={styles.sharingCode}>입장 코드: <Text style={styles.codeValue}>{roomCode}</Text></Text>
              </View>
              <TouchableOpacity onPress={handleCopy} style={styles.copyBtn}>
                <Text style={styles.copyBtnText}>📋 입장 코드 복사</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { onLeaveRoom(); handleClose(); }} style={styles.leaveBtn}>
                <Text style={styles.leaveBtnText}>공유 종료</Text>
              </TouchableOpacity>
            </View>

          ) : view === "menu" ? (
            /* ── Menu ── */
            <View style={styles.menuContainer}>
              <TouchableOpacity onPress={() => setView("create")} style={styles.menuCard}>
                <Text style={styles.menuCardTitle}>✨ 새 공유 방 만들기</Text>
                <Text style={styles.menuCardSub}>내 분석 데이터를 상대방과 공유</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setView("join")} style={[styles.menuCard, styles.menuCardSecondary]}>
                <Text style={[styles.menuCardTitle, { color: COLORS.textMuted }]}>🚪 공유 방 입장하기</Text>
                <Text style={styles.menuCardSub}>입장 코드로 참여</Text>
              </TouchableOpacity>
            </View>

          ) : view === "create" ? (
            /* ── Create room ── */
            <View>
              <Text style={styles.inputLabel}>공유할 상대방의 아이디를 입력하세요</Text>
              <TextInput
                value={targetId}
                onChangeText={v => setTargetId(v.toUpperCase())}
                placeholder="상대방 아이디 (예: AB12CD)"
                placeholderTextColor={COLORS.textFaint}
                maxLength={6}
                autoCapitalize="characters"
                style={styles.codeInput}
              />
              <View style={styles.btnRow}>
                <TouchableOpacity onPress={() => setView("menu")} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { if (targetId.trim()) { onCreateRoom(targetId.trim()); handleClose(); setTargetId(""); } }}
                  style={[styles.confirmBtn, !targetId.trim() && styles.confirmBtnDisabled]}
                >
                  <Text style={styles.confirmBtnText}>공유 시작</Text>
                </TouchableOpacity>
              </View>
            </View>

          ) : view === "join" ? (
            /* ── Join room ── */
            <View>
              <Text style={styles.inputLabel}>상대방에게 받은 입장 코드를 입력하세요</Text>
              <TextInput
                value={joinCode}
                onChangeText={v => setJoinCode(v.toUpperCase())}
                placeholder="입장 코드 (예: XY9Z3A)"
                placeholderTextColor={COLORS.textFaint}
                maxLength={6}
                autoCapitalize="characters"
                style={styles.codeInput}
              />
              <View style={styles.btnRow}>
                <TouchableOpacity onPress={() => setView("menu")} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    if (!joinCode.trim()) return;
                    const ok = await onJoinRoom(joinCode.trim());
                    if (ok) { handleClose(); setJoinCode(""); }
                    else Alert.alert("오류", "입장 코드를 찾을 수 없습니다. 다시 확인해주세요.");
                  }}
                  style={[styles.confirmBtn, !joinCode.trim() && styles.confirmBtnDisabled]}
                >
                  <Text style={styles.confirmBtnText}>입장</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay:       { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet:         { backgroundColor: "#16162a", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  handle:        { width: 36, height: 4, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 2, alignSelf: "center", marginBottom: 20 },
  idSection:     { marginBottom: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)" },
  idLabel:       { fontSize: 10, color: COLORS.textFaint, marginBottom: 6 },
  idRow:         { flexDirection: "row", alignItems: "center", gap: 10 },
  idValue:       { fontSize: 18, fontWeight: "900", color: COLORS.text, letterSpacing: 3, backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  idHint:        { fontSize: 10, color: COLORS.textDimmer, flex: 1, lineHeight: 14 },
  sharingBox:    { backgroundColor: "rgba(99,102,241,0.1)", borderWidth: 1, borderColor: "rgba(99,102,241,0.25)", borderRadius: 12, padding: 14, marginBottom: 12 },
  sharingTitle:  { fontSize: 14, fontWeight: "700", color: "#818cf8", marginBottom: 4 },
  sharingCode:   { fontSize: 12, color: COLORS.textFaint },
  codeValue:     { color: COLORS.textMuted, fontWeight: "700", letterSpacing: 2 },
  copyBtn:       { backgroundColor: "rgba(99,102,241,0.1)", borderWidth: 1, borderColor: "rgba(99,102,241,0.3)", borderRadius: 10, padding: 12, alignItems: "center", marginBottom: 8 },
  copyBtnText:   { color: "#818cf8", fontWeight: "700", fontSize: 14 },
  leaveBtn:      { backgroundColor: "rgba(239,68,68,0.08)", borderWidth: 1, borderColor: "rgba(239,68,68,0.3)", borderRadius: 10, padding: 12, alignItems: "center" },
  leaveBtnText:  { color: COLORS.danger, fontWeight: "700", fontSize: 14 },
  menuContainer: { gap: 10 },
  menuCard:      { backgroundColor: "rgba(99,102,241,0.08)", borderWidth: 1, borderColor: "rgba(99,102,241,0.3)", borderRadius: 12, padding: 14 },
  menuCardSecondary: { backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" },
  menuCardTitle: { fontSize: 14, fontWeight: "700", color: "#818cf8", marginBottom: 4 },
  menuCardSub:   { fontSize: 12, color: COLORS.textFaint },
  inputLabel:    { fontSize: 13, color: COLORS.textMuted, marginBottom: 10 },
  codeInput:     { backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.text, fontSize: 18, fontWeight: "800", letterSpacing: 3, marginBottom: 14 },
  btnRow:        { flexDirection: "row", gap: 10 },
  cancelBtn:     { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", alignItems: "center" },
  cancelBtnText: { color: COLORS.textFaint, fontSize: 13 },
  confirmBtn:    { flex: 2, padding: 12, borderRadius: 10, backgroundColor: COLORS.primary, alignItems: "center" },
  confirmBtnDisabled: { backgroundColor: "#2a2a3a" },
  confirmBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
