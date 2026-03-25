const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } 
});

// Memory to store drawings for each room
const roomsData = {};

///=================================================\
//|           SOCKET CONNECTION HANDLER             |
//\=================================================/
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // 1. Join Room & Send History
  socket.on("join-room", (roomCode) => {
    socket.join(roomCode);
    if (!roomsData[roomCode]) {
      roomsData[roomCode] = { history: [] };
    }
    // Send existing lines to the player who just joined
    socket.emit("canvas-history", roomsData[roomCode].history);
  });

  // 2. Handle Drawing
  socket.on("draw", ({ path, roomCode }) => {
    if (roomsData[roomCode]) {
      roomsData[roomCode].history.push(path); // Save to server memory
      socket.to(roomCode).emit("remote-draw", path); // Send to others
    }
  });

  // 3. Handle Clear Canvas
  socket.on("clear-canvas", (roomCode) => {
    if (roomsData[roomCode]) {
      roomsData[roomCode].history = []; 
    }
    io.to(roomCode).emit("clear-canvas"); 
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
  });
  
  // Broadcast the line while it is still being drawn
  socket.on("mid-draw", ({ path, roomCode }) => {
    socket.to(roomCode).emit("remote-mid-draw", { path, userId: socket.id });
  });
});

const PORT = 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});