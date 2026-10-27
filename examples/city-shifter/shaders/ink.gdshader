shader_type spatial;
render_mode cull_front, unshaded, depth_draw_opaque;
// Inverted-hull ink outline: the mesh again, pushed out along its normals, back faces only, flat dark colour. Used as `material_overlay`.

uniform float width = 0.018;
uniform vec4 color : source_color = vec4(0.06, 0.05, 0.12, 1.0);

void vertex() {
	// the width stays about the same on screen: grow it with the distance to the camera
	float d = length((MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz);
	VERTEX += NORMAL * width * clamp(d * 0.35, 0.6, 3.0);
}

void fragment() {
	ALBEDO = color.rgb;
}
