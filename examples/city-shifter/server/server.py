"""City Shifter matchmaking + signalling server.

It never touches game traffic: it only puts players in rooms (max 15) and relays the WebRTC handshake (offer / answer + ICE) between the host
and each joiner, so the phones can open direct data channels. Rooms are public (quick match, filled by random players) or private (4-letter code).

Protocol: JSON text frames over WebSocket.
  client -> server  hello {name, char}      first message
                    quick {mt}              join (or open) a public room; mt = "solo" | "team"
                    create {mt}             open a private room, you are the host
                    join {code}             join a private room
                    start                   host only (needs 2+ players): everybody goes
                    sig {to, d}             relay a handshake blob to player `to` in the same room
                    leave
  server -> client  hi {v, online}          after hello
                    room {code, mt, max, you, host, state, players[{id,name,char,team,host}], countdown}
                    go {players, mt}        the match starts: host id is 1, joiners get ids 2.. (their Godot peer ids)
                    sig {from, d}
                    alone                   a quick match found nobody: play with bots instead
                    closed {why}            the room is gone (the host left)
                    err {m}
"""
import asyncio
import json
import os
import random
import string
import time

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

MAX_PLAYERS = 15
TEAM_SIZE = 4
QUICK_START_S = 14.0        # a public room starts this long after its second player arrived (or at once when full)
QUICK_ALONE_S = 35.0        # nobody came: tell the lone player to play offline with bots
MAX_FRAME = 40_000
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"


class Client:
    def __init__(self, ws):
        self.ws = ws
        self.name = "PLAYER"
        self.char = "outlaw"
        self.room = None
        self.pid = 0

    async def send(self, msg):
        try:
            await self.ws.send(json.dumps(msg, separators=(",", ":")))
        except ConnectionClosed:
            pass


class Room:
    def __init__(self, code, mt, public):
        self.code = code
        self.mt = mt
        self.public = public
        self.players = []            # Clients, in join order; players[0] is the host
        self.state = "lobby"         # "lobby" | "playing"
        self.next_id = 2
        self.created = time.monotonic()
        self.fill_at = None          # monotonic time the public room starts

    def add(self, c):
        c.room = self
        c.pid = 1 if not self.players else self.next_id
        if self.players:
            self.next_id += 1
        self.players.append(c)

    def team_of(self, c):
        idx = sorted(p.pid for p in self.players).index(c.pid)
        return idx // TEAM_SIZE if self.mt == "team" else idx

    def listing(self):
        return [{"id": p.pid, "name": p.name, "char": p.char, "team": self.team_of(p), "host": p is self.players[0]} for p in self.players]

    def full(self):
        return len(self.players) >= MAX_PLAYERS

    async def broadcast_state(self):
        cd = None
        if self.fill_at is not None and self.state == "lobby":
            cd = max(0.0, self.fill_at - time.monotonic())
        for p in list(self.players):
            await p.send({"t": "room", "code": self.code, "mt": self.mt, "max": MAX_PLAYERS, "you": p.pid, "host": p is self.players[0],
                          "state": self.state, "players": self.listing(), "countdown": cd})

    async def go(self):
        if self.state != "lobby":
            return
        self.state = "playing"
        msg = {"t": "go", "players": self.listing(), "mt": self.mt}
        for p in list(self.players):
            await p.send(msg)


rooms = {}


def new_code():
    for _ in range(200):
        code = "".join(random.choice(CODE_CHARS) for _ in range(4))
        if code not in rooms:
            return code
    raise RuntimeError("no free room code")


def clean_name(s):
    s = "".join(ch for ch in str(s) if ch.isprintable())[:14].strip()
    return s or "PLAYER"


async def leave(c):
    r = c.room
    if r is None:
        return
    c.room = None
    if c in r.players:
        r.players.remove(c)
    if not r.players:
        rooms.pop(r.code, None)
        return
    if c.pid == 1:
        # the host owns the world: without them the room is over
        rooms.pop(r.code, None)
        for p in list(r.players):
            p.room = None
            await p.send({"t": "closed", "why": "host left"})
        r.players.clear()
        return
    if r.state == "lobby":
        if len(r.players) < 2:
            r.fill_at = None
        await r.broadcast_state()
    else:
        # the match is on: the others only need to know someone left through the game channel; the host can drop out of the list
        pass


async def join_room(c, r):
    if r.state != "lobby":
        await c.send({"t": "err", "m": "That match already started"})
        return
    if r.full():
        await c.send({"t": "err", "m": "Room is full (15 players)"})
        return
    r.add(c)
    if r.public and len(r.players) >= 2 and r.fill_at is None:
        r.fill_at = time.monotonic() + QUICK_START_S
    await r.broadcast_state()


async def handle(ws):
    c = Client(ws)
    try:
        async for raw in ws:
            if len(raw) > MAX_FRAME:
                continue
            try:
                m = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(m, dict):
                continue
            t = m.get("t")
            if t == "hello":
                c.name = clean_name(m.get("name", "PLAYER"))
                c.char = str(m.get("char", "outlaw"))[:24]
                await c.send({"t": "hi", "v": 1, "online": sum(len(r.players) for r in rooms.values())})
            elif t in ("quick", "create", "join"):
                if c.room is not None:
                    await leave(c)
                mt = "team" if m.get("mt") == "team" else "solo"
                if t == "quick":
                    pick = None
                    for r in rooms.values():
                        if r.public and r.mt == mt and r.state == "lobby" and not r.full():
                            if pick is None or len(r.players) > len(pick.players):
                                pick = r
                    if pick is None:
                        pick = Room(new_code(), mt, True)
                        rooms[pick.code] = pick
                    await join_room(c, pick)
                elif t == "create":
                    r = Room(new_code(), mt, False)
                    rooms[r.code] = r
                    await join_room(c, r)
                else:
                    r = rooms.get(str(m.get("code", "")).strip().upper())
                    if r is None:
                        await c.send({"t": "err", "m": "No room with that code"})
                    else:
                        await join_room(c, r)
            elif t == "start":
                r = c.room
                if r is not None and c is r.players[0] and r.state == "lobby":
                    if len(r.players) < 2:
                        await c.send({"t": "err", "m": "Need 2+ players"})
                    else:
                        await r.go()
            elif t == "sig":
                r = c.room
                if r is None:
                    continue
                try:
                    to = int(m.get("to", 0))
                except (TypeError, ValueError):
                    continue
                for p in r.players:
                    if p.pid == to and p is not c:
                        await p.send({"t": "sig", "from": c.pid, "d": m.get("d")})
            elif t == "leave":
                await leave(c)
    except ConnectionClosed:
        pass
    finally:
        await leave(c)


async def ticker():
    """Public rooms: start when the countdown ends; a lone player who waits too long is sent off to play with bots."""
    while True:
        await asyncio.sleep(0.5)
        now = time.monotonic()
        for r in list(rooms.values()):
            if r.state != "lobby" or not r.public:
                continue
            if r.full() or (r.fill_at is not None and now >= r.fill_at):
                await r.go()
            elif len(r.players) == 1 and now - r.created > QUICK_ALONE_S:
                p = r.players[0]
                rooms.pop(r.code, None)
                p.room = None
                r.players.clear()
                await p.send({"t": "alone"})
            elif r.fill_at is not None:
                await r.broadcast_state()


async def process_request(connection, request):
    if request.headers.get("Upgrade", "").lower() != "websocket":
        body = json.dumps({"ok": True, "rooms": len(rooms), "players": sum(len(r.players) for r in rooms.values())}).encode()
        return connection.respond(200, body.decode() + "\n")
    return None


async def main():
    port = int(os.environ.get("PORT", "7860"))
    async with serve(handle, "0.0.0.0", port, max_size=MAX_FRAME * 2, ping_interval=20, ping_timeout=30, process_request=process_request):
        print("City Shifter matchmaker on :%d" % port, flush=True)
        await ticker()


if __name__ == "__main__":
    asyncio.run(main())
