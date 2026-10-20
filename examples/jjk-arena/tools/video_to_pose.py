"""Turn a video of a person/mannequin into PoseLib parameter keyframes (MediaPipe pose landmarker, 3D world landmarks).

    pip install mediapipe opencv-python-headless
    python3 tools/video_to_pose.py in.mp4 assets/anim/name.json [fps] [facing=camera|left|right]

facing: which way the figure faces in the picture. camera = towards the viewer (front view); left/right = a side view looking that way.
Output {"fps": n, "frames": [{lean, roll, uL, fL, uR, fR, tL, sL, ftL, tR, sR, ftR}, ...]} in PoseLib model space (+X left, +Y up, +Z forward);
right-side vectors are written mirrored, as PoseLib expects."""
import json, sys, math
import numpy as np
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

src, out = sys.argv[1], sys.argv[2]
fps_out = float(sys.argv[3]) if len(sys.argv) > 3 else 12.0
facing = sys.argv[4] if len(sys.argv) > 4 else 'camera'
MODEL = '/tmp/vid/pose.task'

opts = vision.PoseLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=MODEL), running_mode=vision.RunningMode.VIDEO,
                                    num_poses=1, min_pose_detection_confidence=0.3, min_pose_presence_confidence=0.3, min_tracking_confidence=0.3)
lm = vision.PoseLandmarker.create_from_options(opts)
cap = cv2.VideoCapture(src)
vfps = cap.get(cv2.CAP_PROP_FPS) or 24.0
step = max(1, round(vfps / fps_out))
frames, i = [], 0

def v(p, a):
    return np.array([p[a].x, p[a].y, p[a].z])

def to_model(d):
    """mediapipe world (x right, y down, z away from camera) -> model space for a figure facing `facing`."""
    x, y, z = d
    up = -y
    if facing == 'camera':
        return np.array([x, up, -z])
    # side view: the figure faces image-left/right; forward = image x towards where it looks, left side = towards the camera (-z)
    fwd = -x if facing == 'left' else x
    return np.array([-z if facing == 'left' else z, up, fwd])

def norm(d):
    n = np.linalg.norm(d)
    return d / n if n > 1e-6 else np.array([0, -1, 0])

while True:
    ok, img = cap.read()
    if not ok:
        break
    if i % step == 0:
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(i / vfps * 1000))
        if res.pose_world_landmarks:
            p = res.pose_world_landmarks[0]
            M = lambda a, b: to_model(v(p, b) - v(p, a))
            mid_sh = (v(p, 11) + v(p, 12)) / 2
            mid_hip = (v(p, 23) + v(p, 24)) / 2
            spine = to_model(mid_sh - mid_hip)
            lean = math.degrees(math.atan2(spine[2], spine[1]))
            roll = math.degrees(math.atan2(spine[0], spine[1]))
            def mir(d):
                return [-d[0], d[1], d[2]]
            f = {'lean': lean, 'roll': roll,
                 'uL': M(11, 13).tolist(), 'fL': M(13, 15).tolist(), 'tL': M(23, 25).tolist(), 'sL': M(25, 27).tolist(), 'ftL': M(29, 31).tolist(),
                 'uR': mir(M(12, 14)), 'fR': mir(M(14, 16)), 'tR': mir(M(24, 26)), 'sR': mir(M(26, 28)), 'ftR': mir(M(30, 32))}
            for k in ('uL', 'fL', 'tL', 'sL', 'ftL', 'uR', 'fR', 'tR', 'sR', 'ftR'):
                f[k] = [round(float(c), 4) for c in norm(np.array(f[k]))]
            f['lean'] = round(lean, 2); f['roll'] = round(roll, 2)
            frames.append(f)
        else:
            frames.append(frames[-1] if frames else None)
    i += 1
frames = [f for f in frames if f]
json.dump({'fps': vfps / step, 'frames': frames}, open(out, 'w'))
print(out, len(frames), 'frames, lean range', min(f['lean'] for f in frames), max(f['lean'] for f in frames))
