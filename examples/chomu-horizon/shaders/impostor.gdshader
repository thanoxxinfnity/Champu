shader_type spatial;
render_mode diffuse_burley, cull_disabled;

// Far trees: two crossed quads showing pre-rendered side views of the
// TRELLIS mesh (tools/prep_trellis.py). Normals point up so every quad is
// lit like the ground around it, whichever way it faces the camera.

uniform sampler2D atlas : source_color, filter_linear_mipmap;
uniform vec4 tint : source_color = vec4(1.0);

void fragment() {
	vec4 t = texture(atlas, UV);
	ALBEDO = t.rgb * COLOR.rgb * tint.rgb;
	ALPHA = t.a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
	ROUGHNESS = 0.9;
	SPECULAR = 0.15;
}
