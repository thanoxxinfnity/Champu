"""A stand-in with the same shape as the Kaggle server, so the client that
talks to it can be written against something real instead of guessed at."""
import os
import struct
import sys

import gradio as gr

OUT = "/tmp/gtest/out"
os.makedirs(OUT, exist_ok=True)


def to_glb(image, seed):
    if image is None:
        raise gr.Error("Send an image.")
    # A real, minimal glTF binary: magic, version, length, one empty JSON chunk.
    doc = b'{"asset":{"version":"2.0"},"scenes":[{}],"scene":0}'
    pad = (4 - len(doc) % 4) % 4
    doc += b' ' * pad
    blob = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(doc))
    blob += struct.pack('<I4s', len(doc), b'JSON') + doc
    path = os.path.join(OUT, "mesh_%d.glb" % int(seed))
    open(path, "wb").write(blob)
    print("served", path, image.size, flush=True)
    return path


with gr.Blocks(title="Chomugiri 3D") as app:
    with gr.Row():
        picture = gr.Image(type="pil", label="Image")
        mesh = gr.Model3D(label="Mesh")
    seed = gr.Number(value=42, precision=0, label="Seed")
    gr.Button("Generate", variant="primary").click(to_glb, [picture, seed], mesh)

app.queue(max_size=8)
app.launch(server_name="127.0.0.1", server_port=7861, share=False, quiet=False)
