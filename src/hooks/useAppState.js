// src/hooks/useAppState.js
import { useState, useRef, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { DEFAULT_CRITERIA, generateId } from "../constants";

const LOCAL_KEY = "realestate_local_state";

export default function useAppState() {
  const [myId] = useState(() => generateId(6));

  // ── Local state ──────────────────────────────────────────────
  const [localCriteria,   setLocalCriteria]   = useState(DEFAULT_CRITERIA);
  const [localProperties, setLocalProperties] = useState([
    { id: 1, name: "매물 1", address: "", scores: {}, memo: "" },
  ]);

  // ── Shared state ─────────────────────────────────────────────
  const [sharedWith,      setSharedWith]      = useState(null);
  const [roomCode,        setRoomCode]        = useState(null);
  const [sharedCriteria,  setSharedCriteria]  = useState(DEFAULT_CRITERIA);
  const [sharedProperties,setSharedProperties]= useState([
    { id: 1, name: "매물 1", address: "", scores: {}, memo: "" },
  ]);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle|syncing|synced|error
  const [lastSyncTime, setLastSyncTime] = useState(null);

  const isSharing   = !!sharedWith;
  const criteria    = isSharing ? sharedCriteria   : localCriteria;
  const properties  = isSharing ? sharedProperties : localProperties;
  const setCriteria = isSharing ? setSharedCriteria   : setLocalCriteria;
  const setProperties = isSharing ? setSharedProperties : setLocalProperties;

  const unsubscribeRef = useRef(null);
  const lastWriteRef   = useRef(0);
  const nextPropId     = useRef(2);
  const nextCritId     = useRef(10);
  const pushTimer      = useRef(null);

  // ── Persist local state ──────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(LOCAL_KEY).then(raw => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        if (saved.criteria)   setLocalCriteria(saved.criteria);
        if (saved.properties) setLocalProperties(saved.properties);
      } catch {}
    });
  }, []);

  useEffect(() => {
    if (isSharing) return; // 공유 중엔 로컬 저장 건너뜀
    AsyncStorage.setItem(LOCAL_KEY, JSON.stringify({ criteria: localCriteria, properties: localProperties }));
  }, [localCriteria, localProperties, isSharing]);

  // ── Firebase helpers ─────────────────────────────────────────
  async function writeRoom(rc, crit, props) {
    try {
      lastWriteRef.current = Date.now();
      setSyncStatus("syncing");
      await setDoc(doc(db, "rooms", rc), {
        criteria: crit,
        properties: props,
        updatedBy: myId,
        updatedAt: Date.now(),
      });
      setSyncStatus("synced");
      setLastSyncTime(new Date());
    } catch (e) {
      setSyncStatus("error");
      console.error("Firebase write error:", e);
    }
  }

  function subscribeRoom(rc) {
    if (unsubscribeRef.current) unsubscribeRef.current();
    unsubscribeRef.current = onSnapshot(doc(db, "rooms", rc), snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      // 내가 방금 쓴 변경은 무시 (2.5초 내)
      if (data.updatedBy === myId && Date.now() - lastWriteRef.current < 2500) return;
      setSharedCriteria(data.criteria);
      setSharedProperties(data.properties);
      setLastSyncTime(new Date());
      setSyncStatus("synced");
    });
  }

  function stopSubscription() {
    if (unsubscribeRef.current) { unsubscribeRef.current(); unsubscribeRef.current = null; }
  }

  // ── Auto-push when shared state changes ──────────────────────
  useEffect(() => {
    if (!isSharing || !roomCode) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      writeRoom(roomCode, sharedCriteria, sharedProperties);
    }, 700);
  }, [sharedCriteria, sharedProperties]);

  useEffect(() => () => stopSubscription(), []);

  // ── Room actions ─────────────────────────────────────────────
  async function handleCreateRoom(targetId) {
    const rc = generateId(6);
    const initCrit  = JSON.parse(JSON.stringify(localCriteria));
    const initProps = JSON.parse(JSON.stringify(localProperties));
    setRoomCode(rc);
    setSharedWith(targetId);
    setSharedCriteria(initCrit);
    setSharedProperties(initProps);
    await writeRoom(rc, initCrit, initProps);
    subscribeRoom(rc);
  }

  async function handleJoinRoom(rc) {
    const { getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(db, "rooms", rc));
    if (snap.exists()) {
      const data = snap.data();
      setRoomCode(rc);
      setSharedWith(data.updatedBy || "상대방");
      setSharedCriteria(data.criteria);
      setSharedProperties(data.properties);
      subscribeRoom(rc);
      return true;
    }
    return false;
  }

  function handleLeaveRoom() {
    stopSubscription();
    // 공유 중 변경 내용을 로컬에 반영 (작업 연속성 유지)
    setLocalCriteria(JSON.parse(JSON.stringify(sharedCriteria)));
    setLocalProperties(JSON.parse(JSON.stringify(sharedProperties)));
    setSharedWith(null);
    setRoomCode(null);
    setSyncStatus("idle");
  }

  // ── Data mutations ────────────────────────────────────────────
  function setScore(propId, critId, val) {
    setProperties(ps => ps.map(p =>
      p.id === propId ? { ...p, scores: { ...p.scores, [critId]: val } } : p
    ));
  }

  function addProperty() {
    const id = nextPropId.current++;
    setProperties(ps => [...ps, { id, name: `매물 ${id}`, address: "", scores: {}, memo: "" }]);
    return id;
  }

  function removeProperty(id, currentSelectedId) {
    const remaining = properties.filter(p => p.id !== id);
    setProperties(remaining);
    return currentSelectedId === id && remaining.length > 0 ? remaining[0].id : currentSelectedId;
  }

  function updateProp(id, field, val) {
    setProperties(ps => ps.map(p => p.id === id ? { ...p, [field]: val } : p));
  }

  function addCriteria(name) {
    if (!name.trim()) return;
    setCriteria(cs => [...cs, {
      id: nextCritId.current++, name: name.trim(),
      weight: 3, description: "", hidden: false,
    }]);
  }

  function removeCriteria(id) { setCriteria(cs => cs.filter(c => c.id !== id)); }
  function toggleHidden(id)   { setCriteria(cs => cs.map(c => c.id === id ? { ...c, hidden: !c.hidden } : c)); }
  function updateCriteria(id, field, val) {
    setCriteria(cs => cs.map(c => c.id === id ? { ...c, [field]: val } : c));
  }

  return {
    myId,
    criteria, properties,
    isSharing, sharedWith, roomCode, syncStatus, lastSyncTime,
    handleCreateRoom, handleJoinRoom, handleLeaveRoom,
    setScore, addProperty, removeProperty, updateProp,
    addCriteria, removeCriteria, toggleHidden, updateCriteria,
  };
}
