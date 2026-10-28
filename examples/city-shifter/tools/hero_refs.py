"""Full-body reference sheets for image-to-3D (Triverse): the same hero descriptions as the battle-card art (tools/nv_art.py), but the whole
body from head to shoes, front view, arms a little away from the body (an A-pose rigs cleanly), plain white background.
    set -a; . ~/.city-shifter-nv.env; set +a; python3 tools/hero_refs.py [hero ...]     -> reference/hero_<id>.png"""
import base64, concurrent.futures as cf, io, json, os, sys, urllib.request
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nv_art import HEROES, URL, ROOT

STYLE = ('full body 3D game character model reference, standing straight in a relaxed A-pose with both arms held slightly away from the body, '
         'front view facing the camera, the whole figure visible from the top of the head down to the shoes, symmetrical, anime style, '
         'clean shapes, plain flat white background, no shadow, no text, no props on the ground')
OUT = os.path.join(ROOT, 'reference')


def ref(hid, seed=21):
    for attempt in range(3):
        body = json.dumps({'prompt': f'{HEROES[hid]}, {STYLE}', 'width': 768, 'height': 1024, 'steps': 30, 'cfg_scale': 3.5, 'seed': seed + attempt}).encode()
        req = urllib.request.Request(URL, data=body, method='POST', headers={'Authorization': 'Bearer ' + os.environ['NVIDIA_API_KEY'],
                                     'Content-Type': 'application/json', 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                j = json.load(r)
        except Exception as e:
            print(hid, 'failed', str(e)[:120])
            continue
        a = (j.get('artifacts') or [{}])[0]
        if str(a.get('finishReason', 'SUCCESS')).upper() != 'SUCCESS' or not a.get('base64'):
            print(hid, 'finish', a.get('finishReason'))
            continue
        Image.open(io.BytesIO(base64.b64decode(a['base64']))).convert('RGB').save(os.path.join(OUT, f'hero_{hid}.png'))
        print('saved', hid)
        return True
    return False


def ref_pollinations(hid, seed=21):
    """Fallback when the NVIDIA endpoint is down: Pollinations (keyless). Its corner watermark is cut off."""
    import urllib.parse
    # a T-pose (arms straight out to the sides) is what tools/autorig_obj.py --adaptive measures; an A-pose rigged into a tangle
    prompt = f'{HEROES[hid]}, anime style 3D game character in a strict T-pose, both arms stretched straight out horizontally to the sides at ' \
             f'shoulder height, palms down, legs straight and slightly apart, full body from head to shoes, front view, symmetrical, ' \
             f'plain white background, soft studio light, character turnaround reference'
    url = 'https://image.pollinations.ai/prompt/' + urllib.parse.quote(prompt) + f'?width=1024&height=1024&nologo=true&model=flux&seed={seed}'
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'curl/8.5.0'})
            with urllib.request.urlopen(req, timeout=180) as r:
                im = Image.open(io.BytesIO(r.read())).convert('RGB')
        except Exception as e:
            print(hid, 'failed', str(e)[:120])
            import time
            time.sleep(20)
            continue
        w, h = im.size
        im = im.crop((0, 0, w, int(h * 0.93)))
        im.save(os.path.join(OUT, f'hero_{hid}.png'))
        print('saved', hid, im.size)
        return True
    return False


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    ids = args or [h for h in HEROES if h not in ('kafu', 'rachel', 'rina', 'mococo')]
    fn = ref_pollinations if '--pollinations' in sys.argv else ref
    with cf.ThreadPoolExecutor(1 if fn is ref_pollinations else 3) as ex:      # (Pollinations answers 402 to parallel calls)
        list(ex.map(fn, ids))
