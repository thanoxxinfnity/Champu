#!/bin/bash
# Friends, invite, squad, ready, start: two processes over the internet relay.   xvfb-run -a tests/run_social.sh
cd "$(dirname "$0")/.."
export CS_SOCIAL=1 CS_UID_FILE=/tmp/cs_uid
rm -f $CS_UID_FILE $CS_UID_FILE.b
godot --rendering-driver opengl3 --path . --fixed-fps 60 -s tests/social_test.gd > /tmp/cs_soc_a.raw 2>&1 &
A=$!
sleep 3
godot --rendering-driver opengl3 --path . --fixed-fps 60 -s tests/social_test.gd -- --b > /tmp/cs_soc_b.raw 2>&1
wait $A
grep -hE "^ok|^FAIL|ALL OK|FAILED|SCRIPT ERROR" /tmp/cs_soc_a.raw | sed 's/^/[A] /'
grep -hE "^ok|^FAIL|ALL OK|FAILED|SCRIPT ERROR" /tmp/cs_soc_b.raw | sed 's/^/[B] /'
