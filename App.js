// App.js  ─ 앱 진입점
import React, { useState, useRef, useCallback } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import PagerView from "react-native-pager-view";
import { COLORS } from "./src/constants";
import useAppState from "./src/hooks/useAppState";
import ScoreTab    from "./src/screens/ScoreTab";
import CompareTab  from "./src/screens/CompareTab";
import CriteriaTab from "./src/screens/CriteriaTab";
import ShareModal  from "./src/components/ShareModal";

const TABS = [
  { key: "score",   label: "📊 점수 입력" },
  { key: "compare", label: "🔍 매물 비교" },
  { key: "criteria",label: "⚙️ 평가 항목" },
];

export default function App() {
  const [activeTab,     setActiveTab]     = useState(0);
  const [shareVisible,  setShareVisible]  = useState(false);
  const pagerRef = useRef(null);

  const state = useAppState();
  const {
    myId, criteria, properties,
    isSharing, sharedWith, roomCode, syncStatus, lastSyncTime,
    handleCreateRoom, handleJoinRoom, handleLeaveRoom,
    setScore, addProperty, removeProperty, updateProp,
    addCriteria, removeCriteria, toggleHidden, updateCriteria,
  } = state;

  const syncDot = syncStatus === "syncing" ? "#eab308" : "#10b981";

  const handleTabPress = useCallback((index) => {
    setActiveTab(index);
    pagerRef.current?.setPage(index);
  }, []);

  const handlePageSelected = useCallback((e) => {
    setActiveTab(e.nativeEvent.position);
  }, []);

  return (
    <SafeAreaProvider>
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.logoBox}>
            <Text style={{ fontSize: 18 }}>🏠</Text>
          </View>
          <View>
            <View style={styles.titleRow}>
              <Text style={styles.title}>부동산 매수 평가</Text>
              {isSharing && (
                <View style={styles.sharingBadge}>
                  <View style={[styles.syncDot, { backgroundColor: syncDot }]} />
                  <Text style={styles.sharingBadgeText}>{sharedWith}와 공유 중</Text>
                </View>
              )}
            </View>
            <Text style={styles.subtitle}>
              {isSharing
                ? `코드: ${roomCode} · ${syncStatus === "syncing" ? "동기화 중..." : lastSyncTime ? `${lastSyncTime.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} 동기화됨` : "대기 중"}`
                : "데이터 기반 의사결정 도구"}
            </Text>
          </View>
        </View>

        {/* Share button */}
        <TouchableOpacity
          onPress={() => setShareVisible(true)}
          style={[styles.shareBtn, isSharing && styles.shareBtnActive]}
        >
          <Text style={[styles.shareBtnText, isSharing && styles.shareBtnTextActive]}>
            {isSharing ? "🔗" : "👥"} 공유
          </Text>
        </TouchableOpacity>
      </View>

      {/* Sharing banner */}
      {isSharing && (
        <View style={styles.sharingBanner}>
          <Text style={styles.sharingBannerText}>
            🔗 <Text style={{ fontWeight: "700" }}>{sharedWith}</Text>와 실시간으로 매물을 함께 분석 중입니다.
          </Text>
        </View>
      )}

      {/* ── Tab bar ── */}
      <View style={styles.tabBar}>
        {TABS.map((tab, index) => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => handleTabPress(index)}
            style={[styles.tab, activeTab === index && styles.tabActive]}
          >
            <Text style={[styles.tabText, activeTab === index && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Swipeable Screens ── */}
      <PagerView
        ref={pagerRef}
        style={{ flex: 1 }}
        initialPage={0}
        onPageSelected={handlePageSelected}
      >
        <View key="score" style={{ flex: 1 }}>
          <ScoreTab
            criteria={criteria} properties={properties}
            setScore={setScore}
            addProperty={addProperty}
            removeProperty={removeProperty}
            updateProp={updateProp}
          />
        </View>
        <View key="compare" style={{ flex: 1 }}>
          <CompareTab
            criteria={criteria} properties={properties}
            onGoToScore={(propId) => {
              handleTabPress(0);
            }}
          />
        </View>
        <View key="criteria" style={{ flex: 1 }}>
          <CriteriaTab
            criteria={criteria}
            addCriteria={addCriteria}
            removeCriteria={removeCriteria}
            toggleHidden={toggleHidden}
            updateCriteria={updateCriteria}
          />
        </View>
      </PagerView>

      {/* ── Share Modal ── */}
      <ShareModal
        visible={shareVisible}
        onClose={() => setShareVisible(false)}
        myId={myId}
        sharedWith={sharedWith}
        roomCode={roomCode}
        onCreateRoom={handleCreateRoom}
        onLeaveRoom={handleLeaveRoom}
        onJoinRoom={handleJoinRoom}
      />
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: COLORS.bg },
  header:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  headerLeft:     { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  logoBox:        { width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center" },
  titleRow:       { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  title:          { fontSize: 15, fontWeight: "800", color: COLORS.text, letterSpacing: -0.3 },
  subtitle:       { fontSize: 10, color: COLORS.textFaint, marginTop: 1 },
  sharingBadge:   { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(99,102,241,0.15)", borderWidth: 1, borderColor: "rgba(99,102,241,0.3)", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  syncDot:        { width: 6, height: 6, borderRadius: 3 },
  sharingBadgeText: { fontSize: 10, fontWeight: "700", color: "#818cf8" },
  shareBtn:       { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.05)" },
  shareBtnActive: { borderColor: "rgba(99,102,241,0.5)", backgroundColor: "rgba(99,102,241,0.15)" },
  shareBtnText:   { fontSize: 12, fontWeight: "700", color: COLORS.textMuted },
  shareBtnTextActive: { color: "#818cf8" },
  sharingBanner:  { backgroundColor: "rgba(99,102,241,0.1)", borderBottomWidth: 1, borderBottomColor: "rgba(99,102,241,0.2)", paddingHorizontal: 16, paddingVertical: 8 },
  sharingBannerText: { fontSize: 12, color: "#818cf8" },
  tabBar:         { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  tab:            { flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive:      { borderBottomColor: COLORS.primary },
  tabText:        { fontSize: 11, fontWeight: "700", color: COLORS.textFaint },
  tabTextActive:  { color: "#818cf8" },
});
