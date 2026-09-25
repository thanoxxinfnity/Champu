shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx, cull_disabled;

// TRELLIS vegetation: colour (and baked AO) comes from the vertex colours;
// the mesh is 1 unit tall, so VERTEX.y is the height fraction and drives
// the wind sway. A fine detail texture breaks up the flat vertex colours.

uniform float wind = 1.0;
uniform vec4 tint : source_color = vec4(1.0);
uniform sampler2D detail : source_color, filter_linear_mipmap, repeat_enable;
uniform float detail_amount = 0.35;
uniform float translucency = 0.25;

varying vec3 local_pos;

void vertex() {
	local_pos = VERTEX;
	vec3 origin = MODEL_MATRIX[3].xyz;
	float phase = origin.x * 0.071 + origin.z * 0.053;
	float h2 = VERTEX.y * VERTEX.y;
	float gust = sin(TIME * 0.35 + origin.x * 0.004) * 0.5 + 0.5;
	float sway = sin(TIME * 1.4 + phase) * 0.6 + sin(TIME * 3.1 + phase * 1.9 + VERTEX.x * 6.0) * 0.25;
	VERTEX.x += sway * wind * (0.02 + 0.03 * gust) * h2;
	VERTEX.z += cos(TIME * 1.1 + phase) * wind * 0.015 * h2;
}

void fragment() {
	float d = texture(detail, local_pos.xz * 5.0 + local_pos.y * 3.0).g;
	float speck = mix(1.0, 0.6 + d * 2.2, detail_amount);
	ALBEDO = COLOR.rgb * tint.rgb * clamp(speck, 0.55, 1.35);
	ROUGHNESS = 0.82;
	SPECULAR = 0.25;
	BACKLIGHT = ALBEDO * translucency;
}
