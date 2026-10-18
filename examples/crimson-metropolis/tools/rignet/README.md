# RigNet (neural rigging) in this project

[RigNet](https://github.com/zhan-xu/RigNet) (Xu et al., SIGGRAPH 2020, GPL-3.0) predicts a skeleton for a character mesh.
Here it measures where the joints of each generated humanoid are; `tools/rignet_profile.py` turns that into the bone-height
profile `scripts/player/rig.gd` rigs the model with.

**What it is and is not used for.** On realistic, clothed humans RigNet's joint *positions* are good (knee, ankle, elbow,
wrist, neck and head within a few percent of the parametric defaults, and it finds each model's own arm-line height, which
differs a lot between models). Its bone *connectivity* is not (a leg hangs off a spine joint), so its skinning cannot drive a
walk cycle. Only the positions are used; connectivity, skin weights and animation come from `rig.gd` and `tools/bake_rig.gd`.

## Setup that worked (CPU only, Ubuntu 24.04, Python 3.12)

```bash
git clone https://github.com/zhan-xu/RigNet.git && cd RigNet
git apply /path/to/tools/rignet/rignet-modern-python.patch     # numpy>=1.24, PyG 2.x, torch_cluster knn/fps (see patch)
cp /path/to/tools/rignet/rignet_run.py .

uv venv --python 3.12 venv && source venv/bin/activate
uv pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
uv pip install torch_scatter torch_cluster torch_sparse -f https://data.pyg.org/whl/torch-2.5.0+cpu.html
uv pip install "numpy<2" scipy matplotlib opencv-python-headless "trimesh[easy]" rtree torch-geometric tensorboard open3d pygltflib
sudo apt-get install -y libegl1 libgl1 libgomp1              # open3d needs them even headless

# trained weights (the authors' link, ~190 MB):
#   https://drive.google.com/file/d/1gM2Lerk7a2R0g9DwlK3IvCfp8c2aFVXs   ->  unzip so that ./checkpoints/ exists
python rignet_run.py path/to/npc.glb out_dir/npc            # ~5 min and a few GB of RAM per model, one at a time
python3 /path/to/tools/rignet_profile.py path/to/npc.glb out_dir/npc/npc_ori_rig.txt assets/generated/npc_profile.json
```

Notes from getting it to run:
- The bundled `binvox` voxelizer is an opaque prebuilt executable; `rignet_run.py` voxelizes in Python instead (same output format).
- Open3D's preview window blocks forever without a display, so the previews are stubbed out.
- Memory grows with the square of the vertex count (10k vertices ≈ 6–14 GB). Four at once ran out of memory; run one at a time.
