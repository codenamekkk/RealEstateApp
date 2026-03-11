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
import SharedDataViewer from "./src/components/SharedDataViewer";

class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error, info) { console.error("앱 오류:", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaProvider>
          <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: "center", justifyContent: "center", padding: 20 }}>
            <Text style={{ fontSize: 18, color: COLORS.text, fontWeight: "700", marginBottom: 10 }}>오류가 발생했습니다</Text>
            <Text style={{ fontSize: 13, color: COLORS.textMuted, textAlign: "center", marginBottom: 20 }}>앱을 다시 시작해 주세요</Text>
            <TouchableOpacity
              onPress={() => this.setState({ hasError: false })}
              style={{ backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaProvider>
      );
    }
    return this.props.children;
  }
}

const TABS = [
  { key: "score",   label: "📊 점수 입력" },
  { key: "compare", label: "🔍 매물 비교" },
  { key: "criteria",label: "⚙️ 평가 항목" },
];

export default function AppWithBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [activeTab,     setActiveTab]     = useState(0);
  const [shareVisible,  setShareVisible]  = useState(false);
  const [viewingShared, setViewingShared] = useState(null); // { userId, nickname }
  const pagerRef = useRef(null);

  const state = useAppState();
  const {
    myId, nickname, updateNickname,
    criteria, properties,
    incomingRequests, sharingList, receivingList,
    sendShareRequest, respondShareRequest, removeShare,
    fetchSharedData, refreshShareLists,
    setScore, addProperty, removeProperty, updateProp,
    addCriteria, removeCriteria, toggleHidden, updateCriteria,
  } = state;

  const handleTabPress = useCallback((index) => {
    setActiveTab(index);
    pagerRef.current?.setPage(index);
  }, []);

  const handlePageSelected = useCallback((e) => {
    setActiveTab(e.nativeEvent.position);
  }, []);

  const handleViewSharedData = useCallback((userId, userNickname) => {
    setViewingShared({ userId, nickname: userNickname });
  }, []);

  // If viewing shared data, show read-only viewer
  if (viewingShared) {
    return (
      <SafeAreaProvider>
        <SharedDataViewer
          targetId={viewingShared.userId}
          targetNickname={viewingShared.nickname}
          fetchSharedData={fetchSharedData}
          onClose={() => setViewingShared(null)}
        />
      </SafeAreaProvider>
    );
  }

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
            <Text style={styles.title}>부동산 매수 평가</Text>
            <Text style={styles.subtitle}>데이터 기반 의사결정 도구</Text>
          </View>
        </View>

        {/* Share button */}
        <TouchableOpacity
          onPress={() => setShareVisible(true)}
          style={[
            styles.shareBtn,
            incomingRequests.length > 0 && styles.shareBtnAlert,
          ]}
        >
          <Text style={styles.shareBtnText}>
            👥 공유{incomingRequests.length > 0 ? ` (${incomingRequests.length})` : ""}
          </Text>
        </TouchableOpacity>
      </View>

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
        nickname={nickname}
        onUpdateNickname={updateNickname}
        incomingRequests={incomingRequests}
        sharingList={sharingList}
        receivingList={receivingList}
        onSendRequest={sendShareRequest}
        onRespondRequest={respondShareRequest}
        onRemoveShare={removeShare}
        onViewSharedData={handleViewSharedData}
        onRefresh={refreshShareLists}
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
  title:          { fontSize: 15, fontWeight: "800", color: COLORS.text, letterSpacing: -0.3 },
  subtitle:       { fontSize: 10, color: COLORS.textFaint, marginTop: 1 },
  shareBtn:       { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.05)" },
  shareBtnAlert:  { borderColor: "rgba(99,102,241,0.5)", backgroundColor: "rgba(99,102,241,0.15)" },
  shareBtnText:   { fontSize: 12, fontWeight: "700", color: COLORS.textMuted },
  tabBar:         { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  tab:            { flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive:      { borderBottomColor: COLORS.primary },
  tabText:        { fontSize: 11, fontWeight: "700", color: COLORS.textFaint },
  tabTextActive:  { color: "#818cf8" },
});
