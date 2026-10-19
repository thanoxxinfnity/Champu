"""Text -> 2D images through Triverse (seedream). TRIVERSE_KEYS from the environment.
    python3 tools/triverse_image.py out_dir name "prompt" [count]"""
import json, os, sys, time, urllib.request, urllib.error
BASE = 'https://api.triverse.ai/api/v1'
KEYS = os.environ.get('TRIVERSE_KEYS', '').split()
out_dir, name, prompt = sys.argv[1], sys.argv[2], sys.argv[3]
count = int(sys.argv[4]) if len(sys.argv) > 4 else 4


def call(method, path, key, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {'code': e.code, 'message': e.read().decode(errors='replace')[:300]}


def urls(output):
    out = []
    for a in (output or {}).get('assets', []):
        if a.get('type') == 'image':
            out.append(a.get('download_url') or a.get('url'))
    return [u for u in out if u]


os.makedirs(out_dir, exist_ok=True)
for key in KEYS:
    r = call('POST', '/tasks/image-generation', key, {'prompt': prompt, 'ai_model': 'seedream_4_5', 'image_count': count,
                                                       'client_order_id': f'{name}_{int(time.time())}', 'allow_duplicate': True})
    if r.get('code') != 0:
        print('submit failed', str(r)[:200])
        continue
    d = r['data']
    tid = d.get('task_uuid') or d.get('uuid') or d.get('id')
    print('task', tid)
    for _ in range(120):
        time.sleep(5)
        s = call('GET', f'/tasks/{tid}', key).get('data') or {}
        if s.get('status') == 'SUCCESS':
            us = urls(s.get('output'))
            if not us:
                print('no image urls:', str(s.get('output'))[:300])
                sys.exit(1)
            for i, u in enumerate(us):
                req = urllib.request.Request(u, headers={'User-Agent': 'curl/8.5.0'})
                with urllib.request.urlopen(req, timeout=120) as resp:
                    ext = '.png' if 'png' in resp.headers.get('Content-Type', '') else '.jpg'
                    open(os.path.join(out_dir, f'{name}_{i}{ext}'), 'wb').write(resp.read())
            print('saved', len(us))
            sys.exit(0)
        if s.get('status') in ('FAILED', 'CANCELED', 'CANCELLED'):
            print('failed', s.get('message'))
            break
sys.exit(1)
