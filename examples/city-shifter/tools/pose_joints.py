"""2D body joints of a front render (MediaPipe Pose Landmarker), for autorig_obj.py: where the shoulders, elbows, wrists, hips, knees
and ankles really are, even when a coat, a sash or a held sword makes the mesh's outline lie.
    python3 tools/pose_joints.py front.png   -> JSON {name: [x, y, visibility]} with x, y in 0..1 of the image (y down)
Model: pose_landmarker_heavy.task in ~/.cache/mp (Google, Apache-2.0), or MP_POSE_MODEL."""
import json
import os
import sys

import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

NAMES = {11: 'shoulder.L', 12: 'shoulder.R', 13: 'elbow.L', 14: 'elbow.R', 15: 'wrist.L', 16: 'wrist.R', 19: 'index.L', 20: 'index.R',
         23: 'hip.L', 24: 'hip.R', 25: 'knee.L', 26: 'knee.R', 27: 'ankle.L', 28: 'ankle.R', 0: 'nose'}
model = os.environ.get('MP_POSE_MODEL', os.path.expanduser('~/.cache/mp/pose_heavy.task'))
opts = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=model), running_mode=vision.RunningMode.IMAGE, num_poses=1)
with vision.PoseLandmarker.create_from_options(opts) as lm:
    res = lm.detect(mp.Image.create_from_file(sys.argv[1]))
if not res.pose_landmarks:
    print('{}')
    sys.exit(0)
p = res.pose_landmarks[0]
# MediaPipe's LEFT is the person's left, which is image right for a figure facing the camera = Blender +X = our '.L'
print(json.dumps({n: [round(p[i].x, 4), round(p[i].y, 4), round(p[i].visibility, 3)] for i, n in NAMES.items()}))
