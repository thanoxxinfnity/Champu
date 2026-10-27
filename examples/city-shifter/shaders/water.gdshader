shader_type spatial;
render_mode unshaded, blend_mix;
// Anime river: flat turquoise with drifting white ripple bands and a bright edge, slightly see-through.

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	vec2 uv = UV * vec2(2.0, 60.0);
	float w = noise(uv * vec2(1.4, 0.6) + vec2(0.0, TIME * 0.6));
	float band = smoothstep(0.62, 0.66, w);
	vec3 col = mix(vec3(0.20, 0.62, 0.86), vec3(0.45, 0.85, 0.98), band);
	float edge = smoothstep(0.42, 0.5, abs(UV.x - 0.5));
	col = mix(col, vec3(0.9, 1.0, 1.0), edge);
	ALBEDO = col;
	ALPHA = 0.88;
}
