"""Download the Sketchfab models listed below (token from $SKETCHFAB_TOKEN, never from the repo) into raw/sf/<name>.glb and write
raw/sf/<name>.json with title, author, licence and url for assets/CREDITS.md. Only downloadable CC0 / CC-BY models are used.
    python3 tools/sketchfab_fetch.py [name ...]"""
import io, json, os, sys, urllib.request, zipfile

API = 'https://api.sketchfab.com/v3'
TOKEN = os.environ['SKETCHFAB_TOKEN']
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'raw', 'sf')

MODELS = {
    # train
    'loco': 'f0b7fdaaacd2473f877f62f350a766a5', 'car_a': '1ec9ef29c1604487a2f498df7e744c88', 'car_b': 'c59afdd9e83b4eaa805bd3f657ad8803', 'car_c': '78fc50d66e6d4e4faea410dbe13d895b',
    # city, sky
    'crate_a': 'e12fde1101b84b6da40056336a7b309d',
    'city_a': 'e0209ac5bb684d2d85e5ade96c92d2ff', 'city_b': '9f0343aff4814b758dc6e905aba5b5e0', 'city_c': 'b0035b8713b048bb8ddf311ee67c28c8', 'city_d': '5fa11d921ecf44cba0dc825fb142ec71',
    'city_e': '576141c30c2141b4aa70744091127da9', 'airship': '0c79a8305c524872a6fd55f92425eccf', 'lamp': '6881aa1e84b047d79860fa9297e05e22',
    # weapons
    'w_shift_gauntlet': '708a936c5bdc4537842f976e51cbb1a9', 'w_vortex_blaster': '3cc4cac6aa614f0fbe4a0c46db2a2c8e', 'w_quantum_breaker': '880a1de1c9104ba3bb3238355a33b5b7',
    'w_gravity_carver': '648847589fec4ecc9b91d7cdcc9c4d84', 'w_plasma_magnet': '4603956c1f824e49a1ffe8c6263317cd', 'w_sonic_impactor': 'd9ae70b5b9114088a9d7c5a644c2b981',
    'w_force_gauntlet': '4d4d2819b3c248f4b5e84f029097a51e', 'w_seismic_rebounder': '67e32e394d774516a0742949359e0e4f', 'w_saber_grapple': '3387f928a7db42bb911105b05ef76ecf',
    'w_orbital_crush': '270371dc262548ec9cfcacc514782d26', 'w_tactical_beamer': 'bf19b2ff1cf54f1a8038040c4aa5d913', 'w_thermo_vaporizer': '9d2baa7e0b9540ff9518a564ead9ce91',
    'w_chrono_sliders': 'dc8f9575856543fb9991de6efc3b39e8', 'w_nexus_tether': 'c23394d709d14772adf355da84408edc', 'w_meteor_burster': 'dfd9c2d294d54ccfa5350b42de3e26ad',
}


def get(url, auth=True):
    h = {'User-Agent': 'curl/8.5.0'}
    if auth:
        h['Authorization'] = f'Token {TOKEN}'
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=300) as r:
        return r.read()


def fetch(name, uid):
    os.makedirs(OUT, exist_ok=True)
    glb = os.path.join(OUT, name + '.glb')
    if os.path.exists(glb):
        print('have', name)
        return True
    meta = json.loads(get(f'{API}/models/{uid}'))
    lic = (meta.get('license') or {}).get('slug')
    if lic not in ('cc0', 'by'):
        print('SKIP', name, 'licence', lic)
        return False
    info = json.loads(get(f'{API}/models/{uid}/download'))
    entry = info.get('glb') or info.get('gltf')
    data = get(entry['url'], auth=False)
    if info.get('glb'):
        open(glb, 'wb').write(data)
    else:
        z = zipfile.ZipFile(io.BytesIO(data))
        d = os.path.join(OUT, name + '_gltf')
        z.extractall(d)
        open(glb + '.gltfdir', 'w').write(d)
    json.dump({'name': name, 'uid': uid, 'title': meta.get('name'), 'author': (meta.get('user') or {}).get('displayName'), 'license': lic,
               'url': meta.get('viewerUrl'), 'faces': meta.get('faceCount')}, open(os.path.join(OUT, name + '.json'), 'w'))
    print('saved', name, len(data) // 1024, 'KB', lic, '|', meta.get('name'))
    return True


if __name__ == '__main__':
    names = sys.argv[1:] or list(MODELS)
    for n in names:
        try:
            fetch(n, MODELS[n])
        except Exception as e:
            print('FAIL', n, e)
