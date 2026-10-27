#!/bin/bash
# A host and a client process play one match through a local matchmaking server (needs a display: xvfb-run -a tests/run_online_match.sh).
cd "$(dirname "$0")/.."
export CS_SERVER=ws://127.0.0.1:7873 CS_CODE_FILE=/tmp/cs_room_code
rm -f $CS_CODE_FILE $CS_CODE_FILE.done
PORT=7873 python3 server/server.py > /tmp/cs_server.log 2>&1 &
SRV=$!
sleep 1
godot --rendering-driver opengl3 --path . --fixed-fps 60 -s tests/online_match_test.gd 2>&1 | grep -E "^ok|^FAIL|ALL OK|FAILED|SCRIPT ERROR" | sed 's/^/[host]   /' > /tmp/cs_host.log &
H=$!
sleep 3
godot --rendering-driver opengl3 --path . --fixed-fps 60 -s tests/online_match_test.gd -- --client 2>&1 | grep -E "^ok|^FAIL|ALL OK|FAILED|SCRIPT ERROR" | sed 's/^/[client] /' > /tmp/cs_client.log
wait $H
kill $SRV
cat /tmp/cs_host.log /tmp/cs_client.log
