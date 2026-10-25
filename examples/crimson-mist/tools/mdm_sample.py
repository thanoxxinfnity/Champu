"""Text -> 3D joint motion with MDM (Human Motion Diffusion Model, Tevet et al.), CPU, without the HumanML3D dataset.
    MDM_SRC=/path/to/motion-diffusion-model python tools/mdm_sample.py out_dir prompts.json
prompts.json: [{"name": "walk", "text": "a person walks forward", "seconds": 4.0}, ...]
Writes out_dir/<name>.npy  (frames, 22, 3) SMPL joint positions, 20 fps, y up, facing +z, plus <name>.txt with the prompt.
Needs: MDM checkpoint dir (args.json + model000475000.pt) at $MDM_CKPT, HumanML3D Mean.npy/Std.npy at $MDM_STATS, OpenAI CLIP importable."""
import json, os, sys, time, types
import numpy as np
import torch

SRC = os.environ.get('MDM_SRC', '/tmp/mdm/src')
CKPT = os.environ.get('MDM_CKPT', '/tmp/mdm/save/humanml_trans_enc_512/model000475000.pt')
STATS = os.environ.get('MDM_STATS', '/tmp/mdm/hml')
sys.path.insert(0, SRC)
sys.path.insert(0, os.environ.get('CLIP_SRC', '/tmp/mdm/clip_src'))
os.chdir(SRC)

out_dir, prompts_file = sys.argv[1], sys.argv[2]
sys.argv = ['mdm', '--model_path', CKPT, '--text_prompt', 'x', '--num_samples', '1', '--num_repetitions', '1', '--seed', '10']
import model.rotation2xyz as _r2x   # SMPL body files are licensed and not needed: we only want joint positions
class _NoSMPL:
    def _apply(self, fn):
        return self

    def train(self, *a, **k):
        return self

    def to(self, *a, **k):
        return self

    def eval(self):
        return self


_r2x.Rotation2xyz = type('Rotation2xyz', (), {'__init__': lambda self, *a, **k: setattr(self, 'smpl_model', _NoSMPL())})
from utils.parser_util import generate_args
from utils.fixseed import fixseed
from utils import dist_util
from utils.model_util import create_model_and_diffusion, load_saved_model
from utils.sampler_util import ClassifierFreeSampleModel
from data_loaders.humanml.scripts.motion_process import recover_from_ric
from data_loaders.tensors import collate

args = generate_args()
fixseed(args.seed)
dist_util.setup_dist(-1)
model, diffusion = create_model_and_diffusion(args, types.SimpleNamespace(dataset=types.SimpleNamespace()))
load_saved_model(model, CKPT, use_avg=args.use_ema)
model = ClassifierFreeSampleModel(model)
model.to(dist_util.dev())
model.eval()
mean = np.load(os.path.join(STATS, 'Mean.npy'))
std = np.load(os.path.join(STATS, 'Std.npy'))
os.makedirs(out_dir, exist_ok=True)
for job in json.load(open(prompts_file)):
    path = os.path.join(out_dir, job['name'] + '.npy')
    if os.path.exists(path):
        continue
    n_frames = min(196, int(job.get('seconds', 4.0) * 20))
    _, kw = collate([{'inp': torch.zeros(n_frames), 'tokens': None, 'lengths': n_frames, 'text': job['text']}])
    kw['y'] = {k: (v.to(dist_util.dev()) if torch.is_tensor(v) else v) for k, v in kw['y'].items()}
    kw['y']['scale'] = torch.ones(1, device=dist_util.dev()) * float(job.get('guidance', 2.5))
    kw['y']['text_embed'] = model.encode_text(kw['y']['text'])
    t0 = time.time()
    sample = diffusion.p_sample_loop(model, (1, model.njoints, model.nfeats, n_frames), clip_denoised=False, model_kwargs=kw,
                                     skip_timesteps=0, init_image=None, progress=False, dump_steps=None, noise=None, const_noise=False)
    s = sample.cpu().permute(0, 2, 3, 1).numpy() * std + mean
    joints = recover_from_ric(torch.from_numpy(s).float(), 22)
    joints = joints.view(-1, *joints.shape[2:]).numpy()[0]       # (frames, 22, 3)
    np.save(path, joints)
    open(os.path.join(out_dir, job['name'] + '.txt'), 'w').write(job['text'])
    print('MOTION', job['name'], joints.shape, '%.0fs' % (time.time() - t0), flush=True)
