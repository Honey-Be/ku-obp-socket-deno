// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.166.0/http/server.ts";
import { Server, Socket } from "https://deno.land/x/socket_io@0.2.0/mod.ts";
import { Application, Context } from "https://deno.land/x/oak@v11.1.0/mod.ts";
import { shuffleArray } from "./lib/shuffle.ts";
import monopolyJSON from "./monopoly.json" with {type: "json"}

function getCurrentTime() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const currentTime = `${hours}:${minutes}`;

  return currentTime;
}

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

export interface historyAction {
  time: string;
  action: string;
}

export function history(action: string): historyAction {
  const time = new Date().toJSON();
  return {
      action,
      time,
  } as historyAction;
}

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

export class MonopolyPlayer {
  public id: string;
  public username: string;
  public ord: number;
  public position: number;
  public balance: number;
  public properties: Array<PlayerProprety>;
  public isInJail: boolean;
  public jailTurnsRemaining: number;
  public getoutCards: number;
  public ready: boolean;
  public positions: { x: number; y: number };
  constructor(id: string = "", username: string = "", cash: number = 1500) {
      this.id = id;
      this.ord = -1;
      this.username = username;
      this.position = 0;
      this.balance = cash;
      this.properties = [];
      this.isInJail = false;
      this.jailTurnsRemaining = 0;
      this.getoutCards = 0;
      this.ready = false;
      this.positions = { x: 0, y: 0 };
  }
  recieveJson(json: MonopolyPlayerJSON) {
      this.id = json.id;
      this.username = json.username
      this.position = json.position;
      this.ord = json.ord;
      this.balance = json.balance;
      this.properties = json.properties;
      this.isInJail = json.isInJail;
      this.jailTurnsRemaining = json.jailTurnsRemaining;
      this.getoutCards = json.getoutCards;
      return this;
  }

  public toJson() {
      return {
          id: this.id,
          username: this.username,
          balance: this.balance,
          ord: this.ord,
          isInJail: this.isInJail,
          jailTurnsRemaining: this.jailTurnsRemaining,
          position: this.position,
          properties: this.properties,
          getoutCards: this.getoutCards,
      } as MonopolyPlayerJSON;
  }

  get color() {
    if(this.ord in [0,1,2,3,4,5]) {
      return COLORMAP[this.ord];
    }
    else {
      return "";
    }
  }
}
export type MonopolyPlayerJSON = {
  id: string;
  username: string;
  ord: number;
  position: number;
  balance: number;
  properties: Array<any>;
  isInJail: boolean;
  jailTurnsRemaining: number;
  getoutCards: number;
};

type playerNameType = string | null

interface MonopolyStatus {
  roomID: string | null;
  size: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  maxSize: 2 | 3 | 4 | 5 | 6;
  host: string | null;
  guests: string[];
  players: string[];
  isStarted: boolean;
  isEnded: boolean;
  mode: MonopolyMode;
}

interface ClientInfo {
  player: MonopolyPlayer;
  socket: Socket;
  ready: boolean;
  positions: {x: number, y: number}
}
type ActionType = {
  type: string;
  args?: any
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
  type: "cancel-trade",
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

class PrimitiveEventsRegistry {
  private initialMap: Map<string, (client: ClientInfo, logger: (log: string) => void) => ((args: any) => void)>;
  constructor() {
    this.initialMap = new Map<string, (client: ClientInfo, logger: (log: string) => void) => ((args: any) => void)>();
  }
  public register<T>(event: string, handlerGenerator: (client: ClientInfo, logger: (log: string) => void) => ((args: T) => void)) {
    this.initialMap.set(event, handlerGenerator)
  }
  public attach(clients: ClientsMap) {
    this.initialMap.forEach((handlerGenerator, event) => {
      clients.ForEach((client, logger) => {
        client.socket.on(event ,handlerGenerator(client, logger))
      })
    })
  }
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

class ClientsMap {
  private internal: Map<string, ClientInfo>;
  private logs: string[];
  constructor() {
    this.internal = new Map<string, ClientInfo>();
    this.logs = new Array<string>();
  }
  public getClient(socketId: string): ClientInfo | undefined {
    return this.internal.get(socketId);
  }
  public setClient(socketId: string, newInfo: ClientInfo) {
    this.internal.set(socketId, newInfo);
  }
  public modifyClient(socketId: string, params: {
    playerName?: string,
    playerOrd?: number,
    ready?: boolean,
    position?: number
  }) {
    const tmp: ClientInfo | undefined = this.getClient(socketId)
    if (tmp !== undefined) {
      tmp.player.username = (params.playerName !== undefined) ? params.playerName : tmp.player.username;
      tmp.ready = (params.ready !== undefined) ? params.ready : tmp.ready;
      tmp.player.position = (params.position !== undefined) ? params.position : tmp.player.position;
      tmp.player.ord = (params.playerOrd) ? params.playerOrd : tmp.player.ord
      this.internal.set(socketId,tmp)
    }
  }

  public deleteClient(socketId: string) {
    this.internal.delete(socketId)
  }

  public get socketIDs(): IterableIterator<string> {
    return this.internal.keys()
  }

  public get values(): IterableIterator<ClientInfo> {
    return this.internal.values()
  }

  public pipeForEachModifier(fns: Array<(ci: ClientInfo) => ClientInfo>) {
    for(let ci of this.internal.values()) {
      for(const fn of fns) {
        ci = fn(ci)
      }
    }
  }

  private pushLog(log: string) {
    this.logs.push(log)
  }

  public ForEach(fn: (ci: ClientInfo, logger: (log: string) => void) => void) {
    for (const ci of this.internal.values()) {
      fn(ci, this.pushLog)
    }
  }

  public emitAll<T>(event: string, args: T) {
    for(const x of this.internal.values()) {
      x.socket.emit(event, args)
    }
  }

  public emitExcepts<T>(socketId: string, event: string, args: T) {
    for(const [id, x] of this.internal.entries()) {
      if (id !== socketId) {
        x.socket.emit(event, args)
      }
    }
  }
}
const roomIDs: Set<string> = new Set();

const monopolyStatus: {
  [roomID: string]: MonopolyStatus
} = {};

const clientsInfo: Map<string, ClientsMap> = new Map<string, ClientsMap>();

const currentTurnId: {
  [roomID: string]: string
} = {};

const initialMonopolyStatus: MonopolyStatus = {
  roomID: null,
  size: 0,
  maxSize: 6,
  host: null,
  guests: [] as string[],
  players: [] as string[],
  isStarted: false,
  isEnded: false,
  mode: MonopolyModes[0]
};


io.on("connection", (socket) => {
  console.log(`socket ${socket.id} connected`);






  const eventsRegistry: PrimitiveEventsRegistry = new PrimitiveEventsRegistry();
  


  socket.on("joinLobby", ({ playerName, roomID, maxSize = 6, selectedMode = MonopolyModes[0] }: { playerName: string, roomID: string, maxSize: 2 | 3 | 4 | 5 | 6, selectedMode: MonopolyMode }) => {
    console.log(playerName, roomID);
    
    if(!monopolyStatus[roomID]) {
      monopolyStatus[roomID] = {...initialMonopolyStatus};
      monopolyStatus[roomID].roomID = roomID;
      monopolyStatus[roomID].mode = selectedMode;
      roomIDs.add(roomID);
    }
    
    if (monopolyStatus[roomID].host && monopolyStatus[roomID].guests.length == (monopolyStatus[roomID].maxSize - 1) ) {
      console.log(monopolyStatus);
      console.log(monopolyStatus[roomID]);
      socket.emit("joinFailed", "Lobby is full now");
      return;
    }
    
    socket.join(roomID);
    const clientsMap: ClientsMap = (clientsInfo.has(roomID)) ? clientsInfo.get(roomID) as ClientsMap : new ClientsMap();
    const player = new MonopolyPlayer(socket.id, playerName);
    clientsMap.setClient(socket.id, { player, socket, ready: false, positions: {x: 0, y: 0}});
    clientsInfo.set(roomID, clientsMap);
    console.log(`${playerName}(${socket.id}) has connected to ${roomID}`);

    if (monopolyStatus[roomID].host === null) {
      monopolyStatus[roomID].maxSize = maxSize
      monopolyStatus[roomID].guests = [] as string[]
      monopolyStatus[roomID].size += 1;
      monopolyStatus[roomID].host = playerName
    } else if (monopolyStatus[roomID].host !== playerName) {
      monopolyStatus[roomID].size += 1;
      monopolyStatus[roomID].guests.push(playerName);
    }
    console.log(monopolyStatus[roomID])
  })

  socket.on("leaveLobby", (roomID: string) => {
    const clientsMap = clientsInfo.get(roomID);
    if(clientsMap === undefined) {
      return;
    }
    const client = clientsMap.getClient(socket.id)
    if(client === undefined) {
      return;
    } else {
      if(monopolyStatus[roomID].host === client.player.username) {
        console.log(`Room ${roomID} has canceled by the host.`);
        socket.broadcast.to(roomID).emit("roomCanceled");

        clientsMap.deleteClient(socket.id);

        delete monopolyStatus[roomID];
        roomIDs.delete(roomID);
      } else if (client.player.username in monopolyStatus[roomID].guests) {
        console.log(`${client.player.username}(${socket.id}) has leaved room ${roomID}`);
        clientsMap.deleteClient(socket.id);

        const leaved = monopolyStatus[roomID].guests.indexOf(client.player.username);
        const remaining_front = monopolyStatus[roomID].guests.slice(0,leaved);
        const remaining_rear = monopolyStatus[roomID].guests.slice(leaved+1, undefined);
        const remaining = remaining_front.concat(remaining_rear);
        monopolyStatus[roomID].guests = remaining;
      }
    }
  });

  socket.on("leaveRoom", (roomID: string) => {
    const clientsMap = clientsInfo.get(roomID);
    if(clientsMap === undefined) {
      return;
    }
    const client = clientsMap.getClient(socket.id)
    if(client === undefined) {
      return;
    } else {
      console.log(socket.id + " has leaved this room");
      socket.broadcast.to(roomID).emit("roomExplosion");

      clientsMap.deleteClient(socket.id);
      delete monopolyStatus[roomID];
      roomIDs.delete(roomID);
    }
  });


  socket.on("disconnect", (roomID: string) => {
    try {
      const clientsMap = clientsInfo.get(roomID);
      if (clientsMap === undefined) return;
      if(clientsMap.getClient(socket.id) !== undefined) {
          console.log(
              `{${getCurrentTime()}} [${socket.id}] Player "${clientsMap.getClient(socket.id)?.player.username}" has disconnected.`
          );
      }
      clientsMap.deleteClient(socket.id);
      if (currentTurnId[roomID] === socket.id) {
          const arr = Array.from(clientsMap.values)
              .filter((v) => v.player.balance > 0)
              .map((v) => v.player.id);
          let i = arr.indexOf(socket.id);
          i = (i + 1) % arr.length;
          currentTurnId[roomID] = arr[i];
      }
      clientsMap.emitAll("disconnectedPlayer", {
          id: socket.id,
          turn: currentTurnId[roomID],
      });

      if (Array.from(clientsMap.socketIDs).length === 0) {
          if (monopolyStatus[roomID].isStarted) console.log("Game has Ended. Server is currently Open to new Players");
          monopolyStatus[roomID].isStarted = false;
      }
    } catch (e) {
        console.log(e);
    }
  })

  socket.on("ready", (roomID: string, args: {ready?: boolean}) => {
    const clientsMap = clientsInfo.get(roomID);
    if(clientsMap === undefined) {
      return;
    }
    const client = clientsMap.getClient(socket.id)
    if (client === undefined) {return;}
    if (args.ready !== undefined) {
      clientsMap.modifyClient(socket.id, {
        ready: args.ready
      })
    }

    const readys = Array.from(clientsMap.values).map((_client) => _client.ready)
    clientsMap.emitAll("ready", {
      id: socket.id,
      state: client.ready,
      selectedMode: monopolyStatus[roomID].mode
    })

    if(!readys.includes(false)) {
      console.log("Game has Started, No more Players can join the Server");

      const guests = monopolyStatus[roomID].guests;
      const playerNames = guests.concat([monopolyStatus[roomID].host as string]);
      const shuffledPlayerNames: string[] = shuffleArray(playerNames);
      monopolyStatus[roomID].players = shuffledPlayerNames
      
      clientsMap.pipeForEachModifier([
        (ci) => {
          const new_ci = ci
          new_ci.player.ord = shuffledPlayerNames.indexOf(new_ci.player.username)
          return new_ci
        }
      ])
      
      monopolyStatus[roomID].isStarted = true;
      clientsMap.emitAll("start-game", {})
    }
  })

  const attachEvents = (roomID: string, clientsMap: ClientsMap) => {

    eventsRegistry.register("unjail", (client, _logger) => {
      return (option: "card" | "pay") => {
        try {
          clientsMap.emitAll("unjail", {
              to: client.player.id,
              option,
          });
        } catch (e) {
          console.log(e);
        }
      }
    })

    eventsRegistry.register("roll_dice", (client, logger) => {
      return () => {
        try {
          const first = Math.floor(Math.random() * 6) + 1;
          const second = Math.floor(Math.random() * 6) + 1;
          const x = `{${getCurrentTime()}} [${client.socket.id}] Player "${client.player.username}" rolled a [${first},${second}].`;
          logger(x);
          console.log(x);
          const sum = first + second;
          const pos = (client.player.position + sum) % 40;
          clientsMap.emitAll("dice_roll_result", {
            listOfNums: [first, second, pos],
            turnId: currentTurnId[roomID],
          });
        } catch (e) {
          console.log(e);
        }
      }
    })

    eventsRegistry.register("chorch_roll", (_client, _logger) => {
      return (args: { is_chance: boolean; rolls: number }) => {
        try {
            const arr = args.is_chance ? monopolyJSON.chance : monopolyJSON.communitychest;
            const randomElement = arr[Math.floor(Math.random() * arr.length)];
            clientsMap.emitAll("chorch_result", {
                element: randomElement,
                is_chance: args.is_chance,
                rolls: args.rolls,
                turnId: currentTurnId[roomID],
            });
        } catch (e) {
            console.log(e);
        }
      }
    })

    eventsRegistry.register("player_update", (_client, _logger) => {
      return (args: { playerId: string; pJson: MonopolyPlayerJSON }) => {
        const xplayer = clientsMap.getClient(args.playerId);
        if (xplayer === undefined) return;

        xplayer.player.recieveJson(args.pJson);
        clientsMap.emitExcepts(args.playerId, "player_update", args);
      }
    })

    eventsRegistry.register("finish-turn", (client, _logger) => {
      return (playerInfo: MonopolyPlayerJSON) => {
        try {
            client.player.recieveJson(playerInfo);
            if (currentTurnId[roomID] != socket.id) return;
            const arr = Array.from(clientsMap.values)
                .filter((v) => v.player.balance > 0).sort((a, b) => a.player.ord - b.player.ord)
                .map((v) => v.player.id);
            let i = arr.indexOf(socket.id);
            i = (i + 1) % arr.length;
            currentTurnId[roomID] = arr[i];

            clientsMap.emitAll("turn-finished", {
                from: socket.id,
                turnId: currentTurnId[roomID],
                pJson: client.player.toJson(),
                WinningMode: monopolyStatus[roomID].mode.WinningMode,
            });
        } catch (e) {
            console.log(e);
        }
    }
    })

    eventsRegistry.register("pay", (_client, _logger) => {
      return (args: { balance: number; from: string; to: string }) => {
        try {
          const top = clientsMap.getClient(args.to)?.player;
          const fromp = clientsMap.getClient(args.from)?.player;
          if (top === undefined) return;
          top.balance += args.balance;
          if (fromp === undefined) return;
          fromp.balance -= args.balance;
          clientsMap.emitAll("member_updating", {
            playerId: args.to,
            animation: "recieveMoney",
            additional_props: [args.from],
            pJson: [top.toJson(), fromp.toJson()] as [MonopolyPlayerJSON, MonopolyPlayerJSON],
          });
        }
        catch (e) {
          console.log(e);
        }
      }
    })

    eventsRegistry.register("mouse", (_client, _logger) => {
      return (args: { x: number; y: number }) => {
        const client = clientsMap.getClient(socket.id)
        if(client === undefined) {
          return;
        }
        client.positions = args
        
        clientsMap.emitExcepts(socket.id, "mouse", {
          id: socket.id,
          ...args,
        })
      }
    })

    eventsRegistry.register("history", (_client, _logger) => {
      return (args: historyAction) => {
        clientsMap.emitAll("history", args)
      }
    })

    eventsRegistry.register("trade", (_client, _logger) => {
      return () => {
        if (!monopolyStatus[roomID].mode.AllowDeals) return;
        clientsMap.emitAll("trade", {});
      }
    })

    eventsRegistry.register("cancel-trade", (_client, _logger) => {
      return () => {
        return () => {
          if (!monopolyStatus[roomID].mode.AllowDeals) return;
          clientsMap.emitAll("cancel-trade", {});
        }
      }
    })

    eventsRegistry.register("submit-trade", (_client, _logger) => {
      return (x: GameTrading) => {
        if (!monopolyStatus[roomID].mode.AllowDeals) return;
        const turnPlayer = clientsMap.getClient(x.turnPlayer.id);
        const againstPlayer = clientsMap.getClient(x.againstPlayer.id);
        if (turnPlayer === undefined || againstPlayer === undefined) return;

        // Exclude against
        const turnGets = againstPlayer.player.properties.filter((v1) =>
          x.againstPlayer.prop.map((v2) => JSON.stringify(v2)).includes(JSON.stringify(v1))
        );
        againstPlayer.player.properties = againstPlayer.player.properties.filter(
          (v1) => !x.againstPlayer.prop.map((v2) => JSON.stringify(v2)).includes(JSON.stringify(v1))
        );

        // Exclude turn
        const againsGets = againstPlayer.player.properties.filter((v1) =>
          x.turnPlayer.prop.map((v2) => JSON.stringify(v2)).includes(JSON.stringify(v1))
        );
        turnPlayer.player.properties = againstPlayer.player.properties.filter(
          (v1) => !x.turnPlayer.prop.map((v2) => JSON.stringify(v2)).includes(JSON.stringify(v1))
        );

        // Now Balance
        againstPlayer.player.balance -= x.againstPlayer.balance;
        turnPlayer.player.balance -= x.turnPlayer.balance;

        turnPlayer.player.balance += x.againstPlayer.balance;
        againstPlayer.player.balance += x.turnPlayer.balance;

        // Exclude switch
        turnPlayer.player.properties.push(...turnGets);
        againstPlayer.player.properties.push(...againsGets);

        clientsMap.emitAll(
          "submit-trade",
          {
            pJsons: [turnPlayer.player.toJson(), againstPlayer.player.toJson()] as [MonopolyPlayerJSON, MonopolyPlayerJSON],
            action: `
              ${turnPlayer.player.username} done a trade with ${againstPlayer.player.username}
            `,
          }
        );
      }
    })

    eventsRegistry.register("trad-update", (_client, _logger) => {
      return (x: GameTrading) => {
        if (!monopolyStatus[roomID].mode.AllowDeals) return;
        clientsMap.emitAll("trade-update", x);
      }
    })

    eventsRegistry.attach(clientsMap)
  }


  socket.on("name", (name: string, roomID: string, mode: MonopolyMode) => {
    try {
        const currentRoom = clientsInfo.get(roomID) ?? new ClientsMap()

        const player = new MonopolyPlayer(socket.id, name, mode.startingCash);

        

        // handle current id =>
        if (!currentTurnId[roomID] || (currentTurnId[roomID] && (currentTurnId[roomID] === "" || !Array.from(currentRoom.socketIDs).includes(currentTurnId[roomID])))) {
            currentTurnId[roomID] = socket.id;
        }
        currentRoom.setClient(socket.id, {
            player: player,
            socket: socket,
            ready: false,
            positions: { x: 0, y: 0 },
        });
        console.log(`{${getCurrentTime()}} [${socket.id}] Player "${player.username}" has connected.`);
        const other_players = [];
        for (const x of Array.from(currentRoom.values)) {
            other_players.push(x.player.toJson());
        }
        socket.emit("initials", {
            turn_id: currentTurnId[roomID],
            other_players,
            selectedMode: mode,
        });
        currentRoom.emitExcepts(socket.id, "new-player", player.toJson());

        // handle all events from here on!
        // game sockets
        attachEvents(roomID, currentRoom)
        clientsInfo.set(roomID, currentRoom)
    } catch (e) {
        console.log(e);
    }
});

});

const greet = (context: Context) => {
  context.response.body = "Hello world!";
};

app.use(greet)


const handler = io.handler(async (req) => {
  return await app.handle(req) || new Response(null, { status: 404 });
});

await serve(handler, {
  port: 80,
});