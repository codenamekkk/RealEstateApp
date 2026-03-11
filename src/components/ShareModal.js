// src/components/ShareModal.js
import React, { useState, useRef, useEffect } from "react";
import {
  Modal, View, Text, TouchableOpacity,
  TextInput, StyleSheet, Alert, ScrollView,
  Animated, PanResponder, Dimensions, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { COLORS } from "../constants";

const SCREEN_HEIGHT = Dimensions.get("window").height;
const DISMISS_THRESHOLD = 100;

const SHARE_TABS = [
  { key: "request", label: "공유 신청" },
  { key: "sharing", label: "공유함" },
  { key: "receiving", label: "공유 받음" },
];

export default function ShareModal({
  visible, onClose,
  myId, nickname, onUpdateNickname,
  incomingRequests, sharingList, receivingList,
  onSendRequest, onRespondRequest, onRemoveShare,
  onViewSharedData, onRefresh,
}) {
  const [activeTab, setActiveTab] = useState("request");
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState("");

  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      if (onRefresh) onRefresh();
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }).start();
    } else {
      translateY.setValue(SCREEN_HEIGHT);
    }
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_THRESHOLD || g.vy > 0.5) {
          Animated.timing(translateY, {
            toValue: SCREEN_HEIGHT,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            handleClose();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 8,
          }).start();
        }
      },
    })
  ).current;

  function handleClose() {
    setTargetId("");
    setEditingNickname(false);
    onClose();
  }

  async function handleSendRequest() {
    const id = targetId.trim();
    if (!id) return;
    setLoading(true);
    const result = await onSendRequest(id);
    setLoading(false);
    if (result.ok) {
      Alert.alert("신청 완료", `${result.targetNickname}님에게 공유 신청을 보냈습니다.`);
      setTargetId("");
    } else {
      Alert.alert("오류", result.error);
    }
  }

  async function handleApprove(requestId) {
    await onRespondRequest(requestId, "approved");
  }

  async function handleReject(requestId) {
    Alert.alert("거절", "공유 신청을 거절하시겠습니까?", [
      { text: "취소", style: "cancel" },
      { text: "거절", style: "destructive", onPress: () => onRespondRequest(requestId, "rejected") },
    ]);
  }

  function handleRemoveShare(requestId, name) {
    Alert.alert("공유 해제", `${name}님과의 공유를 해제하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      { text: "해제", style: "destructive", onPress: () => onRemoveShare(requestId) },
    ]);
  }

  function handleSaveNickname() {
    const trimmed = nicknameInput.trim();
    if (trimmed && trimmed !== nickname) {
      onUpdateNickname(trimmed);
    }
    setEditingNickname(false);
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
      >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={handleClose}>
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity activeOpacity={1}>

            {/* Handle bar */}
            <View style={styles.handleArea}>
              <View style={styles.handle} />
            </View>

            {/* My info */}
            <View style={styles.idSection}>
              <View style={styles.idRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.idLabel}>내 아이디</Text>
                  <Text style={styles.idValue}>{myId || "..."}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.idLabel}>닉네임</Text>
                  {editingNickname ? (
                    <View style={styles.nicknameEditRow}>
                      <TextInput
                        value={nicknameInput}
                        onChangeText={setNicknameInput}
                        style={styles.nicknameInput}
                        maxLength={12}
                        autoFocus
                        onSubmitEditing={handleSaveNickname}
                      />
                      <TouchableOpacity onPress={handleSaveNickname} style={styles.nicknameSaveBtn}>
                        <Text style={styles.nicknameSaveBtnText}>저장</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => { setNicknameInput(nickname); setEditingNickname(true); }}
                      style={styles.nicknameRow}
                    >
                      <Text style={styles.nicknameValue}>{nickname}</Text>
                      <Text style={styles.nicknameEdit}>수정</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <Text style={styles.idHint}>공유 신청 시 상대에게 내 아이디를 알려주세요</Text>
            </View>

            {/* Tab bar */}
            <View style={styles.tabBar}>
              {SHARE_TABS.map(tab => (
                <TouchableOpacity
                  key={tab.key}
                  onPress={() => setActiveTab(tab.key)}
                  style={[styles.tab, activeTab === tab.key && styles.tabActive]}
                >
                  <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                    {tab.label}
                    {tab.key === "request" && incomingRequests.length > 0 && (
                      ` (${incomingRequests.length})`
                    )}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Tab content */}
            <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">

              {activeTab === "request" && (
                <View>
                  {/* Send request */}
                  <Text style={styles.sectionTitle}>공유 신청 보내기</Text>
                  <Text style={styles.sectionSub}>상대방의 아이디를 입력하여 공유를 신청하세요</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      value={targetId}
                      onChangeText={v => setTargetId(v.toUpperCase())}
                      placeholder="상대방 아이디 (예: AB12CD)"
                      placeholderTextColor={COLORS.textFaint}
                      maxLength={6}
                      autoCapitalize="characters"
                      style={[styles.codeInput, { flex: 1 }]}
                    />
                    <TouchableOpacity
                      onPress={handleSendRequest}
                      disabled={!targetId.trim() || loading}
                      style={[styles.sendBtn, !targetId.trim() && styles.sendBtnDisabled]}
                    >
                      {loading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.sendBtnText}>신청</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Incoming requests */}
                  {incomingRequests.length > 0 && (
                    <View style={styles.listSection}>
                      <Text style={styles.sectionTitle}>받은 공유 신청</Text>
                      {incomingRequests.map(req => (
                        <View key={req.id || req.from_id} style={styles.requestCard}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.cardName}>{req.from_nickname || req.from_id}</Text>
                            <Text style={styles.cardId}>ID: {req.from_id}</Text>
                          </View>
                          <View style={styles.requestActions}>
                            <TouchableOpacity
                              onPress={() => handleApprove(req.id)}
                              style={styles.approveBtn}
                            >
                              <Text style={styles.approveBtnText}>승인</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => handleReject(req.id)}
                              style={styles.rejectBtn}
                            >
                              <Text style={styles.rejectBtnText}>거절</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {activeTab === "sharing" && (
                <View>
                  <Text style={styles.sectionTitle}>내 데이터를 보는 사람들</Text>
                  <Text style={styles.sectionSub}>이 사람들이 내 매물 분석 데이터를 볼 수 있습니다</Text>
                  {sharingList.length === 0 ? (
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyText}>아직 공유하는 사람이 없습니다</Text>
                      <Text style={styles.emptyHint}>상대방이 공유 신청을 보내면 여기에 표시됩니다</Text>
                    </View>
                  ) : (
                    sharingList.map(item => (
                      <View key={item.id} style={styles.shareCard}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.cardName}>{item.from_nickname || item.from_id}</Text>
                          <Text style={styles.cardId}>ID: {item.from_id}</Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleRemoveShare(item.id, item.from_nickname || item.from_id)}
                          style={styles.removeBtn}
                        >
                          <Text style={styles.removeBtnText}>해제</Text>
                        </TouchableOpacity>
                      </View>
                    ))
                  )}
                </View>
              )}

              {activeTab === "receiving" && (
                <View>
                  <Text style={styles.sectionTitle}>내가 보는 데이터</Text>
                  <Text style={styles.sectionSub}>터치하면 상대방의 매물 분석을 볼 수 있습니다</Text>
                  {receivingList.length === 0 ? (
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyText}>아직 공유 받는 데이터가 없습니다</Text>
                      <Text style={styles.emptyHint}>공유 신청 탭에서 상대방에게 신청하세요</Text>
                    </View>
                  ) : (
                    receivingList.map(item => (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.shareCardClickable}
                        onPress={() => {
                          onViewSharedData(item.to_id, item.to_nickname || item.to_id);
                          handleClose();
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.cardName}>{item.to_nickname || item.to_id}</Text>
                          <Text style={styles.cardId}>ID: {item.to_id}</Text>
                        </View>
                        <View style={styles.viewRow}>
                          <Text style={styles.viewText}>보기 →</Text>
                          <TouchableOpacity
                            onPress={(e) => {
                              e.stopPropagation?.();
                              handleRemoveShare(item.id, item.to_nickname || item.to_id);
                            }}
                            style={styles.removeBtn}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          >
                            <Text style={styles.removeBtnText}>해제</Text>
                          </TouchableOpacity>
                        </View>
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              )}

            </ScrollView>
          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#16162a", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: SCREEN_HEIGHT * 0.85 },
  handleArea: { alignItems: "center", paddingVertical: 8, marginTop: -8, marginBottom: 8 },
  handle: { width: 36, height: 4, backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 2 },

  // ID section
  idSection: { marginBottom: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)" },
  idRow: { flexDirection: "row", gap: 14, marginBottom: 8 },
  idLabel: { fontSize: 10, color: COLORS.textFaint, marginBottom: 4 },
  idValue: { fontSize: 16, fontWeight: "900", color: COLORS.text, letterSpacing: 2.5, backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, alignSelf: "flex-start" },
  idHint: { fontSize: 10, color: COLORS.textDimmer, lineHeight: 14 },

  // Nickname
  nicknameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  nicknameValue: { fontSize: 14, fontWeight: "700", color: COLORS.text },
  nicknameEdit: { fontSize: 10, color: COLORS.primary, fontWeight: "600" },
  nicknameEditRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  nicknameInput: { flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, color: COLORS.text, fontSize: 13 },
  nicknameSaveBtn: { backgroundColor: COLORS.primary, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  nicknameSaveBtnText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  // Tab bar
  tabBar: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)", marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: COLORS.primary },
  tabText: { fontSize: 12, fontWeight: "700", color: COLORS.textFaint },
  tabTextActive: { color: "#818cf8" },

  // Content
  content: { maxHeight: SCREEN_HEIGHT * 0.45 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: COLORS.text, marginBottom: 4 },
  sectionSub: { fontSize: 11, color: COLORS.textFaint, marginBottom: 14 },

  // Input
  inputRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  codeInput: { backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, color: COLORS.text, fontSize: 16, fontWeight: "800", letterSpacing: 2.5 },
  sendBtn: { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 20, justifyContent: "center", alignItems: "center" },
  sendBtnDisabled: { backgroundColor: "#2a2a3a" },
  sendBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  // Lists
  listSection: { marginTop: 4 },
  requestCard: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 12, marginBottom: 8 },
  shareCard: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 12, marginBottom: 8 },
  shareCardClickable: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(99,102,241,0.06)", borderWidth: 1, borderColor: "rgba(99,102,241,0.2)", borderRadius: 12, padding: 12, marginBottom: 8 },
  cardName: { fontSize: 14, fontWeight: "700", color: COLORS.text, marginBottom: 2 },
  cardId: { fontSize: 10, color: COLORS.textFaint },

  // Actions
  requestActions: { flexDirection: "row", gap: 6 },
  approveBtn: { backgroundColor: "rgba(34,197,94,0.15)", borderWidth: 1, borderColor: "rgba(34,197,94,0.3)", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  approveBtnText: { color: "#22c55e", fontWeight: "700", fontSize: 12 },
  rejectBtn: { backgroundColor: "rgba(239,68,68,0.08)", borderWidth: 1, borderColor: "rgba(239,68,68,0.3)", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  rejectBtnText: { color: COLORS.danger, fontWeight: "700", fontSize: 12 },
  removeBtn: { backgroundColor: "rgba(239,68,68,0.08)", borderWidth: 1, borderColor: "rgba(239,68,68,0.25)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  removeBtnText: { color: COLORS.danger, fontWeight: "600", fontSize: 11 },
  viewRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  viewText: { color: "#818cf8", fontWeight: "700", fontSize: 12 },

  // Empty state
  emptyBox: { backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", borderRadius: 12, padding: 24, alignItems: "center" },
  emptyText: { fontSize: 13, color: COLORS.textMuted, marginBottom: 4 },
  emptyHint: { fontSize: 11, color: COLORS.textFaint },
});
