"""Run RigNet inference on any mesh, on CPU, without the bundled binvox executable.

python rignet_run.py <mesh.obj|glb|ply> <out_dir> [--bandwidth 0.045] [--threshold 7.5e-6] [--verts 4000]

Writes <out_dir>/<name>_ori.obj, <name>_remesh.obj and <name>_ori_rig.txt (RigNet's own rig format:
joint / root / hier / skin lines, vertex ids in the _ori.obj order).
"""
import argparse
import os
import sys

import numpy as np
import open3d as o3d
import torch
import trimesh
from scipy import ndimage
from torch_geometric.data import Data
from torch_geometric.utils import add_self_loops

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import quick_start as qs  # noqa: E402  (its __main__ block does not run on import)
from utils import binvox_rw  # noqa: E402
from geometric_proc.common_ops import calc_surface_geodesic  # noqa: E402
from models.GCN import JOINTNET_MASKNET_MEANSHIFT as JOINTNET  # noqa: E402
from models.PairCls_GCN import PairCls as BONENET  # noqa: E402
from models.ROOT_GCN import ROOTNET  # noqa: E402
from models.SKINNING import SKINNET  # noqa: E402


def voxelize(obj_path: str, dims: int = 88) -> binvox_rw.Voxels:
    """binvox -d 88 equivalent: a solid occupancy grid over the mesh's bounding cube, xyz order."""
    m = trimesh.load(obj_path, force="mesh", process=False)
    mn = m.bounds[0].astype(float)
    ext = float((m.bounds[1] - m.bounds[0]).max())
    pitch = ext / dims
    pts, _ = trimesh.sample.sample_surface(m, 600_000)
    idx = np.clip(np.floor((pts - mn) / pitch).astype(int), 0, dims - 1)
    grid = np.zeros((dims, dims, dims), dtype=bool)
    grid[idx[:, 0], idx[:, 1], idx[:, 2]] = True
    grid = ndimage.binary_closing(grid, iterations=1)
    grid = ndimage.binary_fill_holes(grid)
    return binvox_rw.Voxels(grid, [dims, dims, dims], [float(x) for x in mn], ext, "xyz")


def create_data(remesh_path: str):
    mesh = o3d.io.read_triangle_mesh(remesh_path)
    mesh.compute_vertex_normals()
    v = np.asarray(mesh.vertices).copy()
    vn = np.asarray(mesh.vertex_normals)
    f = np.asarray(mesh.triangles)
    v, translation, scale = qs.normalize_obj(v)
    norm_path = remesh_path.replace("_remesh.obj", "_normalized.obj")
    o3d.io.write_triangle_mesh(norm_path, o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(v), o3d.utility.Vector3iVector(f)))

    vt = torch.from_numpy(np.concatenate((v, vn), axis=1)).float()
    tpl_e = torch.from_numpy(qs.get_tpl_edges(v, f).T).long()
    tpl_e, _ = add_self_loops(tpl_e, num_nodes=vt.size(0))
    surface_geodesic = calc_surface_geodesic(mesh)
    geo_e = torch.from_numpy(qs.get_geo_edges(surface_geodesic, v).T).long()
    geo_e, _ = add_self_loops(geo_e, num_nodes=vt.size(0))
    vox = voxelize(norm_path)
    data = Data(x=vt[:, 3:6], pos=vt[:, 0:3], tpl_edge_index=tpl_e, geo_edge_index=geo_e,
                batch=torch.zeros(len(vt), dtype=torch.long))
    return data, vox, surface_geodesic, translation, scale, norm_path


def load_nets(device):
    ck = os.path.join(os.path.dirname(os.path.abspath(__file__)), "checkpoints")

    def load(net, name):
        state = torch.load(os.path.join(ck, name, "model_best.pth.tar"), map_location="cpu", weights_only=False)
        net.load_state_dict(state["state_dict"])
        return net.to(device).eval()

    return (load(JOINTNET(), "gcn_meanshift"), load(ROOTNET(), "rootnet"), load(BONENET(), "bonenet"),
            load(SKINNET(nearest_bone=5, use_Dg=True, use_Lf=True), "skinnet"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mesh")
    ap.add_argument("out_dir")
    ap.add_argument("--bandwidth", type=float, default=None)
    ap.add_argument("--threshold", type=float, default=1e-5)
    ap.add_argument("--verts", type=int, default=2800)
    a = ap.parse_args()

    name = os.path.splitext(os.path.basename(a.mesh))[0]
    os.makedirs(a.out_dir, exist_ok=True)
    ori = os.path.join(a.out_dir, f"{name}_ori.obj")
    remesh = os.path.join(a.out_dir, f"{name}_remesh.obj")

    # Generated meshes have a duplicated vertex along every texture seam; welding them makes the surface one connected piece, which
    # is what quadric decimation and RigNet's geodesic distances need (unwelded, a 60k-face model stays near 10k vertices).
    m = trimesh.load(a.mesh, force="mesh", process=True)
    m.merge_vertices(digits_vertex=5)
    m.export(ori)
    mo = o3d.io.read_triangle_mesh(ori)
    mr = mo.simplify_quadric_decimation(a.verts * 2) if len(mo.triangles) > a.verts * 2 else mo
    o3d.io.write_triangle_mesh(remesh, mr)
    print(f"ori {len(mo.vertices)} verts -> remesh {len(mr.vertices)} verts")

    qs.device = torch.device("cpu")
    # Open3D's visualizer blocks forever on a machine with no display; RigNet only uses it to draw previews.
    qs.show_obj_skel = lambda *a, **k: None
    qs.draw_shifted_pts = lambda *a, **k: None
    qs.show_mesh_vox = lambda *a, **k: None
    qs.output_folder = a.out_dir
    joint_net, root_net, bone_net, skin_net = load_nets(qs.device)

    data, vox, geo, translation, scale, norm_path = create_data(remesh)
    print("predicting joints")
    data = qs.predict_joints(data, vox, joint_net, a.threshold, bandwidth=a.bandwidth, mesh_filename=norm_path)
    print("predicting connectivity")
    skel = qs.predict_skeleton(data, vox, root_net, bone_net, mesh_filename=norm_path)
    print("predicting skinning")
    rig = qs.predict_skinning(data, skel, skin_net, geo, norm_path, subsampling=True)
    rig.normalize(scale, -translation)
    rig = qs.tranfer_to_ori_mesh(ori, remesh, rig)
    out = ori.replace(".obj", "_rig.txt")
    rig.save(out)
    print("saved", out)


if __name__ == "__main__":
    main()
