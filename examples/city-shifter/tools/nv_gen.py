"""Text -> textured .glb through NVIDIA's hosted TRELLIS (key from the environment, never from the repo). Rules measured in src/lib/suites/godot/trellis.ts:
body is `prompt` only, Content-Type exactly application/json, failures stall ~90 s and succeed in ~15 s, so race two short attempts and repeat.
    python3 tools/nv_gen.py <name> "<prompt>"          # -> raw/<name>_nv.glb
"""
import base64, json, os, sys, time, urllib.error, urllib.request, concurrent.futures as cf

URL = 'https://ai.api.nvidia.com/v1/genai/microsoft/trellis'
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'raw')
HINT = 'a single complete object, fully textured, clean geometry, plain background'


def attempt(prompt, key, timeout=45):
    body = json.dumps({'prompt': f'{prompt[:420]}, {HINT}'}).encode()
    req = urllib.request.Request(URL, data=body, method='POST', headers={
        'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'Accept': 'application/json', 'NVCF-POLL-SECONDS': '60'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            j = json.load(r)
    except urllib.error.HTTPError as e:
        return None, f'{e.code} {e.read().decode(errors="replace")[:120]}'
    except Exception as e:
        return None, str(e)[:120]
    a = (j.get('artifacts') or [{}])[0]
    if str(a.get('finishReason', 'SUCCESS')).upper() != 'SUCCESS' or not a.get('base64'):
        return None, f'finish {a.get("finishReason")}'
    return base64.b64decode(a['base64']), ''


def gen(name, prompt, rounds=10):
    key = os.environ.get('NVIDIA_API_KEY', '')
    if not key:
        sys.exit('set NVIDIA_API_KEY')
    dest = os.path.join(RAW, f'{name}_nv.glb')
    if os.path.exists(dest):
        return True
    os.makedirs(RAW, exist_ok=True)
    err = ''
    for r in range(rounds):
        with cf.ThreadPoolExecutor(2) as ex:
            for data, err in ex.map(lambda _: attempt(prompt, key), range(2)):
                if data and data[:4] == b'glTF':
                    open(dest, 'wb').write(data)
                    print(f'[{name}] saved {len(data) // 1024} KB (round {r + 1})')
                    return True
        if '401' in err or '403' in err:
            print(f'[{name}] key refused: {err}')
            return False
        time.sleep(3)
    print(f'[{name}] failed: {err}')
    return False


if __name__ == '__main__':
    sys.exit(0 if gen(sys.argv[1], sys.argv[2]) else 1)
