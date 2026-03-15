// src/screens/ScoreTab.js
import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, StyleSheet, ActivityIndicator, FlatList,
} from "react-native";
import { COLORS, SCORE_LABELS, SCORE_COLORS, SCORE_VALUES, calcScore, getGrade, getScoreColor, getScoreLabel, formatPrice, sqmToPyeong } from "../constants";
import { searchApartment, getRegionCode, getApartmentAreas, getTransactions, getRegionalAnalysis } from "../services/apartmentApi";

function ScoreButton({ value, selected, onPress, color }) {
  const isHalf = value % 1 !== 0;
  const size = isHalf ? 20 : 36;
  return (
    <TouchableOpacity
      onPress={() => onPress(value)}
      style={[
        {
          width: size, height: size, borderRadius: size / 2,
          borderWidth: 2, alignItems: "center", justifyContent: "center",
          borderColor: selected ? color : "#2a2a3a",
          backgroundColor: selected ? color : "transparent",
        },
      ]}
    >
      <Text style={{ color: selected ? "#fff" : "#888", fontWeight: "700", fontSize: isHalf ? 9 : 13 }}>
        {isHalf ? "·" : value}
      </Text>
    </TouchableOpacity>
  );
}

export default function ScoreTab({ criteria, properties, setScore, addProperty, removeProperty, updateProp }) {
  const [selectedPropId, setSelectedPropId] = useState(properties[0]?.id);
  const activeCriteria = criteria.filter(c => !c.hidden);
  const selectedProp   = properties.find(p => p.id === selectedPropId) || properties[0];

  // 검색 관련 state
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimer = useRef(null);

  // 평수/실거래 관련 state
  const [areas, setAreas] = useState([]);
  const [selectedArea, setSelectedArea] = useState("전체");
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // 매물 변경 시 상태 리셋
  useEffect(() => {
    setShowDropdown(false);
    setSearchResults([]);
    if (selectedProp?.lawdCd) {
      // 이미 검색된 매물이면 평수 목록 복원
      loadAreas(selectedProp.name, selectedProp.lawdCd, selectedProp.buildYear);
      setSelectedArea(selectedProp.selectedArea || "전체");
    } else {
      setAreas([]);
      setSelectedArea("전체");
    }
  }, [selectedPropId]);

  async function loadAreas(aptNm, lawdCd, buildYear) {
    try {
      const areasData = await getApartmentAreas(aptNm, lawdCd, buildYear);
      setAreas(areasData);
    } catch { setAreas([]); }
  }

  function handleAddProperty() {
    const newId = addProperty();
    setSelectedPropId(newId);
  }

  function handleRemoveProperty(id) {
    const nextId = removeProperty(id, selectedPropId);
    setSelectedPropId(nextId);
  }

  // 검색 디바운스
  function handleNameChange(text) {
    updateProp(selectedProp.id, "name", text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.length < 2) {
      setShowDropdown(false);
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await searchApartment(text);
        setSearchResults(results);
        setShowDropdown(results.length > 0);
      } catch {
        setSearchResults([]);
        setShowDropdown(false);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  }

  // 검색 결과 선택
  async function handleSelectApartment(item) {
    setShowDropdown(false);
    setSearchResults([]);
    updateProp(selectedProp.id, "name", item.aptName);
    updateProp(selectedProp.id, "address", item.address);
    if (item.buildYear) {
      updateProp(selectedProp.id, "buildYear", parseInt(item.buildYear));
    }

    try {
      const regionData = await getRegionCode(item.address);
      updateProp(selectedProp.id, "lawdCd", regionData.lawdCd);
      updateProp(selectedProp.id, "umdNm", regionData.umdNm);
      updateProp(selectedProp.id, "guNm", regionData.guNm);

      const areasData = await getApartmentAreas(item.aptName, regionData.lawdCd, item.buildYear);
      setAreas(areasData);
      setSelectedArea("전체");
      updateProp(selectedProp.id, "selectedArea", "전체");

      await loadTransactionData(item.aptName, regionData.lawdCd, "전체", regionData.umdNm, item.buildYear);
    } catch (e) {
      console.warn("매물 정보 로드 실패:", e.message);
    }
  }

  // 평수 선택
  async function handleAreaSelect(area) {
    setSelectedArea(area);
    updateProp(selectedProp.id, "selectedArea", area);
    if (selectedProp.lawdCd) {
      await loadTransactionData(selectedProp.name, selectedProp.lawdCd, area, selectedProp.umdNm, selectedProp.buildYear);
    }
  }

  // 실거래 + 지역 분석 데이터 로드
  async function loadTransactionData(aptNm, lawdCd, area, umdNm, buildYear) {
    setTransactionLoading(true);
    try {
      const areaParam = area === "전체" ? "전체" : String(area);
      const data = await getTransactions(aptNm, lawdCd, areaParam, 12, buildYear);

      updateProp(selectedProp.id, "dongSummary", data.dongSummary || []);
      updateProp(selectedProp.id, "transactionHistory", data.transactions || []);

      // 최근/최고 거래가 추출
      if (data.dongSummary && data.dongSummary.length > 0) {
        const allRecent = data.dongSummary.map(d => d.recentPrice);
        const allHighest = data.dongSummary.map(d => d.highestPrice);
        const recentPrice = Math.max(...allRecent);
        const highestPrice = Math.max(...allHighest);
        updateProp(selectedProp.id, "recentPrice", recentPrice);
        updateProp(selectedProp.id, "highestPrice", highestPrice);

        // 가격 자동 입력 (최근 실거래가 기준, 만원 → 원)
        if (!selectedProp.price) {
          updateProp(selectedProp.id, "price", String(recentPrice * 10000));
        }
      }

      // 지역 시세 분석
      if (data.dongSummary && data.dongSummary.length > 0) {
        setAnalysisLoading(true);
        try {
          const priceForAnalysis = data.dongSummary[0].recentPrice;
          const areaForAnalysis = area === "전체" ? data.dongSummary[0].area : area;
          const analysis = await getRegionalAnalysis(lawdCd, umdNm || "", areaForAnalysis, priceForAnalysis);
          updateProp(selectedProp.id, "regionAvg", analysis.guAvg);
          updateProp(selectedProp.id, "dongAvg", analysis.dongAvg);
          updateProp(selectedProp.id, "pricePercentile", analysis.percentile);
          updateProp(selectedProp.id, "dongPercentile", analysis.dongPercentile);
          updateProp(selectedProp.id, "neighborComparison", analysis.neighborComparison || []);
        } catch {} finally { setAnalysisLoading(false); }
      }
    } catch (e) {
      console.warn("실거래 데이터 로드 실패:", e.message);
    } finally {
      setTransactionLoading(false);
    }
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

      {selectedProp ? (
        <>
          {/* Property info with search */}
          <View style={styles.card}>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
              <View style={{ flex: 1 }}>
                <TextInput
                  value={selectedProp.name}
                  onChangeText={handleNameChange}
                  placeholder="아파트명 검색 (예: 래미안)"
                  placeholderTextColor={COLORS.textFaint}
                  style={styles.nameInput}
                />
                {searchLoading && (
                  <ActivityIndicator size="small" color={COLORS.primary} style={{ position: "absolute", right: 10, top: 10 }} />
                )}
              </View>
              {properties.length > 1 && (
                <TouchableOpacity onPress={() => handleRemoveProperty(selectedProp.id)} style={styles.deleteBtn}>
                  <Text style={{ color: COLORS.danger, fontSize: 13 }}>삭제</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Search dropdown */}
            {showDropdown && (
              <View style={styles.dropdown}>
                <FlatList
                  data={searchResults}
                  keyExtractor={(item, i) => `${item.complexId || item.aptName}_${i}`}
                  keyboardShouldPersistTaps="handled"
                  style={{ maxHeight: 250 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.dropdownItem}
                      onPress={() => handleSelectApartment(item)}
                    >
                      <Text style={styles.dropdownName}>{item.aptName}</Text>
                      <Text style={styles.dropdownAddr}>{item.address}</Text>
                      <Text style={styles.dropdownMeta}>
                        {item.buildYear ? `${item.buildYear}년` : ""}
                        {item.units ? ` · ${item.units}세대` : ""}
                        {item.buildings ? ` · ${item.buildings}동` : ""}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}

            <TextInput
              value={selectedProp.address}
              onChangeText={v => updateProp(selectedProp.id, "address", v)}
              placeholder="주소 (선택)"
              placeholderTextColor={COLORS.textFaint}
              style={styles.addressInput}
            />
            <View style={styles.priceRow}>
              <TextInput
                value={selectedProp.price ? Number(selectedProp.price).toLocaleString() : ""}
                onChangeText={v => {
                  const digits = v.replace(/[^0-9]/g, "");
                  updateProp(selectedProp.id, "price", digits);
                }}
                placeholder="매매가 (원)"
                placeholderTextColor={COLORS.textFaint}
                keyboardType="numeric"
                style={[styles.priceInput, { flex: 1 }]}
              />
              {selectedProp.price ? (
                <Text style={styles.priceUnit}>원</Text>
              ) : null}
            </View>
            {selectedProp.buildYear && (
              <Text style={styles.buildYearText}>건축년도: {selectedProp.buildYear}년</Text>
            )}
          </View>

          {/* 평수 선택 */}
          {selectedProp.lawdCd && areas.length > 0 && (
            <View style={styles.areaSection}>
              <Text style={styles.sectionTitle}>📐 평수 선택</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <TouchableOpacity
                  onPress={() => handleAreaSelect("전체")}
                  style={[styles.areaPill, selectedArea === "전체" && styles.areaPillActive]}
                >
                  <Text style={[styles.areaPillText, selectedArea === "전체" && styles.areaPillTextActive]}>전체</Text>
                </TouchableOpacity>
                {areas.map(a => (
                  <TouchableOpacity
                    key={a.area}
                    onPress={() => handleAreaSelect(a.area)}
                    style={[styles.areaPill, selectedArea === String(a.area) && styles.areaPillActive]}
                  >
                    <Text style={[styles.areaPillText, selectedArea === String(a.area) && styles.areaPillTextActive]}>
                      {a.area}㎡({a.areaPyeong}평)
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* 실거래 정보 테이블 */}
          {transactionLoading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.loadingText}>실거래 데이터 조회 중...</Text>
            </View>
          ) : selectedProp.dongSummary && selectedProp.dongSummary.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>📋 동별 실거래 정보</Text>
              <View style={styles.txTable}>
                {/* 헤더 */}
                <View style={styles.txRow}>
                  <Text style={[styles.txCell, styles.txHeader, { flex: 1.2 }]}>동</Text>
                  {selectedArea === "전체" && <Text style={[styles.txCell, styles.txHeader, { flex: 1.2 }]}>평수</Text>}
                  <Text style={[styles.txCell, styles.txHeader, { flex: 1.5 }]}>최근 거래</Text>
                  <Text style={[styles.txCell, styles.txHeader, { flex: 1.5 }]}>거래일</Text>
                  <Text style={[styles.txCell, styles.txHeader, { flex: 1.5 }]}>최고가</Text>
                </View>
                {/* 데이터 */}
                {selectedProp.dongSummary.map((d, i) => (
                  <View key={i} style={[styles.txRow, i % 2 === 0 && styles.txRowAlt]}>
                    <Text style={[styles.txCell, styles.txData, { flex: 1.2 }]}>{d.dong}</Text>
                    {selectedArea === "전체" && (
                      <Text style={[styles.txCell, styles.txData, { flex: 1.2 }]}>{d.areaPyeong}평</Text>
                    )}
                    <Text style={[styles.txCell, styles.txData, styles.txPrice, { flex: 1.5 }]}>
                      {formatPrice(d.recentPrice)}
                    </Text>
                    <Text style={[styles.txCell, styles.txData, { flex: 1.5 }]}>{d.recentDate}</Text>
                    <Text style={[styles.txCell, styles.txData, styles.txHighest, { flex: 1.5 }]}>
                      {formatPrice(d.highestPrice)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* 지역 시세 분석 */}
          {analysisLoading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.loadingText}>지역 시세 분석 중...</Text>
            </View>
          ) : selectedProp.regionAvg ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>📊 지역 시세 분석</Text>

              {/* 백분위 뱃지 */}
              {selectedProp.pricePercentile != null && (
                <View style={styles.percentileSection}>
                  <View style={styles.percentileRow}>
                    <Text style={styles.percentileLabel}>{selectedProp.guNm || "구"} 내</Text>
                    <View style={styles.percentileBadge}>
                      <Text style={styles.percentileText}>상위 {selectedProp.pricePercentile}%</Text>
                    </View>
                    <View style={styles.percentileBar}>
                      <View style={[styles.percentileFill, { width: `${100 - selectedProp.pricePercentile}%` }]} />
                    </View>
                  </View>
                  {selectedProp.dongPercentile != null && selectedProp.umdNm && (
                    <View style={styles.percentileRow}>
                      <Text style={styles.percentileLabel}>{selectedProp.umdNm} 내</Text>
                      <View style={styles.percentileBadge}>
                        <Text style={styles.percentileText}>상위 {selectedProp.dongPercentile}%</Text>
                      </View>
                      <View style={styles.percentileBar}>
                        <View style={[styles.percentileFill, { width: `${100 - selectedProp.dongPercentile}%` }]} />
                      </View>
                    </View>
                  )}
                </View>
              )}

              {/* 평균 비교 */}
              <View style={styles.avgSection}>
                {selectedProp.regionAvg && (
                  <View style={styles.avgRow}>
                    <Text style={styles.avgLabel}>{selectedProp.guNm || "구"} 평균</Text>
                    <Text style={styles.avgValue}>{formatPrice(selectedProp.regionAvg)}</Text>
                    {selectedProp.recentPrice && (() => {
                      const diff = selectedProp.recentPrice - selectedProp.regionAvg;
                      const isLower = diff < 0;
                      return <Text style={[styles.avgDiff, { color: isLower ? "#22c55e" : "#ef4444" }]}>
                        {isLower ? "▼" : "▲"} {formatPrice(Math.abs(diff))} {isLower ? "저렴" : "높음"}
                      </Text>;
                    })()}
                  </View>
                )}
                {selectedProp.dongAvg && selectedProp.umdNm && (
                  <View style={styles.avgRow}>
                    <Text style={styles.avgLabel}>{selectedProp.umdNm} 평균</Text>
                    <Text style={styles.avgValue}>{formatPrice(selectedProp.dongAvg)}</Text>
                    {selectedProp.recentPrice && (() => {
                      const diff = selectedProp.recentPrice - selectedProp.dongAvg;
                      const isLower = diff < 0;
                      return <Text style={[styles.avgDiff, { color: isLower ? "#22c55e" : "#ef4444" }]}>
                        {isLower ? "▼" : "▲"} {formatPrice(Math.abs(diff))} {isLower ? "저렴" : "높음"}
                      </Text>;
                    })()}
                  </View>
                )}
              </View>

              {/* 인접 구 비교 */}
              {selectedProp.neighborComparison && selectedProp.neighborComparison.length > 1 && (
                <View style={styles.neighborSection}>
                  <Text style={styles.neighborTitle}>인접 지역 비교</Text>
                  {selectedProp.neighborComparison.map((n, i) => {
                    const isCurrent = n.guNm === (selectedProp.guNm || "");
                    return (
                      <View key={i} style={[styles.neighborRow, isCurrent && styles.neighborRowCurrent]}>
                        <Text style={[styles.neighborName, isCurrent && { color: COLORS.primary, fontWeight: "800" }]}>
                          {n.guNm} {isCurrent ? "★" : ""}
                        </Text>
                        <Text style={styles.neighborAvg}>{formatPrice(n.avg)}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}

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
            const color = score > 0 ? getScoreColor(score) : "#374151";
            const label = score > 0 ? getScoreLabel(score) : "";
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
                  {score > 0 && label ? <Text style={[styles.scoreLabel, { color }]} numberOfLines={1}>{label}</Text> : null}
                </View>
                <View style={styles.scoreRow}>
                  {SCORE_VALUES.map(v => (
                    <ScoreButton key={v} value={v} selected={score === v}
                      onPress={val => setScore(selectedProp.id, c.id, score === val ? null : val)} color={getScoreColor(v)} />
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
      ) : (
        <View style={{ alignItems: "center", paddingTop: 80 }}>
          <Text style={{ fontSize: 15, color: COLORS.textMuted, marginBottom: 8 }}>매물이 없습니다</Text>
          <TouchableOpacity onPress={handleAddProperty} style={{ paddingHorizontal: 20, paddingVertical: 10, backgroundColor: COLORS.primary, borderRadius: 10 }}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>매물 추가</Text>
          </TouchableOpacity>
        </View>
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
  priceRow:    { flexDirection: "row", alignItems: "center", marginTop: 6 },
  priceInput:  { backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, color: COLORS.textMuted, fontSize: 12 },
  priceUnit:   { color: COLORS.textFaint, fontSize: 12, fontWeight: "700", marginLeft: 6 },
  deleteBtn:   { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.08)" },
  buildYearText: { color: COLORS.textFaint, fontSize: 11, marginTop: 6 },

  // 드롭다운
  dropdown:      { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.primaryBorder, borderRadius: 10, marginBottom: 10, overflow: "hidden" },
  dropdownItem:  { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  dropdownName:  { color: COLORS.text, fontSize: 13, fontWeight: "700" },
  dropdownAddr:  { color: COLORS.textFaint, fontSize: 11, marginTop: 2 },
  dropdownMeta:  { color: COLORS.textFaint, fontSize: 10, marginTop: 1 },

  // 평수 선택
  areaSection: { marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: COLORS.textMuted, marginBottom: 10 },
  areaPill:      { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.1)", marginRight: 8 },
  areaPillActive: { borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.15)" },
  areaPillText:   { color: COLORS.textMuted, fontSize: 12, fontWeight: "700" },
  areaPillTextActive: { color: "#22c55e" },

  // 로딩
  loadingCard: { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 20, gap: 10, marginBottom: 16 },
  loadingText: { color: COLORS.textFaint, fontSize: 12 },

  // 실거래 테이블
  txTable:   { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, overflow: "hidden" },
  txRow:     { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.borderFaint },
  txRowAlt:  { backgroundColor: "rgba(255,255,255,0.02)" },
  txCell:    { paddingHorizontal: 6, paddingVertical: 8, alignItems: "center", justifyContent: "center" },
  txHeader:  { backgroundColor: "rgba(255,255,255,0.05)" },
  txData:    { },
  txPrice:   { },
  txHighest: { },

  // 지역 시세 분석
  percentileSection: { marginBottom: 14 },
  percentileRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  percentileLabel: { color: COLORS.textMuted, fontSize: 12, width: 60 },
  percentileBadge: { backgroundColor: "rgba(99,102,241,0.2)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  percentileText:  { color: "#818cf8", fontSize: 12, fontWeight: "700" },
  percentileBar:   { flex: 1, height: 6, backgroundColor: "#1e1e2e", borderRadius: 3, overflow: "hidden" },
  percentileFill:  { height: "100%", backgroundColor: "#6366f1", borderRadius: 3 },

  avgSection:   { marginBottom: 14 },
  avgRow:       { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  avgLabel:     { color: COLORS.textMuted, fontSize: 12, width: 70 },
  avgValue:     { color: COLORS.text, fontSize: 13, fontWeight: "700" },
  avgDiff:      { fontSize: 11, fontWeight: "700" },

  neighborSection: { borderTopWidth: 1, borderTopColor: COLORS.borderFaint, paddingTop: 12 },
  neighborTitle:   { color: COLORS.textFaint, fontSize: 11, fontWeight: "700", marginBottom: 8 },
  neighborRow:     { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, marginBottom: 2 },
  neighborRowCurrent: { backgroundColor: "rgba(99,102,241,0.1)" },
  neighborName:    { color: COLORS.textMuted, fontSize: 12 },
  neighborAvg:     { color: COLORS.text, fontSize: 12, fontWeight: "700" },

  // 기존 스타일
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
  scoreRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  memoInput:   { backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 14, color: COLORS.textMuted, fontSize: 13, marginTop: 6, textAlignVertical: "top" },
});
