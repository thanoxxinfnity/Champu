#!/bin/bash
# Host and client on one machine over the Wi-Fi mode (needs a display: xvfb-run -a tests/run_lan.sh).
cd "$(dirname "$0")/.."
godot --rendering-driver opengl3 --path . --fixed-fps 60 -s tests/lan_test.gd > /tmp/cs_lan_host.raw 2>&1 &
H=$!
sleep 4
godot --rendering-driver opengl3 --path . --fixed-fps 60 -s tests/lan_test.gd -- --client > /tmp/cs_lan_client.raw 2>&1
wait $H
grep -hE "^ok|^FAIL|ALL OK|FAILED|SCRIPT ERROR|beacon" /tmp/cs_lan_host.raw; echo ---; grep -hE "^ok|^FAIL|ALL OK|FAILED|SCRIPT ERROR|beacon" /tmp/cs_lan_client.raw
