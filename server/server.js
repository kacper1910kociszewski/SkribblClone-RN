// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

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

// ===== SOCKET EVENTS =====
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // 1. Join room — send full history (strokes + chat)
  socket.on("join-room", async (roomCode) => {
    console.log("join-room received:", roomCode);
    socket.join(roomCode);
    await ensureRoom(roomCode);

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
  });

  // 2. Completed stroke — save to DB, broadcast
  socket.on("draw", async ({ path, roomCode }) => {
    console.log("draw received for room:", roomCode);
    await pool.query(
      `INSERT INTO strokes (room_code, path) VALUES ($1, $2)`,
      [roomCode, path]
    );
    socket.to(roomCode).emit("remote-draw", path);
  });

  // 3. Live stroke (not saved — just broadcast)
  socket.on("mid-draw", ({ path, roomCode }) => {
    socket.to(roomCode).emit("remote-mid-draw", { path, userId: socket.id });
  });

  // 4. Clear canvas — delete strokes from DB
  socket.on("clear-canvas", async (roomCode) => {
    await pool.query(`DELETE FROM strokes WHERE room_code = $1`, [roomCode]);
    io.to(roomCode).emit("clear-canvas");
  });

  // 5. Chat message — save to DB, broadcast
  socket.on("chat-message", async ({ roomCode, username, message }) => {
    console.log("chat-message received:", { roomCode, username, message });
    if (!message?.trim()) return;
    const { rows } = await pool.query(
      `INSERT INTO chat_messages (room_code, username, message)
       VALUES ($1, $2, $3) RETURNING created_at`,
      [roomCode, username, message.trim()]
    );
    const payload = { username, message: message.trim(), created_at: rows[0].created_at };
    io.to(roomCode).emit("remote-chat", payload); // broadcast to everyone including sender
  });

  socket.on("disconnect", () => console.log("Disconnected:", socket.id));
});

server.listen(3000, "0.0.0.0", () => console.log("Server on port 3000"));