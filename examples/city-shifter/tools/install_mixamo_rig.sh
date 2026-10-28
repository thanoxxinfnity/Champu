#!/bin/sh
# Adobe's "Mixamo Rig" Blender add-on (GPL-3, https://www.adobe.com/products/substance3d/plugins/mixamo-in-blender.html): makes an IK control rig
# for a Mixamo-rigged character and bakes animations to and from it. It does not download animations: those come from mixamo.com (Adobe sign-in).
# The 2022 release reads bpy.app.version_char, which Blender 4.2 removed: patched on install.
set -e
BL=${BLENDER:-/opt/blender-4.2.3/blender}
T=$(mktemp -d)
curl -sSL -o "$T/mixamo_rig.zip" "https://www.substance3d.com/wp-content/uploads/2022/03/30377-artwork-mixamo_rig.zip"
DIR=$("$BL" -b --python-expr "import bpy;print('UDIR',bpy.utils.user_resource('SCRIPTS',path='addons',create=True))" 2>/dev/null | sed -n 's/^UDIR //p')
unzip -qo "$T/mixamo_rig.zip" -d "$DIR"
sed -i "s/bpy.app.version_char/''/g" "$DIR/mixamo_rig/lib/version.py"
"$BL" -b --python-expr "import bpy;bpy.ops.preferences.addon_enable(module='mixamo_rig');bpy.ops.wm.save_userpref()" >/dev/null 2>&1
echo "mixamo_rig installed in $DIR"
