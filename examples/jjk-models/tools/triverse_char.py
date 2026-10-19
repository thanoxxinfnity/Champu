"""Reference image -> textured 3D model through the Triverse API (keys from the environment, never from the repo).

    set -a; . /path/to/triverse.env; set +a        # defines TRIVERSE_KEYS="sk-a sk-b sk-c"
    python3 tools/triverse_char.py quote
    python3 tools/triverse_char.py gen gojo mahoraga     # reference/<name>.png -> raw/<name>_tv.glb

Several keys can be given; a key that runs out of credits is skipped and the next one is used."""
import json, mimetypes, os, sys, time, urllib.error, urllib.request, uuid

BASE = 'https://api.triverse.ai/api/v1'
HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, '..', 'reference')
RAW = os.path.join(HERE, '..', 'raw')
KEYS = os.environ.get('TRIVERSE_KEYS', '').split()


def call(method, path, key, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {'code': e.code, 'message': e.read().decode(errors='replace')[:400]}


def upload_image(key, path):
    boundary = uuid.uuid4().hex
    name = os.path.basename(path)
    mime = mimetypes.guess_type(path)[0] or 'image/png'
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n').encode()
    body += open(path, 'rb').read() + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(BASE + '/upload/image', method='POST', data=body,
                                 headers={'Authorization': f'Bearer {key}', 'Content-Type': f'multipart/form-data; boundary={boundary}'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {'code': e.code, 'message': e.read().decode(errors='replace')[:400]}


def download(url, dest):
    req = urllib.request.Request(url, headers={'User-Agent': 'curl/8.5.0'})  # the CDN refuses Python's default agent
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with urllib.request.urlopen(req, timeout=300) as resp, open(dest, 'wb') as f:
        f.write(resp.read())


def model_url(output):
    models = [a for a in (output or {}).get('assets', []) if a.get('type') == 'model' and a.get('format') == 'glb']
    models.sort(key=lambda a: a.get('role') != 'primary')
    return (models[0].get('download_url') or models[0].get('url')) if models else None


def quote():
    for i, k in enumerate(KEYS):
        r = call('POST', '/tasks/pricing/quote', k, {'flow_name': 'image-to-model', 'params': {}})
        d = r.get('data') or {}
        print(f'key {i + 1}: cost {d.get("cost_credits")} available {d.get("available_credits")} ({r.get("message")})')


def gen_text(name, prompt):
    """text -> textured model (used for the intact arena platform)."""
    dest = os.path.join(RAW, f'{name}_tv.glb')
    if os.path.exists(dest):
        return True
    for i, key in enumerate(KEYS):
        r = call('POST', '/tasks/text-to-model', key, {'prompt': prompt, 'polygon_limit': 60000, 'texture_size': 2048, 'turbo': False,
                                                       'client_order_id': f'jjk_{name}_{int(time.time())}', 'allow_duplicate': True})
        if r.get('code') != 0:
            print(f'[{name}] key {i + 1} submit failed: {str(r)[:200]}')
            continue
        d = r['data']
        tid = d.get('task_uuid') or d.get('uuid') or d.get('id')
        print(f'[{name}] task {tid}')
        end = time.time() + 25 * 60
        while time.time() < end:
            time.sleep(10)
            s = (call('GET', f'/tasks/{tid}', key).get('data') or {})
            if s.get('status') == 'SUCCESS':
                u = model_url(s.get('output'))
                if u:
                    download(u, dest)
                    print(f'[{name}] saved {os.path.getsize(dest) // 1024} KB')
                    return True
                return False
            if s.get('status') in ('FAILED', 'CANCELED', 'CANCELLED'):
                break
    return False


def gen(name):
    dest = os.path.join(RAW, f'{name}_tv.glb')
    if os.path.exists(dest):
        print(f'[{name}] already downloaded')
        return True
    img = os.path.join(REF, f'{name}.png')
    for i, key in enumerate(KEYS):
        up = upload_image(key, img)
        fk = (up.get('data') or {}).get('file_key') or (up.get('data') or {}).get('key')
        if not fk:
            print(f'[{name}] key {i + 1} upload failed: {str(up)[:200]}')
            continue
        r = call('POST', '/tasks/image-to-model', key, {
            'image_file': fk, 'polygon_limit': 100000, 'texture_size': 2048, 'turbo': False,
            'client_order_id': f'jjk_{name}_{int(time.time())}', 'allow_duplicate': True})
        if r.get('code') != 0:
            print(f'[{name}] key {i + 1} submit failed: {str(r)[:240]}')
            continue
        d = r['data']
        tid = d.get('task_uuid') or d.get('uuid') or d.get('id')
        print(f'[{name}] task {tid} (key {i + 1})')
        end = time.time() + 25 * 60
        while time.time() < end:
            time.sleep(10)
            s = (call('GET', f'/tasks/{tid}', key).get('data') or {})
            st = s.get('status')
            if st == 'SUCCESS':
                u = model_url(s.get('output'))
                if not u:
                    print(f'[{name}] finished, no model url: {str(s.get("output"))[:300]}')
                    return False
                download(u, dest)
                print(f'[{name}] saved {os.path.getsize(dest) // 1024} KB -> {dest}')
                return True
            if st in ('FAILED', 'CANCELED', 'CANCELLED'):
                print(f'[{name}] {st}: {s.get("message") or s.get("error") or ""}')
                break
        else:
            print(f'[{name}] timed out')
            return False
    return False


if __name__ == '__main__':
    if not KEYS:
        sys.exit('set TRIVERSE_KEYS')
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'quote'
    if cmd == 'quote':
        quote()
    elif cmd == 'text':
        sys.exit(0 if gen_text(sys.argv[2], sys.argv[3]) else 1)
    else:
        ok = all([gen(n) for n in sys.argv[2:]])
        sys.exit(0 if ok else 1)
