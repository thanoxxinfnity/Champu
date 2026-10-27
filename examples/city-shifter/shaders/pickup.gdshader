shader_type spatial;
render_mode cull_disabled;
// A weapon lying on the ground: it floats, spins slowly (each one out of step with the next) and glows at the rim in its own colour.

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap;
uniform bool has_tex = false;
uniform vec4 tint : source_color = vec4(1.0);
uniform vec4 glow : source_color = vec4(0.4, 0.8, 1.0, 1.0);

void vertex() {
	float t = TIME * 1.4 + MODEL_MATRIX[3].x * 0.37 + MODEL_MATRIX[3].z * 0.53;
	float c = cos(t);
	float s = sin(t);
	vec2 xz = vec2(c * VERTEX.x - s * VERTEX.z, s * VERTEX.x + c * VERTEX.z);
	VERTEX.x = xz.x;
	VERTEX.z = xz.y;
	vec2 nz = vec2(c * NORMAL.x - s * NORMAL.z, s * NORMAL.x + c * NORMAL.z);
	NORMAL.x = nz.x;
	NORMAL.z = nz.y;
	VERTEX.y += 1.5 + sin(t * 1.3) * 0.15;
}

void fragment() {
	vec3 col = has_tex ? texture(albedo_tex, UV).rgb : vec3(0.75);
	float rim = pow(1.0 - clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0), 2.2);
	ALBEDO = col * tint.rgb;
	EMISSION = glow.rgb * rim * 1.6 + col * 0.35;
}
