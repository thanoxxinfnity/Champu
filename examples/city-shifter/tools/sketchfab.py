"""Search and download Sketchfab models (token from the environment, never from the repo).

    set -a; . /path/to/sketchfab.env; set +a      # SKETCHFAB_TOKEN=...
    python3 tools/sketchfab.py search "low poly skyscraper" [max_faces]
    python3 tools/sketchfab.py get <uid> <out.glb>

Only downloadable models under CC0 / CC-BY are listed; credits go in assets/environment/CREDITS.md."""
import json, os, sys, urllib.request, urllib.parse, zipfile, io

API = 'https://api.sketchfab.com/v3'
TOKEN = os.environ.get('SKETCHFAB_TOKEN', '')


def get(url, auth=True):
    h = {'User-Agent': 'curl/8.5.0'}
    if auth:
        h['Authorization'] = f'Token {TOKEN}'
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=120) as r:
        return r.read()


def search(q, max_faces=60000, n=12):
    p = urllib.parse.urlencode({'q': q, 'type': 'models', 'downloadable': 'true', 'archives_flavours': 'false', 'sort_by': '-likeCount',
                                'max_face_count': max_faces, 'count': n, 'licenses': 'cc0,by'})
    for m in json.loads(get(f'{API}/search?{p}'))['results']:
        print(m['uid'], m['faceCount'], (m.get('license') or {}).get('slug'), m['name'][:50], '|', m['user']['displayName'])


def download(uid, out):
    info = json.loads(get(f'{API}/models/{uid}/download'))
    url = (info.get('glb') or info.get('gltf'))['url']
    data = get(url, auth=False)
    if info.get('glb'):
        open(out, 'wb').write(data)
    else:
        z = zipfile.ZipFile(io.BytesIO(data)); z.extractall(out + '_gltf')
    print('saved', out, len(data) // 1024, 'KB')


if __name__ == '__main__':
    if not TOKEN:
        sys.exit('set SKETCHFAB_TOKEN')
    if sys.argv[1] == 'search':
        search(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 60000)
    else:
        download(sys.argv[2], sys.argv[3])
