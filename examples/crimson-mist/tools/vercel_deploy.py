"""Deploy a static folder to Vercel through the REST API (no CLI). Token from $VERCEL_TOKEN (env file outside the repo).
    python3 tools/vercel_deploy.py build/web crimson-mist"""
import hashlib, json, os, sys, urllib.error, urllib.request

TOKEN = os.environ['VERCEL_TOKEN']
folder, project = sys.argv[1], sys.argv[2]
H = {'Authorization': 'Bearer ' + TOKEN, 'User-Agent': 'curl/8'}


def call(url, data=None, headers=None, method=None, timeout=900):
    req = urllib.request.Request(url, data=data, headers={**H, **(headers or {})}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{url} -> {e.code} {e.read().decode()[:400]}')


files = []
for name in sorted(os.listdir(folder)):
    p = os.path.join(folder, name)
    if not os.path.isfile(p):
        continue
    data = open(p, 'rb').read()
    sha = hashlib.sha1(data).hexdigest()
    print('upload', name, len(data) // 1024, 'KB', flush=True)
    call('https://api.vercel.com/v2/files', data, {'Content-Type': 'application/octet-stream', 'x-vercel-digest': sha, 'Content-Length': str(len(data))})
    files.append({'file': name, 'sha': sha, 'size': len(data)})
body = {'name': project, 'files': files, 'target': 'production', 'projectSettings': {'framework': None, 'buildCommand': None, 'outputDirectory': None}}
d = call('https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1', json.dumps(body).encode(), {'Content-Type': 'application/json'})
print('deployment', d.get('id'), d.get('url'), d.get('readyState'))
print('alias', d.get('alias'))
