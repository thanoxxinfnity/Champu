shader_type spatial;
render_mode unshaded;
// The road: warm asphalt, white edge lines, a dashed yellow centre line (UV.x across the road, UV.y one unit per 8 m).

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void fragment() {
	vec2 uv = UV;
	vec3 col = vec3(0.30, 0.31, 0.37) + (hash(floor(uv * vec2(12.0, 90.0))) - 0.5) * 0.04;
	float edge = step(uv.x, 0.045) + step(0.955, uv.x);
	col = mix(col, vec3(0.95), edge);
	float centre = step(abs(uv.x - 0.5), 0.014) * step(fract(uv.y), 0.55);
	col = mix(col, vec3(1.0, 0.82, 0.25), centre);
	// slightly darker kerbs
	col *= 1.0 - 0.12 * (smoothstep(0.0, 0.03, uv.x) * 0.0 + step(uv.x, 0.012) + step(0.988, uv.x));
	ALBEDO = col;
}
