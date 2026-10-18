#!/usr/bin/env python3
"""Generate the game's 3D models with the Triverse API (text-to-model) and download them.

    TRIVERSE_API_KEY=sk-... python3 tools/gen_assets.py [name ...]      # default: everything in MANIFEST
    python3 tools/gen_assets.py --list
    python3 tools/gen_assets.py --quote                                   # credits needed vs available, spends nothing

The key is read from the environment only — never put it in a file that is committed. Every task is submitted with a
stable client_order_id ("cm_<name>"), so re-running after a crash or a timeout resubmits nothing that is already paid
for. Raw downloads land in assets/generated/raw/<name>.glb; tools/prep_assets.sh turns them into game-sized GLBs.
Standard library only.
"""
import json
import concurrent.futures as cf
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://api.triverse.ai/api/v1"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "generated", "raw")

# name -> (prompt, turbo). Prompts are short and say what the silhouette is; the game scales/places everything itself.
NEG = "low quality, blurry, floating parts, extra wheels, text, watermark, ground plate, base platform"
MANIFEST: dict[str, tuple[str, bool]] = {
    # vehicles (wheels come baked into the body)
    "car_sedan": ("realistic grey four-door sedan car, game asset, side view, wheels on, clean paint", False),
    "car_muscle": ("realistic matte black American muscle car coupe, game asset, wheels on", False),
    "car_police": ("realistic police patrol car black and white with roof light bar, game asset, wheels on", False),
    "car_hypercar": ("realistic red sports hypercar, low wide body, game asset, wheels on", False),
    # architecture
    "safehouse": ("modern luxury two storey mansion with flat roof, glass and white concrete, front double doors, attached garage, game asset", False),
    "skyscraper": ("tall modern glass skyscraper office tower, blue tinted glass facade, rooftop helipad, game asset", False),
    "tower_a": ("tall modern concrete and glass office high-rise building, game asset", True),
    "tower_b": ("art deco brick apartment tower with fire escape, game asset", True),
    "shop_block": ("two storey city street shop building with awning and shutters, game asset", True),
    # street props
    "palm_tree": ("tall california palm tree, game asset", True),
    "streetlight": ("modern city street lamp post, game asset", True),
    "traffic_light": ("city traffic light on a pole, game asset", True),
    # people (RigNet rigs these)
    "npc_business": ("man in business suit standing in a T-pose with arms straight out, full body, game character", False),
    "npc_casual": ("young woman in jeans and hoodie standing in a T-pose with arms straight out, full body, game character", False),
    "npc_street": ("man in streetwear jacket and cap standing in a T-pose with arms straight out, full body, game character", False),
    "npc_police": ("police officer in dark uniform and cap standing in a T-pose with arms straight out, full body, game character", False),
}


def call(method: str, path: str, key: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        BASE + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"code": e.code, "message": e.read().decode(errors="replace")[:400]}


def quote(key: str, names: list[str]) -> None:
    need = 0
    for n in names:
        r = call("POST", "/tasks/pricing/quote", key, {"flow_name": "text-to-model", "params": {"turbo": MANIFEST[n][1]}})
        need += r["data"]["cost_credits"]
        avail = r["data"]["available_credits"]
    print(f"{len(names)} models need {need} credits; {avail} available")


def primary_model_url(output: dict) -> str | None:
    """output.assets is a list; the textured GLB is the asset with type "model" and role "primary"."""
    models = [a for a in (output or {}).get("assets", []) if a.get("type") == "model" and a.get("format") == "glb"]
    models.sort(key=lambda a: a.get("role") != "primary")
    return (models[0].get("download_url") or models[0].get("url")) if models else None


def download(url: str, dest: str) -> None:
    # The CDN refuses Python's default User-Agent with a 403.
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.5.0"})
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with urllib.request.urlopen(req, timeout=300) as resp, open(dest, "wb") as f:
        f.write(resp.read())


def generate(key: str, name: str) -> bool:
    dest = os.path.join(OUT, name + ".glb")
    if os.path.exists(dest):
        print(f"[{name}] already downloaded")
        return True
    prompt, turbo = MANIFEST[name]
    r = call("POST", "/tasks/text-to-model", key, {
        "prompt": prompt, "negative_prompt": NEG, "polygon_limit": 60000, "texture_size": 1024,
        "turbo": turbo, "client_order_id": f"cm_{name}", "allow_duplicate": True,
    })
    if r.get("code") != 0:
        print(f"[{name}] submit failed: {r}")
        return False
    data = r["data"]
    uuid = data.get("task_uuid") or data.get("uuid") or data.get("id")
    print(f"[{name}] task {uuid}")
    deadline = time.time() + 20 * 60
    while time.time() < deadline:
        time.sleep(8)
        s = call("GET", f"/tasks/{uuid}", key)
        d = s.get("data") or {}
        status = d.get("status")
        if status == "SUCCESS":
            pick = primary_model_url(d.get("output"))
            if not pick:
                print(f"[{name}] finished but no model url")
                return False
            download(pick, dest)
            print(f"[{name}] saved {os.path.getsize(dest) // 1024} KB")
            return True
        if status in ("FAILED", "CANCELED", "CANCELLED"):
            print(f"[{name}] {status}: {d.get('message') or d.get('error') or ''}")
            return False
    print(f"[{name}] timed out")
    return False


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--list" in sys.argv:
        for n, (p, t) in MANIFEST.items():
            print(f"{n:14s} {'turbo' if t else 'quality'}  {p}")
        return 0
    key = os.environ.get("TRIVERSE_API_KEY", "")
    if not key:
        print("set TRIVERSE_API_KEY")
        return 2
    names = args or list(MANIFEST)
    unknown = [n for n in names if n not in MANIFEST]
    if unknown:
        print("unknown:", unknown)
        return 2
    if "--quote" in sys.argv:
        quote(key, names)
        return 0
    # Tasks run server-side, so submit and wait for several at once instead of one after another.
    with cf.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda n: generate(key, n), names))
    print("done:", sum(results), "of", len(results))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
