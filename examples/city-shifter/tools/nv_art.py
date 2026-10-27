"""Anime key-art for the battle cards: NVIDIA FLUX.1-dev, text -> image (the key comes from the environment, never from the repo).
    python3 tools/nv_art.py            # every hero that has no assets/ui/art/<id>.jpg yet
    python3 tools/nv_art.py kafu       # one hero (overwrites)
Each description is written from the hero's in-game model so the illustration shows the same person."""
import base64, concurrent.futures as cf, io, json, os, sys, urllib.error, urllib.request
from PIL import Image

URL = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'assets/ui/art')
STYLE = ('high quality anime key visual illustration, upper body portrait, three-quarter view, detailed expressive face and eyes, clean lineart, cel shading, '
         'vibrant colours, soft pastel gradient background with a few cherry blossom petals, no text, no watermark')
HEROES = {
    'outlaw': 'rugged young man with messy brown hair, red bandana over his lower face, brown leather jacket with grey metal shoulder pads, mechanical gauntlets, jetpack straps',
    'tracker': 'young woman scout with short brown hair and yellow flight goggles on her forehead, orange and navy jumpsuit, fingerless gloves',
    'mechanic': 'cheerful girl mechanic with pink hair in a bun and orange goggles, teal work jacket, green gloves, tool belt, oily smudge on her cheek',
    'viper': 'cool girl with short purple hair, orange and grey tactical suit, wrist devices, sharp confident smile',
    'ninja': 'masked tech ninja in dark blue armoured bodysuit with glowing yellow visor and yellow trim, black spiky hair',
    'school': 'cute schoolgirl with short pink hair, white sailor uniform with pink ribbon, blue pleated skirt, bright smile',
    'engineer': 'burly bearded engineer in a green utility vest with a flight cap and goggles, big orange mechanical gauntlets, friendly grin',
    'kunoichi': 'kunoichi girl with long blonde hair, magenta scarf over her face, magenta and red ninja bodysuit with an orange sash',
    'cyber': 'handsome cyberpunk young man with short messy pink hair and orange goggles, teal and black techwear jacket, neon green accents, mechanical arm',
    'samurai': 'young samurai with black hair tied back, red and black lacquered armour, katana at his hip, calm fierce eyes',
    'mage': 'frost mage girl with very long white silver hair, flowing pale blue ice robe with snowflake patterns, gentle glowing eyes',
    'monk': 'warrior monk with short orange hair in orange and yellow robes with a dark sash, prayer beads, serene strong look',
    'pirate': 'pirate captain with blue-grey hair, black tricorn hat with gold trim, long black coat with gold buttons, white cravat, charming smirk',
    'knight': 'knight girl with long blonde hair, shining silver plate armour with gold details, noble determined look',
    'kafu': 'tall elegant girl with very long straight silver-white hair and a dark visor hair ornament, white and lavender hooded long coat over a dark navy skirt with star pattern, blue accents, cool ethereal expression',
    'rachel': 'girl with very long straight pale blonde hair and blue eyes, cozy oversized white striped sweater, shy sweet smile',
    'rina': 'cheerful girl with long blonde hair, a red hairband and pink-red eyes, red high-neck sporty jacket with a black emblem, friendly smile',
    'mococo': 'cute fox girl with cream blonde hair with pink tips, white fox ears with a pink headband, fluffy cream fox tail, black and white cropped hoodie jacket with pink star details, blue eyes, playful smile',
}


def art(hid, seed=11):
    body = json.dumps({'prompt': f'{HEROES[hid]}, {STYLE}', 'width': 768, 'height': 1024, 'steps': 30, 'cfg_scale': 3.5, 'seed': seed}).encode()
    for attempt in range(3):
        req = urllib.request.Request(URL, data=body, method='POST', headers={'Authorization': 'Bearer ' + os.environ['NVIDIA_API_KEY'], 'Content-Type': 'application/json', 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=200) as r:
                j = json.load(r)
        except Exception as e:
            print(hid, 'failed', str(e)[:100])
            continue
        a = (j.get('artifacts') or [{}])[0]
        if str(a.get('finishReason', 'SUCCESS')).upper() != 'SUCCESS' or not a.get('base64'):
            print(hid, 'finish', a.get('finishReason'))
            seed += 1
            body = json.dumps({'prompt': f'{HEROES[hid]}, {STYLE}', 'width': 768, 'height': 1024, 'steps': 30, 'cfg_scale': 3.5, 'seed': seed}).encode()
            continue
        os.makedirs(OUT, exist_ok=True)
        im = Image.open(io.BytesIO(base64.b64decode(a['base64']))).convert('RGB').resize((480, 640), Image.LANCZOS)
        im.save(os.path.join(OUT, hid + '.jpg'), quality=88)
        print('saved', hid)
        return True
    return False


if __name__ == '__main__':
    ids = sys.argv[1:] or [h for h in HEROES if not os.path.exists(os.path.join(OUT, h + '.jpg'))]
    with cf.ThreadPoolExecutor(3) as ex:
        list(ex.map(art, ids))
