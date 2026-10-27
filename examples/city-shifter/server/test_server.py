"""Starts the server on a spare port and plays rooms through it. Prints ALL OK."""
import asyncio
import json
import os
import subprocess
import sys

import websockets

PORT = 7871
URL = "ws://127.0.0.1:%d" % PORT
fails = []


def check(cond, what):
    if not cond:
        fails.append(what)
        print("FAIL", what)


async def conn(name):
    ws = await websockets.connect(URL)
    await ws.send(json.dumps({"t": "hello", "name": name, "char": "outlaw"}))
    hi = json.loads(await ws.recv())
    check(hi["t"] == "hi", "hello ack")
    return ws


async def until(ws, t, n=40):
    for _ in range(n):
        m = json.loads(await asyncio.wait_for(ws.recv(), 20))
        if m["t"] == t:
            return m
    raise AssertionError("never got " + t)


async def run():
    # private room with a code, host starts
    a = await conn("A")
    await a.send(json.dumps({"t": "create", "mt": "team"}))
    r = await until(a, "room")
    code = r["code"]
    check(len(code) == 4 and r["host"] and r["you"] == 1, "host is id 1")
    bs = []
    for i in range(5):
        b = await conn("B%d" % i)
        await b.send(json.dumps({"t": "join", "code": code}))
        rr = await until(b, "room")
        check(rr["you"] == i + 2 and not rr["host"], "joiner ids 2.. in order")
        bs.append(b)
    r = await until(a, "room")
    while len(r["players"]) < 6:
        r = await until(a, "room")
    teams = [p["team"] for p in r["players"]]
    check(teams == [0, 0, 0, 0, 1, 1], "teams of 4: %s" % teams)
    # handshake relay
    await bs[0].send(json.dumps({"t": "sig", "to": 1, "d": {"k": "offer", "code": "CS1-x"}}))
    s = await until(a, "sig")
    check(s["from"] == 2 and s["d"]["code"] == "CS1-x", "sig relayed to host")
    await a.send(json.dumps({"t": "sig", "to": 2, "d": {"k": "answer"}}))
    s = await until(bs[0], "sig")
    check(s["from"] == 1, "sig relayed back")
    # a non-host cannot start
    await bs[0].send(json.dumps({"t": "start"}))
    await a.send(json.dumps({"t": "start"}))
    g = await until(bs[1], "go")
    check(len(g["players"]) == 6 and g["mt"] == "team", "go to everybody")
    # started rooms refuse new players
    late = await conn("late")
    await late.send(json.dumps({"t": "join", "code": code}))
    e = await until(late, "err")
    check("started" in e["m"], "late join refused")
    # unknown code
    await late.send(json.dumps({"t": "join", "code": "ZZZZ"}))
    e = await until(late, "err")
    check("No room" in e["m"], "bad code")
    # host leaves: the others are told
    await a.close()
    c = await until(bs[2], "closed")
    check(c["why"] == "host left", "closed when host leaves")
    for w in bs + [late]:
        await w.close()

    # 15 players max in one private room, solo = one team each
    h = await conn("H")
    await h.send(json.dumps({"t": "create", "mt": "solo"}))
    code = (await until(h, "room"))["code"]
    ws_ = []
    for i in range(14):
        w = await conn("P%d" % i)
        await w.send(json.dumps({"t": "join", "code": code}))
        await until(w, "room")
        ws_.append(w)
    x = await conn("X")
    await x.send(json.dumps({"t": "join", "code": code}))
    e = await until(x, "err")
    check("full" in e["m"], "16th player refused")
    r = await until(h, "room")
    while len(r["players"]) < 15:
        r = await until(h, "room")
    check(sorted(p["team"] for p in r["players"]) == list(range(15)), "solo: 15 different teams")
    for w in ws_ + [h, x]:
        await w.close()

    # quick match: two players meet in the same public room and it starts by itself
    q1 = await conn("Q1")
    await q1.send(json.dumps({"t": "quick", "mt": "solo"}))
    r1 = await until(q1, "room")
    q2 = await conn("Q2")
    await q2.send(json.dumps({"t": "quick", "mt": "solo"}))
    r2 = await until(q2, "room")
    check(r1["code"] == r2["code"], "quick match fills the same room")
    g = await until(q2, "go", 80)
    check(len(g["players"]) == 2, "quick match started after the countdown")
    await q1.close()
    await q2.close()


def main():
    env = dict(os.environ, PORT=str(PORT))
    here = os.path.dirname(os.path.abspath(__file__))
    srv = subprocess.Popen([sys.executable, os.path.join(here, "server.py")], env=env)
    try:
        import time
        time.sleep(1.0)
        asyncio.run(run())
    finally:
        srv.terminate()
    print("ALL OK" if not fails else "FAILED: %s" % fails)
    sys.exit(1 if fails else 0)


main()
