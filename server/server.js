// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const ROOM_PHASE = {
  WAITING: "waiting",
  CHOOSING: "choosing",
  DRAWING: "drawing",
};

const CHOOSE_SECONDS = 10;
const DRAW_SECONDS = 90;
const NEXT_ROUND_DELAY_MS = 3000;
const DEFAULT_MAX_ROUNDS = 10;

const WORD_BANK = [
  "avalanche",
  "compass",
  "castle",
  "microscope",
  "pyramid",
  "rainforest",
  "volcano",
  "telescope",
  "lightning",
  "passport",
  "spaceship",
  "sandwich",
  "waterfall",
  "backpack",
  "fireworks",
  "kangaroo",
  "suitcase",
  "lighthouse",
  "chameleon",
  "skateboard",
];

const runtimeRooms = new Map();

// --- DB connection ---
require('dotenv').config();
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  port: 5432,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Helper: ensure room exists in DB
async function ensureRoom(roomCode) {
  await pool.query(
    `INSERT INTO rooms (code) VALUES ($1) ON CONFLICT DO NOTHING`,
    [roomCode]
  );
}

function normalizeRoomCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeUsername(value) {
  const fallback = "Player";
  const clean = String(value || "").trim();
  return clean.length > 0 ? clean.slice(0, 20) : fallback;
}

function normalizeStrokeStyle(payload) {
  const color = typeof payload?.color === "string" && payload.color.trim().length > 0
    ? payload.color.trim()
    : "#000000";
  const rawWidth = Number(payload?.strokeWidth);
  const strokeWidth = Number.isFinite(rawWidth) ? Math.min(Math.max(rawWidth, 1), 48) : 5;
  const tool = payload?.tool === "eraser" ? "eraser" : "pen";
  return { color, strokeWidth, tool };
}

function normalizeRounds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_ROUNDS;
  return Math.min(Math.max(Math.floor(parsed), 1), 30);
}

function maskWord(word) {
  return word.replace(/[A-Za-z0-9]/g, "_");
}

function buildMaskedWord(word, revealedIndexes = new Set()) {
  return word
    .split("")
    .map((char, index) => {
      if (!/[A-Za-z0-9]/.test(char)) return char;
      if (revealedIndexes.has(index)) return char.toUpperCase();
      return "_";
    })
    .join("");
}

function pickWordOptions(count = 3) {
  const poolWords = [...WORD_BANK];
  for (let i = poolWords.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [poolWords[i], poolWords[j]] = [poolWords[j], poolWords[i]];
  }
  return poolWords.slice(0, Math.min(count, poolWords.length));
}

function getOrCreateRuntimeRoom(roomCode) {
  if (!runtimeRooms.has(roomCode)) {
    runtimeRooms.set(roomCode, {
      players: [],
      scores: {},
      matchActive: false,
      currentRound: 0,
      maxRounds: DEFAULT_MAX_ROUNDS,
      drawerIndex: 0,
      phase: ROOM_PHASE.WAITING,
      currentWord: null,
      wordOptions: [],
      revealedIndexes: new Set(),
      hintsRevealed: 0,
      choosingTimeout: null,
      phaseInterval: null,
      phaseTimeout: null,
      nextRoundTimeout: null,
    });
  }
  return runtimeRooms.get(roomCode);
}

function getDrawer(roomState) {
  if (!roomState || roomState.players.length === 0) return null;
  if (roomState.drawerIndex >= roomState.players.length) {
    roomState.drawerIndex = 0;
  }
  return roomState.players[roomState.drawerIndex] || null;
}

function emitRoomState(roomCode) {
  const roomState = runtimeRooms.get(roomCode);
  const drawer = getDrawer(roomState);
  io.to(roomCode).emit("room-state", {
    players: roomState ? roomState.players.map((p) => p.username) : [],
    scores: roomState
      ? roomState.players.map((p) => ({
        username: p.username,
        points: roomState.scores[p.username] || 0,
      }))
      : [],
    matchActive: roomState ? roomState.matchActive : false,
    currentRound: roomState ? roomState.currentRound : 0,
    maxRounds: roomState ? roomState.maxRounds : DEFAULT_MAX_ROUNDS,
    drawerSocketId: drawer ? drawer.socketId : null,
    drawerUsername: drawer ? drawer.username : null,
    phase: roomState && roomState.players.length > 0 ? roomState.phase : ROOM_PHASE.WAITING,
  });
}

function buildStandings(roomState) {
  if (!roomState) return [];
  return roomState.players
    .map((player) => ({
      username: player.username,
      points: roomState.scores[player.username] || 0,
    }))
    .sort((a, b) => b.points - a.points || a.username.localeCompare(b.username));
}

function emitRoundStart(roomCode) {
  const roomState = runtimeRooms.get(roomCode);
  const drawer = getDrawer(roomState);
  if (!roomState || !drawer || !roomState.currentWord) return;

  roomState.players.forEach((player) => {
    const displayWord = player.socketId === drawer.socketId
      ? roomState.currentWord
      : buildMaskedWord(roomState.currentWord, roomState.revealedIndexes);
    io.to(player.socketId).emit("round-start", { displayWord });
  });
}

function revealRandomLetter(roomCode) {
  const roomState = runtimeRooms.get(roomCode);
  if (!roomState || !roomState.currentWord) return;

  const hiddenIndexes = roomState.currentWord
    .split("")
    .map((char, index) => ({ char, index }))
    .filter(({ char, index }) => /[A-Za-z0-9]/.test(char) && !roomState.revealedIndexes.has(index))
    .map(({ index }) => index);

  if (hiddenIndexes.length === 0) return;

  const randomIndex = hiddenIndexes[Math.floor(Math.random() * hiddenIndexes.length)];
  roomState.revealedIndexes.add(randomIndex);

  const drawer = getDrawer(roomState);
  if (!drawer) return;

  const maskedWord = buildMaskedWord(roomState.currentWord, roomState.revealedIndexes);
  roomState.players.forEach((player) => {
    if (player.socketId === drawer.socketId) return;
    io.to(player.socketId).emit("round-word-update", { displayWord: maskedWord });
  });
}

function clearRoomTimers(roomState) {
  if (!roomState) return;
  if (roomState.choosingTimeout) {
    clearTimeout(roomState.choosingTimeout);
    roomState.choosingTimeout = null;
  }
  if (roomState.phaseInterval) {
    clearInterval(roomState.phaseInterval);
    roomState.phaseInterval = null;
  }
  if (roomState.phaseTimeout) {
    clearTimeout(roomState.phaseTimeout);
    roomState.phaseTimeout = null;
  }
  if (roomState.nextRoundTimeout) {
    clearTimeout(roomState.nextRoundTimeout);
    roomState.nextRoundTimeout = null;
  }
}

function startPhaseTimer(roomCode, phase, seconds, onEnd, onTick) {
  const roomState = runtimeRooms.get(roomCode);
  if (!roomState) return;

  if (roomState.phaseInterval) {
    clearInterval(roomState.phaseInterval);
    roomState.phaseInterval = null;
  }
  if (roomState.phaseTimeout) {
    clearTimeout(roomState.phaseTimeout);
    roomState.phaseTimeout = null;
  }

  const endAt = Date.now() + (seconds * 1000);
  const emitTimer = () => {
    const secondsLeft = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    io.to(roomCode).emit("timer-update", { phase, secondsLeft });
    if (typeof onTick === "function") {
      onTick(secondsLeft);
    }
  };

  emitTimer();
  roomState.phaseInterval = setInterval(emitTimer, 1000);
  roomState.phaseTimeout = setTimeout(() => {
    if (roomState.phaseInterval) {
      clearInterval(roomState.phaseInterval);
      roomState.phaseInterval = null;
    }
    roomState.phaseTimeout = null;
    onEnd();
  }, seconds * 1000);
}

async function clearCanvasForNewRound(roomCode) {
  await pool.query(`DELETE FROM strokes WHERE room_code = $1`, [roomCode]);
  io.to(roomCode).emit("clear-canvas");
}

function rotateDrawer(roomState) {
  if (!roomState || roomState.players.length === 0) return;
  roomState.drawerIndex = (roomState.drawerIndex + 1) % roomState.players.length;
}

function setRoomWaiting(roomCode) {
  const roomState = runtimeRooms.get(roomCode);
  if (!roomState) return;

  clearRoomTimers(roomState);
  roomState.phase = ROOM_PHASE.WAITING;
  roomState.currentWord = null;
  roomState.wordOptions = [];
  roomState.revealedIndexes = new Set();
  roomState.hintsRevealed = 0;

  emitRoomState(roomCode);
  io.to(roomCode).emit("timer-update", { phase: ROOM_PHASE.WAITING, secondsLeft: 0 });
  io.to(roomCode).emit("round-start", { displayWord: "" });
}

function endMatch(roomCode, reason = "round-limit") {
  const roomState = runtimeRooms.get(roomCode);
  if (!roomState) return;

  clearRoomTimers(roomState);
  roomState.matchActive = false;
  roomState.phase = ROOM_PHASE.WAITING;
  roomState.currentWord = null;
  roomState.wordOptions = [];
  roomState.revealedIndexes = new Set();
  roomState.hintsRevealed = 0;

  const standings = buildStandings(roomState);
  const topScore = standings.length > 0 ? standings[0].points : 0;
  const winners = standings.filter((s) => s.points === topScore).map((s) => s.username);

  emitRoomState(roomCode);
  io.to(roomCode).emit("match-ended", {
    reason,
    standings,
    currentRound: roomState.currentRound,
    maxRounds: roomState.maxRounds,
    winners,
  });
  io.to(roomCode).emit("timer-update", { phase: ROOM_PHASE.WAITING, secondsLeft: 0 });
}

function startMatch(roomCode, requestedMaxRounds = DEFAULT_MAX_ROUNDS) {
  const roomState = runtimeRooms.get(roomCode);
  if (!roomState) return;
  if (roomState.players.length < 2) {
    setRoomWaiting(roomCode);
    return;
  }

  roomState.maxRounds = normalizeRounds(requestedMaxRounds);
  roomState.currentRound = 0;
  roomState.matchActive = true;
  roomState.scores = {};
  roomState.players.forEach((player) => {
    roomState.scores[player.username] = 0;
  });

  if (roomState.drawerIndex >= roomState.players.length) {
    roomState.drawerIndex = 0;
  }

  emitRoomState(roomCode);
  startWordChoosing(roomCode);
}

function finishRound(roomCode, outcome) {
  const roomState = runtimeRooms.get(roomCode);
  if (!roomState || !roomState.currentWord) return;

  clearRoomTimers(roomState);

  const revealedWord = roomState.currentWord;
  if (outcome?.winnerUsername) {
    roomState.scores[outcome.winnerUsername] = (roomState.scores[outcome.winnerUsername] || 0) + 1;
  }
  roomState.currentRound += 1;
  roomState.phase = ROOM_PHASE.WAITING;
  roomState.wordOptions = [];
  roomState.currentWord = null;

  emitRoomState(roomCode);
  io.to(roomCode).emit("round-end", {
    word: revealedWord,
    winnerUsername: outcome?.winnerUsername || null,
    reason: outcome?.reason || "time-up",
    currentRound: roomState.currentRound,
    maxRounds: roomState.maxRounds,
  });

  if (roomState.matchActive && roomState.currentRound >= roomState.maxRounds) {
    endMatch(roomCode, "round-limit");
    return;
  }

  if (roomState.players.length < 2) {
    setRoomWaiting(roomCode);
    return;
  }

  rotateDrawer(roomState);
  roomState.nextRoundTimeout = setTimeout(() => {
    roomState.nextRoundTimeout = null;
    if (!runtimeRooms.has(roomCode)) return;
    startWordChoosing(roomCode);
  }, NEXT_ROUND_DELAY_MS);
}

function startWordChoosing(roomCode) {
  const roomState = runtimeRooms.get(roomCode);
  if (!roomState || !roomState.matchActive) {
    setRoomWaiting(roomCode);
    return;
  }
  if (!roomState || roomState.players.length < 2) {
    setRoomWaiting(roomCode);
    return;
  }

  const drawer = getDrawer(roomState);
  if (!drawer) return;

  clearRoomTimers(roomState);

  roomState.phase = ROOM_PHASE.CHOOSING;
  roomState.currentWord = null;
  roomState.wordOptions = pickWordOptions(3);
  roomState.revealedIndexes = new Set();
  roomState.hintsRevealed = 0;

  emitRoomState(roomCode);
  io.to(roomCode).emit("round-start", { displayWord: "" });
  io.to(drawer.socketId).emit("word-options", roomState.wordOptions);

  startPhaseTimer(roomCode, ROOM_PHASE.CHOOSING, CHOOSE_SECONDS, () => {
    const latestState = runtimeRooms.get(roomCode);
    const latestDrawer = getDrawer(latestState);
    if (!latestState || !latestDrawer) return;
    if (latestState.phase !== ROOM_PHASE.CHOOSING) return;
    const fallbackWord = latestState.wordOptions[Math.floor(Math.random() * latestState.wordOptions.length)];
    if (!fallbackWord) return;
    startRound(roomCode, fallbackWord);
  });
}

async function startRound(roomCode, chosenWord) {
  const roomState = runtimeRooms.get(roomCode);
  if (!roomState) return;
  if (!roomState.matchActive) {
    setRoomWaiting(roomCode);
    return;
  }
  if (roomState.players.length < 2) {
    setRoomWaiting(roomCode);
    return;
  }

  clearRoomTimers(roomState);

  roomState.phase = ROOM_PHASE.DRAWING;
  roomState.currentWord = chosenWord;
  roomState.wordOptions = [];
  roomState.revealedIndexes = new Set();
  roomState.hintsRevealed = 0;

  await clearCanvasForNewRound(roomCode);

  emitRoomState(roomCode);
  emitRoundStart(roomCode);

  startPhaseTimer(roomCode, ROOM_PHASE.DRAWING, DRAW_SECONDS, () => {
    finishRound(roomCode, { reason: "time-up" });
  }, (secondsLeft) => {
    if (roomState.hintsRevealed < 1 && secondsLeft <= 65) {
      revealRandomLetter(roomCode);
      roomState.hintsRevealed = 1;
    }
    if (roomState.hintsRevealed < 2 && secondsLeft <= 45) {
      revealRandomLetter(roomCode);
      roomState.hintsRevealed = 2;
    }
  });
}

function isCurrentDrawer(socketId, roomCode) {
  const roomState = runtimeRooms.get(roomCode);
  const drawer = getDrawer(roomState);
  return Boolean(drawer && drawer.socketId === socketId);
}

function isUsernameTaken(serverUsername, currentSocketId) {
  const target = String(serverUsername || "").trim().toLowerCase();
  if (!target) return false;

  for (const roomState of runtimeRooms.values()) {
    const exists = roomState.players.some((player) => {
      if (player.socketId === currentSocketId) return false;
      return String(player.username || "").trim().toLowerCase() === target;
    });
    if (exists) return true;
  }

  return false;
}

function removePlayerFromRuntimeRooms(socketId) {
  for (const [roomCode, roomState] of runtimeRooms.entries()) {
    const removedIndex = roomState.players.findIndex((p) => p.socketId === socketId);
    if (removedIndex === -1) continue;

    const wasDrawer = removedIndex === roomState.drawerIndex;
    const removedPlayer = roomState.players[removedIndex];
    roomState.players.splice(removedIndex, 1);
    if (removedPlayer) {
      delete roomState.scores[removedPlayer.username];
    }

    if (roomState.players.length === 0) {
      clearRoomTimers(roomState);
      runtimeRooms.delete(roomCode);
      return;
    }

    if (roomState.players.length < 2) {
      setRoomWaiting(roomCode);
      return;
    }

    if (removedIndex < roomState.drawerIndex) {
      roomState.drawerIndex -= 1;
    }

    if (roomState.drawerIndex >= roomState.players.length) {
      roomState.drawerIndex = 0;
    }

    if (wasDrawer) {
      startWordChoosing(roomCode);
    } else {
      emitRoomState(roomCode);
    }

    return;
  }
}

// ===== SOCKET EVENTS =====
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // Check if a room exists (has been used before)
  socket.on("check-room", async (roomCode) => {
    const { rows } = await pool.query(
      `SELECT code FROM rooms WHERE code = $1`,
      [roomCode]
    );
    socket.emit("room-exists", rows.length > 0);
  });

  socket.on("check-username", (username) => {
    const cleanUsername = normalizeUsername(username);
    const taken = isUsernameTaken(cleanUsername, socket.id);
    socket.emit("username-check-result", { taken });
  });

  // 1. Join room — send full history (strokes + chat)
  socket.on("join-room", async (payload) => {
    const roomCode = normalizeRoomCode(
      typeof payload === "string" ? payload : payload?.roomCode
    );
    const username = normalizeUsername(
      typeof payload === "string" ? "Player" : payload?.username
    );
    if (!roomCode) return;

    if (isUsernameTaken(username, socket.id)) {
      socket.emit("join-error", {
        code: "USERNAME_TAKEN",
        message: `Nickname \"${username}\" is already in use. Choose another one.`,
      });
      return;
    }

    console.log("join-room received:", roomCode, username);
    socket.data.roomCode = roomCode;
    socket.data.username = username;

    socket.join(roomCode);
    await ensureRoom(roomCode);

    const roomState = getOrCreateRuntimeRoom(roomCode);
    const alreadyInRoom = roomState.players.some((p) => p.socketId === socket.id);
    if (!alreadyInRoom) {
      roomState.players.push({ socketId: socket.id, username });
      if (typeof roomState.scores[username] !== "number") {
        roomState.scores[username] = 0;
      }
      if (roomState.players.length === 1) {
        roomState.drawerIndex = 0;
      }
    }

    // Load canvas history
    const { rows: strokes } = await pool.query(
      `SELECT path FROM strokes WHERE room_code = $1 ORDER BY created_at ASC`,
      [roomCode]
    );

    // Load chat history (last 50 messages)
    const { rows: messages } = await pool.query(
      `SELECT username, message, created_at FROM chat_messages
       WHERE room_code = $1 ORDER BY created_at ASC LIMIT 50`,
      [roomCode]
    );

    socket.emit("canvas-history", strokes.map(r => r.path));
    socket.emit("chat-history", messages);

    emitRoomState(roomCode);

    if (roomState.phase === ROOM_PHASE.DRAWING && roomState.currentWord) {
      const drawer = getDrawer(roomState);
      const displayWord = drawer && drawer.socketId === socket.id
        ? roomState.currentWord
        : buildMaskedWord(roomState.currentWord, roomState.revealedIndexes);
      socket.emit("round-start", { displayWord });
      return;
    }

    if (roomState.phase === ROOM_PHASE.CHOOSING && roomState.wordOptions.length > 0) {
      const drawer = getDrawer(roomState);
      if (drawer && drawer.socketId === socket.id) {
        socket.emit("word-options", roomState.wordOptions);
      }
      return;
    }

    if (roomState.players.length >= 2 && roomState.matchActive && roomState.currentRound < roomState.maxRounds) {
      startWordChoosing(roomCode);
    } else {
      setRoomWaiting(roomCode);
    }
  });

  socket.on("start-match", ({ roomCode, maxRounds }) => {
    const cleanRoomCode = normalizeRoomCode(roomCode);
    if (!cleanRoomCode) return;
    const roomState = runtimeRooms.get(cleanRoomCode);
    if (!roomState) return;
    const isInRoom = roomState.players.some((p) => p.socketId === socket.id);
    if (!isInRoom) return;

    startMatch(cleanRoomCode, maxRounds);
  });

  socket.on("stop-match", ({ roomCode }) => {
    const cleanRoomCode = normalizeRoomCode(roomCode);
    if (!cleanRoomCode) return;
    const roomState = runtimeRooms.get(cleanRoomCode);
    if (!roomState) return;
    const isInRoom = roomState.players.some((p) => p.socketId === socket.id);
    if (!isInRoom) return;

    endMatch(cleanRoomCode, "stopped");
  });

  socket.on("choose-word", async ({ roomCode, word }) => {
    const cleanRoomCode = normalizeRoomCode(roomCode);
    const chosenWord = String(word || "").trim().toLowerCase();
    const roomState = runtimeRooms.get(cleanRoomCode);
    if (!roomState) return;
    if (roomState.phase !== ROOM_PHASE.CHOOSING) return;
    if (!isCurrentDrawer(socket.id, cleanRoomCode)) return;
    if (!roomState.wordOptions.includes(chosenWord)) return;

    await startRound(cleanRoomCode, chosenWord);
  });

  // 2. Completed stroke — save to DB, broadcast
  socket.on("draw", async (payload) => {
    const { path, roomCode } = payload || {};
    const cleanRoomCode = normalizeRoomCode(roomCode);
    if (!isCurrentDrawer(socket.id, cleanRoomCode)) return;
    const cleanPath = String(path || "").trim();
    if (!cleanPath) return;
    const style = normalizeStrokeStyle(payload);
    const serializedStroke = JSON.stringify({ path: cleanPath, ...style });

    console.log("draw received for room:", roomCode);
    await pool.query(
      `INSERT INTO strokes (room_code, path) VALUES ($1, $2)`,
      [cleanRoomCode, serializedStroke]
    );
    socket.to(cleanRoomCode).emit("remote-draw", { path: cleanPath, ...style });
  });

  // 3. Live stroke (not saved — just broadcast)
  socket.on("mid-draw", (payload) => {
    const { path, roomCode } = payload || {};
    const cleanRoomCode = normalizeRoomCode(roomCode);
    if (!isCurrentDrawer(socket.id, cleanRoomCode)) return;
    const cleanPath = String(path || "").trim();
    if (!cleanPath) return;
    const style = normalizeStrokeStyle(payload);
    socket.to(cleanRoomCode).emit("remote-mid-draw", { path: cleanPath, ...style, userId: socket.id });
  });

  // 4. Clear canvas — delete strokes from DB
  socket.on("clear-canvas", async (roomCode) => {
    const cleanRoomCode = normalizeRoomCode(roomCode);
    if (!isCurrentDrawer(socket.id, cleanRoomCode)) return;
    await pool.query(`DELETE FROM strokes WHERE room_code = $1`, [cleanRoomCode]);
    io.to(cleanRoomCode).emit("clear-canvas");
  });

  // 5. Chat message — save to DB, broadcast
  socket.on("chat-message", async ({ roomCode, username, message }) => {
    const cleanRoomCode = normalizeRoomCode(roomCode);
    const cleanUsername = normalizeUsername(username);
    const cleanMessage = String(message || "").trim();
    if (!cleanMessage) return;

    const roomState = runtimeRooms.get(cleanRoomCode);
    if (roomState && roomState.phase === ROOM_PHASE.DRAWING && roomState.currentWord) {
      const isDrawer = isCurrentDrawer(socket.id, cleanRoomCode);
      if (isDrawer) return;
      const isCorrectGuess = cleanMessage.toLowerCase() === roomState.currentWord.toLowerCase();
      if (isCorrectGuess) {
        io.to(cleanRoomCode).emit("remote-chat", {
          username: "System",
          message: `${cleanUsername} guessed the word!`,
          created_at: new Date().toISOString(),
        });
        finishRound(cleanRoomCode, { reason: "guessed", winnerUsername: cleanUsername });
        return;
      }
    }

    console.log("chat-message received:", { roomCode: cleanRoomCode, username: cleanUsername, message: cleanMessage });
    const { rows } = await pool.query(
      `INSERT INTO chat_messages (room_code, username, message)
       VALUES ($1, $2, $3) RETURNING created_at`,
      [cleanRoomCode, cleanUsername, cleanMessage]
    );
    const payload = { username: cleanUsername, message: cleanMessage, created_at: rows[0].created_at };
    io.to(cleanRoomCode).emit("remote-chat", payload); // broadcast to everyone including sender
  });

  socket.on("disconnect", () => {
    removePlayerFromRuntimeRooms(socket.id);
    console.log("Disconnected:", socket.id);
  });
});

server.listen(3000, "0.0.0.0", () => console.log("Server on port 3000"));
