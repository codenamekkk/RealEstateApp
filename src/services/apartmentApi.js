// src/services/apartmentApi.js
import SERVER_URL from "../api";

export async function searchApartment(query) {
  const res = await fetch(`${SERVER_URL}/api/search/apartment?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("검색 실패");
  return res.json();
}

export async function getRegionCode(address) {
  const res = await fetch(`${SERVER_URL}/api/region-code?address=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error("지역코드 조회 실패");
  return res.json();
}

export async function getApartmentAreas(aptNm, lawdCd, buildYear, umdNm, jibun) {
  let url = `${SERVER_URL}/api/apartment/areas?lawdCd=${lawdCd}`;
  if (aptNm) url += `&aptNm=${encodeURIComponent(aptNm)}`;
  if (buildYear) url += `&buildYear=${buildYear}`;
  if (umdNm) url += `&umdNm=${encodeURIComponent(umdNm)}`;
  if (jibun) url += `&jibun=${encodeURIComponent(jibun)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("평수 조회 실패");
  return res.json();
}

export async function getTransactions(aptNm, lawdCd, area = "전체", months = 12, buildYear, umdNm, jibun) {
  let url = `${SERVER_URL}/api/apartment/transactions?lawdCd=${lawdCd}&area=${encodeURIComponent(area)}&months=${months}`;
  if (aptNm) url += `&aptNm=${encodeURIComponent(aptNm)}`;
  if (buildYear) url += `&buildYear=${buildYear}`;
  if (umdNm) url += `&umdNm=${encodeURIComponent(umdNm)}`;
  if (jibun) url += `&jibun=${encodeURIComponent(jibun)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("거래 조회 실패");
  return res.json();
}

export async function getAllTimePriceRange(lawdCd, aptNm, area, buildYear, umdNm, jibun) {
  let url = `${SERVER_URL}/api/apartment/alltime-price-range?lawdCd=${lawdCd}&area=${encodeURIComponent(area || "전체")}`;
  if (aptNm) url += `&aptNm=${encodeURIComponent(aptNm)}`;
  if (buildYear) url += `&buildYear=${buildYear}`;
  if (umdNm) url += `&umdNm=${encodeURIComponent(umdNm)}`;
  if (jibun) url += `&jibun=${encodeURIComponent(jibun)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("전체기간 조회 실패");
  return res.json();
}

export async function getRegionalAnalysis(lawdCd, umdNm, area, price, guNm = "") {
  const res = await fetch(`${SERVER_URL}/api/apartment/regional-analysis?lawdCd=${lawdCd}&umdNm=${encodeURIComponent(umdNm)}&area=${area}&price=${price}&guNm=${encodeURIComponent(guNm)}`);
  if (!res.ok) throw new Error("시세 분석 실패");
  return res.json();
}

export async function getRentTransactions(aptNm, lawdCd, area = "전체", months = 12, buildYear, umdNm, jibun) {
  let url = `${SERVER_URL}/api/apartment/rent?lawdCd=${lawdCd}&area=${encodeURIComponent(area)}&months=${months}`;
  if (aptNm) url += `&aptNm=${encodeURIComponent(aptNm)}`;
  if (buildYear) url += `&buildYear=${buildYear}`;
  if (umdNm) url += `&umdNm=${encodeURIComponent(umdNm)}`;
  if (jibun) url += `&jibun=${encodeURIComponent(jibun)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("전월세 조회 실패");
  return res.json();
}

export async function getComplexInfo(lawdCd, address, aptName, bjdongCd, jibun) {
  let url = `${SERVER_URL}/api/apartment/complex-info?lawdCd=${lawdCd}&address=${encodeURIComponent(address)}&aptName=${encodeURIComponent(aptName || "")}`;
  if (bjdongCd) url += `&bjdongCd=${bjdongCd}`;
  if (jibun) url += `&jibun=${encodeURIComponent(jibun)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "단지 정보 조회 실패");
  }
  return res.json();
}
