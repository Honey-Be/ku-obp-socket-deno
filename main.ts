import { serve } from "https://deno.land/std@0.166.0/http/server.ts";
import { Server } from "https://deno.land/x/socket_io@0.2.0/mod.ts";
import { Application } from "https://deno.land/x/oak@v11.1.0/mod.ts";
import { range } from "https://deno.land/x/it_range@v1.0.3/range.mjs";

type GameTrading = {
  turnPlayer: {
      id: string;
      balance: number;
      prop: PlayerProprety[];
  };
  againstPlayer: {
      id: string;
      balance: number;
      prop: PlayerProprety[];
  };
};

export const MonopolyModes = [
  {
      AllowDeals: true,
      WinningMode: "last-standing",
      // BuyingSystem: "following-order",
      Name: "Classic",
      startingCash: 1500,
      mortageAllowed: true,
      turnTimer: undefined,
  },
  {
      AllowDeals: false,
      WinningMode: "monopols & trains",
      // BuyingSystem: "everything",
      Name: "Monopol",
      startingCash: 1500,
      mortageAllowed: false,
      turnTimer: undefined,
  },
  {
      AllowDeals: false,
      WinningMode: "last-standing",
      // BuyingSystem: "card-firsts",
      Name: "Run-Down",
      startingCash: 1500,
      mortageAllowed: false,
      turnTimer: 30,
  },
] as MonopolyMode[];

export interface MonopolyMode {
  WinningMode: "last-standing" | "monopols" | "monopols & trains";
  // BuyingSystem: "following-order" | "card-firsts" | "everything";
  AllowDeals: boolean;
  Name: string;
  startingCash: number;
  mortageAllowed: boolean;
  turnTimer: undefined | number;
}

export interface PlayerProprety {
  posistion: number;
  count: 0 | 1 | 2 | 3 | 4 | "h";
  group: string;
  rent?: number;
  morgage?: boolean;
}

export class MonopolyPlayerState {
  public icon: number;

  public position: number;
  public balance: number;
  public properties: Array<PlayerProprety>;
  public isInJail: boolean;
  public jailTurnsRemaining: number;
  public getoutCards: number;
  public ready: boolean;
  public positions: { x: number; y: number };
  constructor() {
      this.icon = -1;
      this.position = 0;
      this.balance = 1500;
      this.properties = [];
      this.isInJail = false;
      this.jailTurnsRemaining = 0;
      this.getoutCards = 0;
      this.ready = false;
      this.positions = { x: 0, y: 0 };
  }
  recieveJson(json: MonopolyPlayerJSON) {
      this.position = json.position;
      this.icon = json.icon;
      this.balance = json.balance;
      this.properties = json.properties;
      this.isInJail = json.isInJail;
      this.jailTurnsRemaining = json.jailTurnsRemaining;
      this.getoutCards = json.getoutCards;
      return this;
  }

  public toJson() {
      return {
          balance: this.balance,
          icon: this.icon,
          isInJail: this.isInJail,
          jailTurnsRemaining: this.jailTurnsRemaining,
          position: this.position,
          properties: this.properties,
          getoutCards: this.getoutCards,
      } as MonopolyPlayerJSON;
  }

  get color() {
      switch (this.icon) {
          case 0:
              return "#E0115F";
          case 1:
              return "#4169e1";
          case 2:
              return "#50C878";
          case 3:
              return "#FFC000";
          case 4:
              return "#FF7F50";
          case 5:
              return "#6C22C9";
          default:
              return "";
      }
  }
}
export type MonopolyPlayerJSON = {
  icon: number;
  position: number;
  balance: number;
  properties: Array<any>;
  isInJail: boolean;
  jailTurnsRemaining: number;
  getoutCards: number;
};

type playerType = string | null

interface MonopolyStatus {
  roomKey: string | null;
  size: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  maxSize: 2 | 3 | 4 | 5 | 6;
  host: playerType;
  guests: playerType[];
  players: [playerType, playerType, playerType, playerType, playerType, playerType]
  isStarted: boolean;
  isEnded: boolean;
  mode: MonopolyMode;
}

const initialMonopolyStatus: MonopolyStatus = {
  roomKey: null,
  size: 0,
  maxSize: 6,
  host: null,
  guests: [null, null, null, null, null],
  players: [null, null, null, null, null, null],
  isStarted: false,
  isEnded: false,
  mode: MonopolyModes[0]
};

interface IdInfo {
  playerName: string;
  roomKey: string;
  ready: boolean;
}

type ActionType = {
  type: string;
  args?: object
}
interface UnjailAction extends ActionType {
  type: "unjail",
  args: {option: "card" | "pay"}
}

interface RollDiceAction extends ActionType {
  type: "rollDice",
  args: undefined
}

interface ChorchRollAction {
  type: "chorchRoll",
  args: { is_chance: boolean; rolls: number }
}

interface PlayerUpdateAction {
  type: "playerUpdate",
  args: { playerId: string; pJson: MonopolyPlayerJSON }
}

interface FinishTurnAction {
  type: "finishTurn",
  args: {playerInfo: MonopolyPlayerJSON}
}

interface PayAction {
  type: "pay",
  args: { balance: number; from: string; to: string }
}

interface TradeAction {
  type: "trade",
  args: undefined
}

interface CancelTradeAction {
  type: "cancelTrade",
  args: undefined
}

interface SubmitTradeAction {
  type: "submitTrade",
  args: {x: GameTrading}
}

interface TradeUpdateAction {
  type: "tradeUpdate",
  args: {x: GameTrading}
}

const COLORMAP = [
  "#E0115F",
  "#4169e1",
  "#50C878",
  "#FFC000",
  "#FF7F50",
  "#6C22C9"
]

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
  MONOPOLY: {
    MIN_PLAYER: 2,
    MAX_PLAYER: 6
  }
}

const monopolyStatus: {
  [roomKey: string]: MonopolyStatus
} = {};

const idInfo: { [id: string]: IdInfo } = {};

io.on("connection", (socket) => {
  console.log(`socket ${socket.id} connected`);

  socket.on("joinRoom", ({ playerName, roomKey, maxSize = 4 }: { playerName: string, roomKey: string, maxSize: 2 | 3 | 4 | 5 | 6 }) => {
    console.log(playerName, roomKey);
    
    if(!monopolyStatus[roomKey]) {
      monopolyStatus[roomKey] = {...initialMonopolyStatus};
      monopolyStatus[roomKey].roomKey = roomKey;
      roomKeys.add(roomKey);
    }
    
    if (monopolyStatus[roomKey].host && monopolyStatus[roomKey].guests.length == (monopolyStatus[roomKey].maxSize - 1) ) {
      console.log(monopolyStatus);
      console.log(monopolyStatus[roomKey]);
      socket.emit("joinFailed", "Room is full now");
      return;
    }
    
    socket.join(roomKey);
    idInfo[socket.id] = {playerName, roomKey, ready: false};
    console.log(`${playerName}(${socket.id}) has connected to ${roomKey}`);

    if (monopolyStatus[roomKey].host === null) {
      monopolyStatus[roomKey].size += 1;
      monopolyStatus[roomKey].host = playerName
      const rv: number = Math.random()
      let flag_color = false;
      for(const num of range(0,maxSize)) {
        const ratio = (num+1) / maxSize;
        if(!flag_color) {
          if(rv < ratio) {
            monopolyStatus[roomKey].players[num] = playerName;
            flag_color = true;
          }
        } else {
          break;
        }
      }
    } else if (monopolyStatus[roomKey].host !== playerName) {
      monopolyStatus[roomKey].size += 1;
      monopolyStatus[roomKey].guests.push(playerName);
      const remaining = maxSize -  monopolyStatus[roomKey].guests.length;
      
      const rv: number = Math.random()

      let flag_color = false;
      const memo: Array<number | null> = Array.from(range(0, maxSize))
      for(const pn of range(0, maxSize)) {
        if(monopolyStatus[roomKey].players[pn] !== null) {
          memo[pn] = null
        }
      }
      const memo2: Array<number> = memo.filter((value) => (value !== null)).map((value) => (value as number));
      for(const num of range(0,remaining)) {
        const ratio = (num+1) / remaining;
        if(!flag_color) {
          if(rv < ratio) {
            monopolyStatus[roomKey].players[memo2[num]] = playerName;
            flag_color = true;
          }
        } else {
          break;
        }
      }

      if(monopolyStatus[roomKey].size >= monopolyStatus[roomKey].maxSize) {
        monopolyStatus[roomKey].isStarted = true;
      }
    }

    const color = COLORMAP[monopolyStatus[roomKey].players.indexOf(playerName)];
    socket.emit("color", color)
    io.to(roomKey).emit("isStarted", monopolyStatus[roomKey].isStarted);

    console.log(monopolyStatus[roomKey])
  })

  socket.on("leaveRoom", () => {
    if(!idInfo[socket.id]) {
      return;
    }

    console.log(socket.id + " has leaved this room");
    const roomKey = idInfo[socket.id].roomKey
    socket.broadcast.to(roomKey).emit("explosion");

    delete idInfo[socket.id];
    delete monopolyStatus[roomKey];
    roomKeys.delete(roomKey);
  });

  socket.on("disconnect", () => {
    if(!idInfo[socket.id]) {
      return;
    }

    console.log(socket.id + " has leaved this room");
    const roomKey = idInfo[socket.id].roomKey
    socket.broadcast.to(roomKey).emit("explosion");

    delete idInfo[socket.id];
    delete monopolyStatus[roomKey];
    roomKeys.delete(roomKey);
  });

  socket.on("ready", (args: {ready?: boolean, mode?: MonopolyMode}) => {
    try {
      if (idInfo[socket.id] === undefined) {return;}
      if (args.ready !== undefined) {
        idInfo[socket.id].ready = args.ready
      }
      if (args.mode !== undefined) {

      }
    }
  })

  socket.on("turnAction", ({ roomKey, action }: { roomKey: string, action: ActionType }) => {
    socket.broadcast.to(roomKey).emit("turnAction", action);
  });
});

const handler = io.handler(async (req) => {
  return await app.handle(req) || new Response(null, { status: 404 });
});

await serve(handler, {
  port: 80,
});