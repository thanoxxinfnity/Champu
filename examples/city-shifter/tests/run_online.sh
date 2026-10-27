#!/bin/bash
# Starts a local matchmaking server and runs the online test against it.
cd "$(dirname "$0")/.."
PORT=7872 python3 server/server.py > /tmp/cs_server.log 2>&1 &
SRV=$!
sleep 1
CS_SERVER=ws://127.0.0.1:7872 timeout 120 godot --headless --path . -s tests/online_test.gd 2>&1 | grep -v "Parameter \"m\" is null"
kill $SRV
