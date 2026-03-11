// src/hooks/useAppState.js
import { useState, useRef, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { io } from "socket.io-client";
import SERVER_URL from "../api";
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

  const socketRef  = useRef(null);
  const pushTimer  = useRef(null);
  const nextPropId = useRef(2);
  const nextCritId = useRef(10);

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
    if (isSharing) return;
    AsyncStorage.setItem(LOCAL_KEY, JSON.stringify({ criteria: localCriteria, properties: localProperties }));
  }, [localCriteria, localProperties, isSharing]);

  // ── Socket helpers ─────────────────────────────────────────
  function connectSocket() {
    if (socketRef.current) return socketRef.current;
    const socket = io(SERVER_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("room-updated", ({ criteria: crit, properties: props, updatedBy }) => {
      setSharedCriteria(crit);
      setSharedProperties(props);
      setLastSyncTime(new Date());
      setSyncStatus("synced");
    });

    socket.on("room-closed", () => {
      handleLeaveRoom();
    });

    return socket;
  }

  function disconnectSocket() {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }

  // ── Auto-push when shared state changes ──────────────────────
  useEffect(() => {
    if (!isSharing || !roomCode || !socketRef.current) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      setSyncStatus("syncing");
      socketRef.current.emit("sync-data", {
        code: roomCode,
        criteria: sharedCriteria,
        properties: sharedProperties,
        updatedBy: myId,
      });
      setSyncStatus("synced");
      setLastSyncTime(new Date());
    }, 700);
  }, [sharedCriteria, sharedProperties]);

  useEffect(() => () => disconnectSocket(), []);

  // ── Room actions ─────────────────────────────────────────────
  async function handleCreateRoom(targetId) {
    try {
      const initCrit  = JSON.parse(JSON.stringify(localCriteria));
      const initProps = JSON.parse(JSON.stringify(localProperties));

      const res = await fetch(`${SERVER_URL}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorId: myId,
          partnerId: targetId,
          criteria: initCrit,
          properties: initProps,
        }),
      });
      const { code } = await res.json();

      setRoomCode(code);
      setSharedWith(targetId);
      setSharedCriteria(initCrit);
      setSharedProperties(initProps);

      const socket = connectSocket();
      socket.emit("join-room", code);
    } catch (e) {
      console.error("방 생성 실패:", e);
    }
  }

  async function handleJoinRoom(code) {
    try {
      const res = await fetch(`${SERVER_URL}/api/rooms/${code}`);
      if (!res.ok) return false;

      const data = await res.json();
      setRoomCode(code);
      setSharedWith(data.creatorId || "상대방");
      setSharedCriteria(data.criteria);
      setSharedProperties(data.properties);

      const socket = connectSocket();
      socket.emit("join-room", code);
      return true;
    } catch (e) {
      console.error("방 입장 실패:", e);
      return false;
    }
  }

  function handleLeaveRoom() {
    if (socketRef.current && roomCode) {
      socketRef.current.emit("leave-room", roomCode);
    }
    disconnectSocket();
    // 공유 중 변경 내용을 로컬에 반영
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
