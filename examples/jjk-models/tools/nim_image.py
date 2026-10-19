"""Text -> image with NVIDIA NIM FLUX.1-dev. NVIDIA_API_KEY comes from the environment, never from the repo.
    python3 tools/nim_image.py out.jpg "prompt" [seed] [width] [height]"""
import base64, json, os, sys, urllib.request, urllib.error
out, prompt = sys.argv[1], sys.argv[2]
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 0
w = int(sys.argv[4]) if len(sys.argv) > 4 else 1344
h = int(sys.argv[5]) if len(sys.argv) > 5 else 768
req = urllib.request.Request('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev', method='POST',
    data=json.dumps({'prompt': prompt, 'width': w, 'height': h, 'seed': seed, 'steps': 28, 'cfg_scale': 3.5}).encode(),
    headers={'Authorization': 'Bearer ' + os.environ['NVIDIA_API_KEY'], 'Accept': 'application/json', 'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req, timeout=240) as r:
        d = json.load(r)
except urllib.error.HTTPError as e:
    sys.exit('HTTP %s %s' % (e.code, e.read().decode(errors='replace')[:300]))
b64 = (d.get('artifacts') or [{}])[0].get('base64') or d.get('image')
if not b64:
    sys.exit('no image: ' + str(d)[:300])
open(out, 'wb').write(base64.b64decode(b64))
print('saved', out, os.path.getsize(out) // 1024, 'KB')
