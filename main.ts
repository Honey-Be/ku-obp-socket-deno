import { serve } from "https://deno.land/std@0.166.0/http/server.ts";
import { Server } from "https://deno.land/x/socket_io@0.2.0/mod.ts";
import { Application } from "https://deno.land/x/oak@v11.1.0/mod.ts";

const app = new Application();
const io = new Server({
  cors: {
    origin: ["*"],
    methods: ["GET", "POST"]
  }
});

const roomKeys: Set<string> = new Set();
const roomPlayers: { [roomKey: string]: Set<string> } = {}
const roomStatus: { [roomKey: string]: { [name: string]: string } } = {}
const GAME_INFO = {
  CHESS: {
    MIN_PLAYER: 2,
    MAX_PLAYER: 2,
  }
}



io.on("connection", (socket) => {
  console.log(`socket ${socket.id} connected`);

  socket.on("joinRoom", ({ roomKeyInstance, name }) => {
    const roomKey: string = roomKeyInstance as string;
    const playerName: string = name as string;
    console.log(`${socket.id} has connected to ${roomKey}`);
    socket.join(roomKey)

    if(!roomPlayers[roomKey]) {
      roomPlayers[roomKey] = new Set();
      roomStatus[roomKey] = {};
      roomKeys.add(roomKey)
    }

    if(roomPlayers[roomKey].size >= GAME_INFO.CHESS.MAX_PLAYER) {
      socket.emit("joinFailed", "Room is full now.")
      return;
    }

    roomPlayers[roomKey].add(playerName)
    
    console.log(roomPlayers[roomKey])

    if(roomPlayers[roomKey].size === 1) {
      roomStatus[roomKey][playerName] = "w"
    } else if(!(playerName in roomStatus[roomKey])) {
      roomStatus[roomKey][playerName] = "b"
    }

    socket.emit("color", roomStatus[roomKey][playerName])
    io.to(roomKey).emit("newPlayer", socket.id)    
  })

  socket.on("leaveRoom", (roomKey) => {
    socket.leave(roomKey);
    if (roomPlayers[roomKey]) {
      roomPlayers[roomKey].delete(socket.id);
      if (roomPlayers[roomKey].size === 0) {
        delete roomPlayers[roomKey];
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected", socket.id);
    for (const roomKey in roomKeys) {
      roomPlayers[roomKey].delete(socket.id);
      if (roomPlayers[roomKey].size === 0) {
        delete roomPlayers[roomKey];
        roomKeys.delete(roomKey)
      }
    }
  });

  socket.on("turnAction", (data) => {
    console.log(data);
    const { roomKey, action } = data;
    socket.broadcast.to(roomKey).emit("turnAction", action);
  });
});

const handler = io.handler(async (req) => {
  return await app.handle(req) || new Response(null, { status: 404 });
});

await serve(handler, {
  port: 80,
});