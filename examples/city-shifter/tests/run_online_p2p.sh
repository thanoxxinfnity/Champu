#!/bin/bash
# Two game processes meet over the internet with no server of our own (P2PMatchmaker on ntfy.sh) and play over WebRTC.
#   xvfb-run -a tests/run_online_p2p.sh          custom room (6-digit code)
#   CS_QUICK=1 xvfb-run -a tests/run_online_p2p.sh   random quick match (the wait is shortened to 20 s)
cd "$(dirname "$0")/.."
export CS_SERVER=p2p CS_CODE_FILE=/tmp/cs_room_code CS_P2P_WAIT=${CS_P2P_WAIT:-20}
rm -f $CS_CODE_FILE $CS_CODE_FILE.done
godot --rendering-driver opengl3 --path . --fixed-fps 60 -s tests/online_match_test.gd > /tmp/cs_p2p_host.raw 2>&1 &
H=$!
sleep 3
godot --rendering-driver opengl3 --path . --fixed-fps 60 -s tests/online_match_test.gd -- --client > /tmp/cs_p2p_client.raw 2>&1
wait $H
grep -hE "^ok|^FAIL|ALL OK|FAILED|SCRIPT ERROR|status:|\[p2p" /tmp/cs_p2p_host.raw | sed 's/^/[host]   /'
grep -hE "^ok|^FAIL|ALL OK|FAILED|SCRIPT ERROR|status:|\[p2p" /tmp/cs_p2p_client.raw | sed 's/^/[client] /'
