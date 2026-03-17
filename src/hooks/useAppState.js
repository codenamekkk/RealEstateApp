// src/hooks/useAppState.js
import { useState, useRef, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { io } from "socket.io-client";
import SERVER_URL from "../api";
import { DEFAULT_CRITERIA, generateId } from "../constants";

const LOCAL_KEY = "realestate_local_state";
const USER_KEY = "realestate_user";

export default function useAppState() {
  // ── User identity ──────────────────────────────────────────
  const [myId, setMyId] = useState(null);
  const [nickname, setNickname] = useState("");

  // ── Local state ────────────────────────────────────────────
  const [localCriteria, setLocalCriteria] = useState(DEFAULT_CRITERIA);
  const [localProperties, setLocalProperties] = useState([
    { id: 1, name: "매물 1", address: "", price: "", scores: {}, memo: "",
      lawdCd: null, umdNm: null, guNm: null, buildYear: null, area: null, selectedArea: null,
      recentPrice: null, highestPrice: null, regionAvg: null, dongAvg: null,
      pricePercentile: null, dongPercentile: null,
      dongSummary: [], transactionHistory: [], neighborComparison: [],
      complexInfo: null },
  ]);

  // ── Sharing state ──────────────────────────────────────────
  const [incomingRequests, setIncomingRequests] = useState([]); // pending requests to me
  const [sharingList, setSharingList] = useState([]);           // people viewing my data
  const [receivingList, setReceivingList] = useState([]);       // people whose data I view

  const socketRef = useRef(null);
  const pushTimer = useRef(null);
  const nextPropId = useRef(2);
  const nextCritId = useRef(10);
  const myIdRef = useRef(null);
  const initialLoadDone = useRef(false);

  // ── Initialize user ────────────────────────────────────────
  useEffect(() => {
    (async () => {
      // Load saved user info
      const savedUser = await AsyncStorage.getItem(USER_KEY);
      let userId, userNickname;

      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        userId = parsed.id;
        userNickname = parsed.nickname;
      } else {
        userId = generateId(6);
        userNickname = `사용자_${userId.slice(0, 3)}`;
        await AsyncStorage.setItem(USER_KEY, JSON.stringify({ id: userId, nickname: userNickname }));
      }

      setMyId(userId);
      setNickname(userNickname);
      myIdRef.current = userId;

      // Load local data first (오프라인 퍼스트)
      const raw = await AsyncStorage.getItem(LOCAL_KEY);
      if (raw) {
        try {
          const saved = JSON.parse(raw);
          if (saved.criteria) setLocalCriteria(saved.criteria);
          if (saved.properties) {
            setLocalProperties(saved.properties);
            const maxId = saved.properties.reduce((m, p) => Math.max(m, p.id), 0);
            nextPropId.current = maxId + 1;
          }
          if (saved.nextCritId) nextCritId.current = saved.nextCritId;
        } catch {}
      }

      initialLoadDone.current = true;

      // Register on server (네트워크 작업은 백그라운드로)
      const registerUser = (retries = 1) => {
        fetch(`${SERVER_URL}/api/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: userId, nickname: userNickname }),
        }).catch(e => {
          console.warn("서버 등록 실패:", e.message);
          if (retries > 0) {
            setTimeout(() => registerUser(retries - 1), 3000);
          }
        });
      };
      registerUser();

      // Connect socket
      connectSocket(userId);

      // Fetch share lists
      fetchShareLists(userId);
    })();

    return () => disconnectSocket();
  }, []);

  // ── Persist local state ────────────────────────────────────
  useEffect(() => {
    if (!myId || !initialLoadDone.current) return;
    AsyncStorage.setItem(LOCAL_KEY, JSON.stringify({
      criteria: localCriteria,
      properties: localProperties,
      nextCritId: nextCritId.current,
    })).catch(e => console.warn("로컬 데이터 저장 실패:", e.message));
  }, [localCriteria, localProperties, myId]);

  // ── Sync data to server when local data changes ────────────
  useEffect(() => {
    if (!myId || !initialLoadDone.current) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      fetch(`${SERVER_URL}/api/users/${myId}/data`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ criteria: localCriteria, properties: localProperties }),
      }).catch(() => {});
    }, 1000);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [localCriteria, localProperties, myId]);

  // ── Socket ─────────────────────────────────────────────────
  function connectSocket(userId) {
    if (socketRef.current) return;
    const socket = io(SERVER_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("register", userId);
    });

    // Someone sent me a share request
    socket.on("new-share-request", ({ fromId, fromNickname }) => {
      setIncomingRequests(prev => {
        if (prev.some(r => r.from_id === fromId)) return prev;
        return [{ from_id: fromId, from_nickname: fromNickname, status: "pending" }, ...prev];
      });
    });

    // My share request was approved/rejected
    socket.on("share-request-result", ({ requestId, toId, toNickname, status }) => {
      if (status === "approved") {
        setReceivingList(prev => {
          if (prev.some(r => r.to_id === toId)) return prev;
          return [...prev, { id: requestId, to_id: toId, to_nickname: toNickname }];
        });
      }
      // Refresh lists to get accurate data
      if (myIdRef.current) fetchShareLists(myIdRef.current);
    });

    // Shared data updated by someone I'm receiving from
    socket.on("shared-data-updated", ({ userId: updatedUserId, criteria, properties }) => {
      // This will be handled by the SharedDataViewer component
      // We emit a custom event or use a callback
    });
  }

  function disconnectSocket() {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }

  // ── Fetch share lists from server ──────────────────────────
  async function fetchShareLists(userId) {
    try {
      const [inRes, sharingRes, receivingRes] = await Promise.all([
        fetch(`${SERVER_URL}/api/share-requests/incoming/${userId}`),
        fetch(`${SERVER_URL}/api/shares/sharing/${userId}`),
        fetch(`${SERVER_URL}/api/shares/receiving/${userId}`),
      ]);
      if (inRes.ok) setIncomingRequests(await inRes.json());
      if (sharingRes.ok) setSharingList(await sharingRes.json());
      if (receivingRes.ok) setReceivingList(await receivingRes.json());
    } catch (e) {
      console.log("공유 목록 조회 실패:", e.message);
    }
  }

  // ── Share actions ──────────────────────────────────────────
  async function sendShareRequest(targetId) {
    try {
      const res = await fetch(`${SERVER_URL}/api/share-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromId: myId, toId: targetId }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error };
      return { ok: true, targetNickname: data.targetNickname };
    } catch (e) {
      return { ok: false, error: "서버 연결 실패" };
    }
  }

  async function respondShareRequest(requestId, status) {
    try {
      const res = await fetch(`${SERVER_URL}/api/share-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      await fetchShareLists(myId);
    } catch (e) {
      console.log("공유 응답 실패:", e.message);
    }
  }

  async function removeShare(requestId) {
    try {
      const res = await fetch(`${SERVER_URL}/api/share-requests/${requestId}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      await fetchShareLists(myId);
    } catch (e) {
      console.log("공유 삭제 실패:", e.message);
    }
  }

  async function fetchSharedData(targetId) {
    try {
      const res = await fetch(
        `${SERVER_URL}/api/users/${targetId}/shared-data?requesterId=${myId}`
      );
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function updateNickname(newNickname) {
    setNickname(newNickname);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify({ id: myId, nickname: newNickname }));
    try {
      await fetch(`${SERVER_URL}/api/users/${myId}/nickname`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: newNickname }),
      });
    } catch {}
  }

  const refreshShareLists = useCallback(() => {
    if (myId) fetchShareLists(myId);
  }, [myId]);

  // ── Data mutations ─────────────────────────────────────────
  function setScore(propId, critId, val) {
    setLocalProperties(ps => ps.map(p =>
      p.id === propId ? { ...p, scores: { ...p.scores, [critId]: val } } : p
    ));
  }

  function addProperty() {
    const id = nextPropId.current++;
    setLocalProperties(ps => {
      const num = ps.length + 1;
      return [...ps, {
        id, name: `매물 ${num}`, address: "", price: "", scores: {}, memo: "",
        lawdCd: null, umdNm: null, guNm: null, buildYear: null, area: null, selectedArea: null,
        recentPrice: null, highestPrice: null, regionAvg: null, dongAvg: null,
        pricePercentile: null, dongPercentile: null,
        dongSummary: [], transactionHistory: [], neighborComparison: [],
        complexInfo: null,
      }];
    });
    return id;
  }

  function removeProperty(id, currentSelectedId) {
    let nextId = currentSelectedId;
    setLocalProperties(ps => {
      const remaining = ps.filter(p => p.id !== id);
      if (currentSelectedId === id && remaining.length > 0) {
        nextId = remaining[0].id;
      }
      return remaining;
    });
    return nextId;
  }

  function updateProp(id, field, val) {
    setLocalProperties(ps => ps.map(p => p.id === id ? { ...p, [field]: val } : p));
  }

  function addCriteria(name) {
    if (!name.trim()) return;
    setLocalCriteria(cs => [...cs, {
      id: nextCritId.current++, name: name.trim(),
      weight: 3, description: "", hidden: false,
    }]);
  }

  function removeCriteria(id) { setLocalCriteria(cs => cs.filter(c => c.id !== id)); }
  function toggleHidden(id) { setLocalCriteria(cs => cs.map(c => c.id === id ? { ...c, hidden: !c.hidden } : c)); }
  function updateCriteria(id, field, val) {
    setLocalCriteria(cs => cs.map(c => c.id === id ? { ...c, [field]: val } : c));
  }

  return {
    myId, nickname, updateNickname,
    criteria: localCriteria,
    properties: localProperties,
    // Share state
    incomingRequests, sharingList, receivingList,
    sendShareRequest, respondShareRequest, removeShare,
    fetchSharedData, refreshShareLists,
    // Data mutations
    setScore, addProperty, removeProperty, updateProp,
    addCriteria, removeCriteria, toggleHidden, updateCriteria,
  };
}
