// src/screens/ScoreTab.js
import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, StyleSheet, ActivityIndicator, FlatList,
} from "react-native";
import { COLORS, SCORE_LABELS, SCORE_COLORS, SCORE_VALUES, calcScore, getGrade, getScoreColor, getScoreLabel, formatPrice, sqmToPyeong } from "../constants";
import { searchApartment, getRegionCode, getApartmentAreas, getTransactions, getRentTransactions, getRegionalAnalysis, getComplexInfo } from "../services/apartmentApi";

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
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [dataCollecting, setDataCollecting] = useState(false);
  const [complexInfoLoading, setComplexInfoLoading] = useState(false);
  const [txTab, setTxTab] = useState("매매"); // 매매/전세/월세
  const [priceRangeTab, setPriceRangeTab] = useState("최근 1년"); // 최근 1년/전체기간
  const [areaLoading, setAreaLoading] = useState(false);

  // 전체 데이터 캐시 (평수 변경 시 클라이언트 필터링용)
  const allDataCache = useRef({ transactions: null, rent: null });

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

  async function loadComplexInfo(lawdCd, address, aptName, bjdongCd) {
    setComplexInfoLoading(true);
    try {
      const info = await getComplexInfo(lawdCd, address, aptName, bjdongCd);
      updateProp(selectedProp.id, "complexInfo", info);
    } catch (e) {
      console.warn("단지 정보 조회 실패:", e.message);
      updateProp(selectedProp.id, "complexInfo", null);
    } finally {
      setComplexInfoLoading(false);
    }
  }

  async function loadRentData(aptNm, lawdCd, area, buildYear) {
    try {
      const data = await getRentTransactions(aptNm, lawdCd, area, 12, buildYear);
      // area가 "전체"일 때 캐시 저장
      if (area === "전체") {
        allDataCache.current.rent = data;
      }
      updateProp(selectedProp.id, "jeonseData", data.jeonse || { transactions: [], dongSummary: [] });
      updateProp(selectedProp.id, "wolseData", data.wolse || { transactions: [], dongSummary: [] });
    } catch (e) {
      console.warn("전월세 데이터 로드 실패:", e.message);
      updateProp(selectedProp.id, "jeonseData", { transactions: [], dongSummary: [] });
      updateProp(selectedProp.id, "wolseData", { transactions: [], dongSummary: [] });
    }
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
    if (text.length === 0) {
      // 이름을 모두 지우면 매물 정보 초기화
      setShowDropdown(false);
      setSearchResults([]);
      setAreas([]);
      setSelectedArea("전체");
      updateProp(selectedProp.id, "address", "");
      updateProp(selectedProp.id, "lawdCd", null);
      updateProp(selectedProp.id, "umdNm", null);
      updateProp(selectedProp.id, "guNm", null);
      updateProp(selectedProp.id, "buildYear", null);
      updateProp(selectedProp.id, "bjdongCd", null);
      updateProp(selectedProp.id, "dongSummary", []);
      updateProp(selectedProp.id, "transactionHistory", []);
      updateProp(selectedProp.id, "neighborComparison", []);
      updateProp(selectedProp.id, "recentPrice", null);
      updateProp(selectedProp.id, "highestPrice", null);
      updateProp(selectedProp.id, "lowestPrice", null);
      updateProp(selectedProp.id, "allTimePriceRange", null);
      updateProp(selectedProp.id, "regionAvg", null);
      updateProp(selectedProp.id, "dongAvg", null);
      updateProp(selectedProp.id, "pricePercentile", null);
      updateProp(selectedProp.id, "dongPercentile", null);
      updateProp(selectedProp.id, "complexInfo", null);
      updateProp(selectedProp.id, "jeonseData", null);
      updateProp(selectedProp.id, "wolseData", null);
      return;
    }
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
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setShowDropdown(false);
    setSearchResults([]);
    setDataCollecting(true);
    updateProp(selectedProp.id, "name", item.aptName);
    updateProp(selectedProp.id, "address", item.address);
    if (item.buildYear) {
      updateProp(selectedProp.id, "buildYear", parseInt(item.buildYear));
    }
    if (item.bjdongCd) {
      updateProp(selectedProp.id, "bjdongCd", item.bjdongCd);
    }

    try {
      const regionData = await getRegionCode(item.address);
      updateProp(selectedProp.id, "lawdCd", regionData.lawdCd);
      updateProp(selectedProp.id, "umdNm", regionData.umdNm);
      updateProp(selectedProp.id, "guNm", regionData.guNm);

      // 평수 목록 + 매매 + 전월세 + 단지정보 모두 병렬 조회
      const [areasResult] = await Promise.allSettled([
        getApartmentAreas(item.aptName, regionData.lawdCd, item.buildYear),
        loadTransactionData(item.aptName, regionData.lawdCd, "전체", regionData.umdNm, item.buildYear),
        loadRentData(item.aptName, regionData.lawdCd, "전체", item.buildYear),
        loadComplexInfo(regionData.lawdCd, item.address, item.aptName, item.bjdongCd),
      ]);

      // 평수 목록 반영
      if (areasResult.status === "fulfilled") {
        setAreas(areasResult.value);
      }
      setSelectedArea("전체");
      updateProp(selectedProp.id, "selectedArea", "전체");
    } catch (e) {
      console.warn("매물 정보 로드 실패:", e.message);
    } finally {
      setDataCollecting(false);
    }
  }

  // 전용면적 → 공급면적 기준 평수 변환
  function getSupplyPyeong(exclusiveArea) {
    const ci = selectedProp.complexInfo?.exclusiveAreas?.find(
      e => Math.abs(e.area - exclusiveArea) < 2
    );
    return ci?.supplyPyeong || Math.round(exclusiveArea / 3.3058);
  }

  // 평수 선택 (캐시된 전체 데이터에서 클라이언트 필터링, 없으면 서버 호출)
  async function handleAreaSelect(area) {
    setSelectedArea(String(area));
    updateProp(selectedProp.id, "selectedArea", area);
    if (!selectedProp.lawdCd) return;

    setAreaLoading(true);
    try {
      if (area === "전체") {
        // "전체"는 캐시에서 바로 복원
        const cachedTx = allDataCache.current.transactions;
        const cachedRent = allDataCache.current.rent;
        if (cachedTx) {
          updateProp(selectedProp.id, "dongSummary", cachedTx.dongSummary || []);
          updateProp(selectedProp.id, "transactionHistory", cachedTx.transactions || []);
          if (cachedTx.dongSummary?.length > 0) {
            updateProp(selectedProp.id, "recentPrice", Math.max(...cachedTx.dongSummary.map(d => d.recentPrice)));
            updateProp(selectedProp.id, "highestPrice", Math.max(...cachedTx.dongSummary.map(d => d.highestPrice)));
            updateProp(selectedProp.id, "lowestPrice", Math.min(...cachedTx.dongSummary.map(d => d.lowestPrice)));
            if (cachedTx.allTimePriceRange) {
              updateProp(selectedProp.id, "allTimePriceRange", cachedTx.allTimePriceRange);
            }
          }
        }
        if (cachedRent) {
          updateProp(selectedProp.id, "jeonseData", cachedRent.jeonse || { transactions: [], dongSummary: [] });
          updateProp(selectedProp.id, "wolseData", cachedRent.wolse || { transactions: [], dongSummary: [] });
        }
      } else {
        // 특정 평수: 서버에서 필터링된 데이터 조회 (캐시 덕분에 DB 쿼리만 수행, 외부 API 호출 없음)
        await Promise.allSettled([
          loadTransactionData(selectedProp.name, selectedProp.lawdCd, area, selectedProp.umdNm, selectedProp.buildYear),
          loadRentData(selectedProp.name, selectedProp.lawdCd, area, selectedProp.buildYear),
        ]);
      }
    } finally {
      setAreaLoading(false);
    }
  }

  // 실거래 데이터 로드 (지역 분석은 별도 비동기)
  async function loadTransactionData(aptNm, lawdCd, area, umdNm, buildYear) {
    try {
      const areaParam = area === "전체" ? "전체" : String(area);
      const data = await getTransactions(aptNm, lawdCd, areaParam, 12, buildYear);

      // area가 "전체"일 때 캐시 저장
      if (area === "전체") {
        allDataCache.current.transactions = data;
      }

      updateProp(selectedProp.id, "dongSummary", data.dongSummary || []);
      updateProp(selectedProp.id, "transactionHistory", data.transactions || []);

      // 최근/최고 거래가 추출
      if (data.dongSummary && data.dongSummary.length > 0) {
        const allRecent = data.dongSummary.map(d => d.recentPrice);
        const allHighest = data.dongSummary.map(d => d.highestPrice);
        const allLowest = data.dongSummary.map(d => d.lowestPrice);
        const recentPrice = Math.max(...allRecent);
        const highestPrice = Math.max(...allHighest);
        const lowestPrice = Math.min(...allLowest);
        updateProp(selectedProp.id, "recentPrice", recentPrice);
        updateProp(selectedProp.id, "highestPrice", highestPrice);
        updateProp(selectedProp.id, "lowestPrice", lowestPrice);
      }

      // 전체기간 최고/최저가 저장
      if (data.allTimePriceRange) {
        updateProp(selectedProp.id, "allTimePriceRange", data.allTimePriceRange);
      }

      // 지역 시세 분석 (fire-and-forget: 매매 데이터 먼저 표시, 분석은 백그라운드)
      if (data.dongSummary && data.dongSummary.length > 0) {
        setAnalysisLoading(true);
        const priceForAnalysis = data.dongSummary[0].recentPrice;
        const areaForAnalysis = area === "전체" ? data.dongSummary[0].area : area;
        const guNmForAnalysis = selectedProp.guNm || "";
        getRegionalAnalysis(lawdCd, umdNm || "", areaForAnalysis, priceForAnalysis, guNmForAnalysis)
          .then(analysis => {
            updateProp(selectedProp.id, "regionAvg", analysis.guAvg);
            updateProp(selectedProp.id, "dongAvg", analysis.dongAvg);
            updateProp(selectedProp.id, "pricePercentile", analysis.percentile);
            updateProp(selectedProp.id, "dongPercentile", analysis.dongPercentile);
            updateProp(selectedProp.id, "neighborComparison", analysis.neighborComparison || []);
          })
          .catch(() => {})
          .finally(() => setAnalysisLoading(false));
      }
    } catch (e) {
      console.warn("실거래 데이터 로드 실패:", e.message);
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
                  placeholder="아파트명, 동 이름, 도로명주소 검색"
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
                  nestedScrollEnabled={true}
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
              editable={false}
              placeholder="매물 선택 시 자동 입력"
              placeholderTextColor={COLORS.textFaint}
              style={[styles.addressInput, { opacity: 0.7 }]}
            />

            <View style={styles.priceRow}>
              <TextInput
                value={selectedProp.price ? Number(selectedProp.price).toLocaleString() : ""}
                onChangeText={v => {
                  const digits = v.replace(/[^0-9]/g, "");
                  updateProp(selectedProp.id, "price", digits);
                }}
                placeholder="희망 거래 가격 (원)"
                placeholderTextColor={COLORS.textFaint}
                keyboardType="numeric"
                style={[styles.priceInput, { flex: 1 }]}
              />
              {selectedProp.price ? (
                <Text style={styles.priceUnit}>원</Text>
              ) : null}
            </View>
          </View>

          {/* 데이터 분석 오버레이 */}
          {dataCollecting && (
            <View style={styles.analyzingOverlay}>
              <View style={styles.analyzingContent}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.analyzingTitle}>해당 단지 데이터 분석 중...</Text>
                <Text style={styles.analyzingSubText}>
                  단지 정보 · 실거래가 · 전월세 데이터를 수집하고 있습니다
                </Text>
              </View>
            </View>
          )}

          {/* 건축물대장 단지 정보 */}
          {!dataCollecting && complexInfoLoading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.loadingText}>단지 정보 조회 중...</Text>
            </View>
          ) : !dataCollecting && selectedProp.complexInfo ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>단지 정보</Text>
              <View style={styles.complexGrid}>
                <View style={styles.complexRow}>
                  <View style={styles.complexItem}>
                    <Text style={styles.complexLabel}>용적률</Text>
                    <Text style={styles.complexValue}>{selectedProp.complexInfo.vlRat ? `${selectedProp.complexInfo.vlRat}%` : "-"}</Text>
                  </View>
                  <View style={styles.complexItem}>
                    <Text style={styles.complexLabel}>건폐율</Text>
                    <Text style={styles.complexValue}>{selectedProp.complexInfo.bcRat ? `${selectedProp.complexInfo.bcRat}%` : "-"}</Text>
                  </View>
                  <View style={styles.complexItem}>
                    <Text style={styles.complexLabel}>최고층</Text>
                    <Text style={styles.complexValue}>{selectedProp.complexInfo.maxFloor}층</Text>
                  </View>
                </View>
                <View style={styles.complexRow}>
                  <View style={styles.complexItem}>
                    <Text style={styles.complexLabel}>총세대수</Text>
                    <Text style={styles.complexValue}>{selectedProp.complexInfo.totalHouseholds ? `${selectedProp.complexInfo.totalHouseholds}세대` : "-"}</Text>
                  </View>
                  <View style={styles.complexItem}>
                    <Text style={styles.complexLabel}>총주차</Text>
                    <Text style={styles.complexValue}>{selectedProp.complexInfo.totalParking ? `${selectedProp.complexInfo.totalParking}대` : "-"}</Text>
                  </View>
                  <View style={styles.complexItem}>
                    <Text style={styles.complexLabel}>세대당 주차</Text>
                    <Text style={styles.complexValue}>{selectedProp.complexInfo.parkingPerUnit ? `${selectedProp.complexInfo.parkingPerUnit}대` : "-"}</Text>
                  </View>
                </View>
                <View style={styles.complexRow}>
                  <View style={styles.complexItem}>
                    <Text style={styles.complexLabel}>동수</Text>
                    <Text style={styles.complexValue}>{selectedProp.complexInfo.buildingCount}개동</Text>
                  </View>
                  <View style={styles.complexItem}>
                    <Text style={styles.complexLabel}>지하</Text>
                    <Text style={styles.complexValue}>{selectedProp.complexInfo.maxUgrndFloor}층</Text>
                  </View>
                  <View style={styles.complexItem}>
                    <Text style={styles.complexLabel}>사용승인일</Text>
                    <Text style={styles.complexValue}>{selectedProp.complexInfo.useAprDate || "-"}</Text>
                  </View>
                </View>
                {(selectedProp.complexInfo.heatType || selectedProp.complexInfo.constructor) && (
                  <View style={styles.complexRow}>
                    {selectedProp.complexInfo.heatType && (
                      <View style={styles.complexItem}>
                        <Text style={styles.complexLabel}>난방</Text>
                        <Text style={styles.complexValue}>{selectedProp.complexInfo.heatType}</Text>
                      </View>
                    )}
                    {selectedProp.complexInfo.constructor && (
                      <View style={styles.complexItem}>
                        <Text style={styles.complexLabel}>건설사</Text>
                        <Text style={styles.complexValue}>{selectedProp.complexInfo.constructor}</Text>
                      </View>
                    )}
                    {selectedProp.complexInfo.hallType && (
                      <View style={styles.complexItem}>
                        <Text style={styles.complexLabel}>복도유형</Text>
                        <Text style={styles.complexValue}>{selectedProp.complexInfo.hallType}</Text>
                      </View>
                    )}
                  </View>
                )}
                {(selectedProp.complexInfo.manageTel || selectedProp.complexInfo.doroJuso) && (
                  <View style={styles.complexRow}>
                    {selectedProp.complexInfo.manageTel && (
                      <View style={[styles.complexItem, { flex: 1.5 }]}>
                        <Text style={styles.complexLabel}>관리사무소</Text>
                        <Text style={styles.complexValue}>{selectedProp.complexInfo.manageTel}</Text>
                      </View>
                    )}
                    {selectedProp.complexInfo.manageType && (
                      <View style={styles.complexItem}>
                        <Text style={styles.complexLabel}>관리방식</Text>
                        <Text style={styles.complexValue}>{selectedProp.complexInfo.manageType}</Text>
                      </View>
                    )}
                  </View>
                )}
                {selectedProp.complexInfo.doroJuso && (
                  <View style={styles.complexRow}>
                    <View style={[styles.complexItem, { flex: 1 }]}>
                      <Text style={styles.complexLabel}>도로명주소</Text>
                      <Text style={[styles.complexValue, { fontSize: 11 }]}>{selectedProp.complexInfo.doroJuso}</Text>
                    </View>
                  </View>
                )}
              </View>
              {selectedProp.complexInfo.exclusiveAreas && selectedProp.complexInfo.exclusiveAreas.length > 0 && (
                <View style={styles.complexAreasSection}>
                  <Text style={styles.complexAreasTitle}>면적 종류 (공급/전용)</Text>
                  <View style={styles.complexAreasRow}>
                    {selectedProp.complexInfo.exclusiveAreas.map((a, i) => (
                      <View key={i} style={styles.complexAreaPill}>
                        <Text style={styles.complexAreaText}>
                          {a.supplyArea ? `${a.supplyArea}/${a.area}㎡(${a.supplyPyeong}평)` : `${a.area}㎡(${a.areaPyeong}평)`}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          ) : null}

          {/* 평수 선택 */}
          {!dataCollecting && selectedProp.lawdCd && areas.length > 0 && (
            <View style={styles.areaSection}>
              <Text style={styles.sectionTitle}>📐 평수 선택</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <TouchableOpacity
                  onPress={() => handleAreaSelect("전체")}
                  style={[styles.areaPill, selectedArea === "전체" && styles.areaPillActive]}
                >
                  <Text style={[styles.areaPillText, selectedArea === "전체" && styles.areaPillTextActive]}>전체</Text>
                </TouchableOpacity>
                {areas.map(a => {
                  const ci = selectedProp.complexInfo?.exclusiveAreas?.find(
                    e => Math.abs(e.area - a.area) < 1
                  );
                  const label = ci?.supplyArea
                    ? `${ci.supplyArea}/${a.area}㎡(${ci.supplyPyeong}평)`
                    : `${a.area}㎡(${a.areaPyeong}평)`;
                  return (
                    <TouchableOpacity
                      key={a.area}
                      onPress={() => handleAreaSelect(a.area)}
                      style={[styles.areaPill, selectedArea === String(a.area) && styles.areaPillActive]}
                    >
                      <Text style={[styles.areaPillText, selectedArea === String(a.area) && styles.areaPillTextActive]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* 평수 변경 데이터 분석 오버레이 */}
          {areaLoading && (
            <View style={styles.analyzingOverlay}>
              <View style={styles.analyzingContent}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.analyzingTitle}>해당 평수에 대한 데이터 분석 중...</Text>
                <Text style={styles.analyzingSubText}>
                  실거래가 · 전월세 데이터를 수집하고 있습니다
                </Text>
              </View>
            </View>
          )}

          {/* 실거래 정보 테이블 (매매/전세/월세 탭) */}
          {(dataCollecting || areaLoading) ? null : (selectedProp.dongSummary?.length > 0 || selectedProp.jeonseData?.dongSummary?.length > 0 || selectedProp.wolseData?.dongSummary?.length > 0) ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>📋 동별 실거래 정보</Text>
              {/* 매매/전세/월세 탭 */}
              <View style={styles.txTabRow}>
                {["매매", "전세", "월세"].map(tab => (
                  <TouchableOpacity
                    key={tab}
                    onPress={() => setTxTab(tab)}
                    style={[styles.txTabBtn, txTab === tab && styles.txTabBtnActive]}
                  >
                    <Text style={[styles.txTabText, txTab === tab && styles.txTabTextActive]}>{tab}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 매매 탭 */}
              {txTab === "매매" && selectedProp.dongSummary?.length > 0 && (
                <View style={styles.txTable}>
                  <View style={styles.txRow}>
                    <Text style={[styles.txCell, styles.txHeader, { flex: 1.2 }]}>동</Text>
                    {selectedArea === "전체" && <Text style={[styles.txCell, styles.txHeader, { flex: 1.2 }]}>평수</Text>}
                    <Text style={[styles.txCell, styles.txHeader, { flex: 1.5 }]}>거래가</Text>
                    <Text style={[styles.txCell, styles.txHeader, { flex: 1.5 }]}>거래일</Text>
                  </View>
                  {selectedProp.dongSummary.map((d, i) => (
                    <View key={i} style={[styles.txRow, i % 2 === 0 && styles.txRowAlt]}>
                      <Text style={[styles.txCell, styles.txData, { flex: 1.2 }]}>{d.dong}</Text>
                      {selectedArea === "전체" && (
                        <Text style={[styles.txCell, styles.txData, { flex: 1.2 }]}>{getSupplyPyeong(d.area)}평</Text>
                      )}
                      <Text style={[styles.txCell, styles.txData, styles.txPrice, { flex: 1.5 }]}>
                        {formatPrice(d.recentPrice)}
                      </Text>
                      <Text style={[styles.txCell, styles.txData, { flex: 1.5 }]}>{d.recentDate}</Text>
                    </View>
                  ))}
                </View>
              )}
              {txTab === "매매" && (!selectedProp.dongSummary || selectedProp.dongSummary.length === 0) && (
                <Text style={styles.noDataText}>매매 거래 내역이 없습니다</Text>
              )}

              {/* 전세 탭 */}
              {txTab === "전세" && selectedProp.jeonseData?.dongSummary?.length > 0 && (
                <View style={styles.txTable}>
                  <View style={styles.txRow}>
                    <Text style={[styles.txCell, styles.txHeader, { flex: 1.2 }]}>동</Text>
                    {selectedArea === "전체" && <Text style={[styles.txCell, styles.txHeader, { flex: 1.2 }]}>평수</Text>}
                    <Text style={[styles.txCell, styles.txHeader, { flex: 1.5 }]}>보증금</Text>
                    <Text style={[styles.txCell, styles.txHeader, { flex: 1.5 }]}>거래일</Text>
                  </View>
                  {selectedProp.jeonseData.dongSummary.map((d, i) => (
                    <View key={i} style={[styles.txRow, i % 2 === 0 && styles.txRowAlt]}>
                      <Text style={[styles.txCell, styles.txData, { flex: 1.2 }]}>{d.dong}</Text>
                      {selectedArea === "전체" && (
                        <Text style={[styles.txCell, styles.txData, { flex: 1.2 }]}>{getSupplyPyeong(d.area)}평</Text>
                      )}
                      <Text style={[styles.txCell, styles.txData, styles.txPrice, { flex: 1.5 }]}>
                        {formatPrice(d.recentDeposit)}
                      </Text>
                      <Text style={[styles.txCell, styles.txData, { flex: 1.5 }]}>{d.recentDate}</Text>
                    </View>
                  ))}
                </View>
              )}
              {txTab === "전세" && (!selectedProp.jeonseData?.dongSummary || selectedProp.jeonseData.dongSummary.length === 0) && (
                <Text style={styles.noDataText}>전세 거래 내역이 없습니다</Text>
              )}

              {/* 월세 탭 */}
              {txTab === "월세" && selectedProp.wolseData?.dongSummary?.length > 0 && (
                <View style={styles.txTable}>
                  <View style={styles.txRow}>
                    <Text style={[styles.txCell, styles.txHeader, { flex: 1.2 }]}>동</Text>
                    {selectedArea === "전체" && <Text style={[styles.txCell, styles.txHeader, { flex: 1 }]}>평수</Text>}
                    <Text style={[styles.txCell, styles.txHeader, { flex: 1.5 }]}>보증금/월세</Text>
                    <Text style={[styles.txCell, styles.txHeader, { flex: 1.3 }]}>거래일</Text>
                  </View>
                  {selectedProp.wolseData.dongSummary.map((d, i) => (
                    <View key={i} style={[styles.txRow, i % 2 === 0 && styles.txRowAlt]}>
                      <Text style={[styles.txCell, styles.txData, { flex: 1.2 }]}>{d.dong}</Text>
                      {selectedArea === "전체" && (
                        <Text style={[styles.txCell, styles.txData, { flex: 1 }]}>{getSupplyPyeong(d.area)}평</Text>
                      )}
                      <Text style={[styles.txCell, styles.txData, styles.txPrice, { flex: 1.5 }]} numberOfLines={1}>
                        {formatPrice(d.recentDeposit)}/{d.recentMonthly}만
                      </Text>
                      <Text style={[styles.txCell, styles.txData, { flex: 1.3 }]}>{d.recentDate}</Text>
                    </View>
                  ))}
                </View>
              )}
              {txTab === "월세" && (!selectedProp.wolseData?.dongSummary || selectedProp.wolseData.dongSummary.length === 0) && (
                <Text style={styles.noDataText}>월세 거래 내역이 없습니다</Text>
              )}
            </View>
          ) : null}

          {/* 최고/최저 거래가 */}
          {(dataCollecting || areaLoading) ? null : selectedProp.dongSummary?.length > 0 && (() => {
            const ds = selectedProp.dongSummary;
            const recentHighest = ds.reduce((max, d) => d.highestPrice > max.highestPrice ? d : max, ds[0]);
            const recentLowest = ds.reduce((min, d) => d.lowestPrice < min.lowestPrice ? d : min, ds[0]);
            const allTime = selectedProp.allTimePriceRange;
            const isAllTime = priceRangeTab === "전체기간" && allTime?.highest && allTime?.lowest;
            const highest = isAllTime
              ? { price: allTime.highest.price, date: allTime.highest.date, dong: allTime.highest.dong, floor: allTime.highest.floor, area: allTime.highest.area }
              : { price: recentHighest.highestPrice, date: recentHighest.highestDate, dong: recentHighest.dong, floor: recentHighest.highestFloor, area: recentHighest.area };
            const lowest = isAllTime
              ? { price: allTime.lowest.price, date: allTime.lowest.date, dong: allTime.lowest.dong, floor: allTime.lowest.floor, area: allTime.lowest.area }
              : { price: recentLowest.lowestPrice, date: recentLowest.lowestDate, dong: recentLowest.dong, floor: recentLowest.lowestFloor, area: recentLowest.area };
            const gap = highest.price - lowest.price;
            return (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>📈 최고·최저 거래가</Text>
                <View style={styles.priceRangeTabRow}>
                  {["최근 1년", "전체기간"].map(tab => (
                    <TouchableOpacity
                      key={tab}
                      onPress={() => setPriceRangeTab(tab)}
                      style={[styles.priceRangeTabBtn, priceRangeTab === tab && styles.priceRangeTabBtnActive]}
                    >
                      <Text style={[styles.priceRangeTabText, priceRangeTab === tab && styles.priceRangeTabTextActive]}>{tab}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.priceRangeRow}>
                  <View style={[styles.priceRangeCard, { borderColor: "rgba(245,158,11,0.3)", backgroundColor: "rgba(245,158,11,0.08)" }]}>
                    <Text style={[styles.priceRangeLabel, { color: "#f59e0b" }]}>최고 거래가</Text>
                    <Text style={[styles.priceRangeValue, { color: "#f59e0b" }]}>{formatPrice(highest.price)}</Text>
                    <Text style={styles.priceRangeMeta}>{highest.date} · {highest.dong}동 {highest.floor}층</Text>
                    {selectedArea === "전체" && <Text style={styles.priceRangeMeta}>{getSupplyPyeong(highest.area)}평</Text>}
                  </View>
                  <View style={[styles.priceRangeCard, { borderColor: "rgba(59,130,246,0.3)", backgroundColor: "rgba(59,130,246,0.08)" }]}>
                    <Text style={[styles.priceRangeLabel, { color: "#3b82f6" }]}>최저 거래가</Text>
                    <Text style={[styles.priceRangeValue, { color: "#3b82f6" }]}>{formatPrice(lowest.price)}</Text>
                    <Text style={styles.priceRangeMeta}>{lowest.date} · {lowest.dong}동 {lowest.floor}층</Text>
                    {selectedArea === "전체" && <Text style={styles.priceRangeMeta}>{getSupplyPyeong(lowest.area)}평</Text>}
                  </View>
                </View>
                <View style={styles.priceGapRow}>
                  <Text style={styles.priceGapLabel}>가격 변동폭</Text>
                  <Text style={styles.priceGapValue}>{formatPrice(gap)}</Text>
                </View>
              </View>
            );
          })()}

          {/* 지역 시세 분석 */}
          {(dataCollecting || areaLoading) ? null : analysisLoading ? (
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
                  <Text style={styles.neighborTitle}>인접 동 비교</Text>
                  {selectedProp.neighborComparison.map((n, i) => {
                    const isCurrent = n.guNm === (selectedProp.umdNm || "");
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
  // 데이터 분석 오버레이
  analyzingOverlay: {
    backgroundColor: "rgba(15,15,25,0.85)",
    borderWidth: 1,
    borderColor: COLORS.primaryBorder,
    borderRadius: 16,
    paddingVertical: 60,
    paddingHorizontal: 24,
    marginBottom: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  analyzingContent: { alignItems: "center", gap: 14 },
  analyzingTitle: { color: COLORS.text, fontSize: 16, fontWeight: "800", marginTop: 4 },
  analyzingSubText: { color: COLORS.textFaint, fontSize: 12, textAlign: "center", lineHeight: 18 },

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
  txRowAlt:  { backgroundColor: "rgba(255,255,255,0.04)" },
  txCell:    { paddingHorizontal: 6, paddingVertical: 8, alignItems: "center", justifyContent: "center" },
  txHeader:  { backgroundColor: "rgba(255,255,255,0.08)", fontWeight: "700", color: COLORS.textMuted, fontSize: 11 },
  txData:    { color: COLORS.text, fontSize: 11 },
  txPrice:   { color: "#22c55e", fontWeight: "600" },
  txHighest: { color: "#f59e0b", fontWeight: "600" },
  txTabRow:      { flexDirection: "row", marginBottom: 12, gap: 6 },
  txTabBtn:      { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.1)", alignItems: "center" },
  txTabBtnActive:{ borderColor: COLORS.primary, backgroundColor: COLORS.primarySoft },
  txTabText:     { color: COLORS.textMuted, fontSize: 12, fontWeight: "700" },
  txTabTextActive: { color: "#818cf8" },
  noDataText:    { color: COLORS.textFaint, fontSize: 12, textAlign: "center", paddingVertical: 20 },

  // 최고/최저 거래가
  priceRangeTabRow:    { flexDirection: "row", marginBottom: 12, gap: 6 },
  priceRangeTabBtn:    { flex: 1, paddingVertical: 7, borderRadius: 8, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.1)", alignItems: "center" },
  priceRangeTabBtnActive: { borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.12)" },
  priceRangeTabText:   { color: COLORS.textMuted, fontSize: 12, fontWeight: "700" },
  priceRangeTabTextActive: { color: "#22c55e" },
  priceRangeRow:   { flexDirection: "row", gap: 10, marginBottom: 12 },
  priceRangeCard:  { flex: 1, borderWidth: 1.5, borderRadius: 12, padding: 14, alignItems: "center" },
  priceRangeLabel: { fontSize: 11, fontWeight: "700", marginBottom: 6 },
  priceRangeValue: { fontSize: 18, fontWeight: "800", marginBottom: 6 },
  priceRangeMeta:  { color: COLORS.textFaint, fontSize: 10, lineHeight: 16 },
  priceGapRow:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  priceGapLabel:   { color: COLORS.textMuted, fontSize: 12, fontWeight: "600" },
  priceGapValue:   { color: COLORS.text, fontSize: 14, fontWeight: "800" },

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

  // 건축물대장 단지 정보
  complexGrid:        { gap: 10 },
  complexRow:         { flexDirection: "row", gap: 8 },
  complexItem:        { flex: 1, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 10, alignItems: "center" },
  complexLabel:       { color: COLORS.textFaint, fontSize: 10, fontWeight: "600", marginBottom: 4 },
  complexValue:       { color: COLORS.text, fontSize: 13, fontWeight: "700" },
  complexAreasSection:{ marginTop: 12, borderTopWidth: 1, borderTopColor: COLORS.borderFaint, paddingTop: 10 },
  complexAreasTitle:  { color: COLORS.textFaint, fontSize: 11, fontWeight: "700", marginBottom: 8 },
  complexAreasRow:    { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  complexAreaPill:    { backgroundColor: "rgba(99,102,241,0.12)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  complexAreaText:    { color: "#818cf8", fontSize: 11, fontWeight: "600" },

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
