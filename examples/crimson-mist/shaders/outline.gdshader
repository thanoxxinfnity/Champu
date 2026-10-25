shader_type spatial;
// Inverted-hull ink line: the same mesh pushed out along its normals, back faces only. Added as `next_pass` of a toon material.
render_mode cull_front, unshaded, shadows_disabled;

uniform float width = 0.012;
uniform vec4 ink : source_color = vec4(0.04, 0.045, 0.06, 1.0);

void vertex() {
	VERTEX += NORMAL * width;
}

void fragment() {
	ALBEDO = ink.rgb;
}
