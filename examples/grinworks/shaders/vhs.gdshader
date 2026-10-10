shader_type canvas_item;

// An old tape: dark green-grey glass, scanlines, a band of tracking noise that rolls up the picture, and a shiver.
uniform float strength = 1.0;

float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void fragment() {
	vec2 uv = UV;
	float roll = fract(TIME * 0.12);
	float band = smoothstep(0.04, 0.0, abs(uv.y - roll));
	float shift = (h(vec2(floor(uv.y * 90.0), floor(TIME * 12.0))) - 0.5) * 0.02 * (0.3 + band * 6.0);
	float n = h(floor((uv + vec2(shift, 0.0)) * vec2(220.0, 140.0)) + floor(TIME * 24.0));
	float scan = 0.82 + 0.18 * sin(uv.y * 540.0);
	vec3 col = vec3(0.03, 0.05, 0.045) + vec3(n * 0.10) + band * 0.18;
	col *= scan;
	float d = length(uv - 0.5);
	col *= 1.0 - smoothstep(0.35, 0.8, d) * 0.7;
	COLOR = vec4(col, 0.94 * strength);
}
