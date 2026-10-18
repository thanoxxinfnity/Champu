import bpy, math
bpy.ops.wm.read_factory_settings(use_empty=True)
base = "/home/user/Champu/examples/crimson-metropolis/assets/generated/lod/"
x = 0.0
for name, size in [("car_hypercar", 4.6), ("car_sedan", 4.7), ("npc_business", 1.8)]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=base + name + ".glb")
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    for r in roots:
        k = size / 2.0          # Triverse models are normalised to a 2-unit box
        r.scale = (k, k, k); r.location = (x, 0, size / 2.0 if name == "npc_business" else 0.9)
    x += 6.0
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", 'SUN')); sun.data.energy = 3
bpy.context.scene.collection.objects.link(sun); sun.location = (4, -4, 8)
def frame():
    for w in bpy.context.window_manager.windows:
        for a in w.screen.areas:
            if a.type == 'VIEW_3D':
                a.spaces[0].shading.type = 'MATERIAL'
                r3d = a.spaces[0].region_3d
                r3d.view_location = (6, 0, 1.2); r3d.view_distance = 22
                r3d.view_rotation = __import__("mathutils").Euler((math.radians(75), 0, math.radians(25))).to_quaternion()
    return None
bpy.app.timers.register(frame, first_interval=3.0)
print("OBJECTS", len(bpy.data.objects), [o.name for o in bpy.data.objects][:8])
