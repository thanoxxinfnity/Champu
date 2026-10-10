shader_type spatial;
render_mode unshaded;

// A dead monitor that is not dead: static, rolling bars, and every few seconds a grin that is there for a blink.
uniform float seed = 0.0;

float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void fragment() {
	vec2 uv = UV;
	float t = TIME + seed * 7.0;
	float n = h(floor(uv * vec2(160.0, 120.0)) + floor(t * 24.0));
	float bar = smoothstep(0.0, 0.04, abs(fract(uv.y * 1.5 - t * 0.35) - 0.5) - 0.42);
	vec3 col = vec3(n * 0.55 + 0.1) * (0.7 + 0.3 * bar);
	col *= vec3(0.75, 1.0, 0.9);
	// The grin: a wide arc of teeth, on for 0.18 s out of every ~4.
	float on = step(0.955, fract(t * 0.23 + seed));
	vec2 p = (uv - vec2(0.5, 0.42)) * vec2(1.0, 1.3);
	float arc = abs(length(p * vec2(0.9, 1.6) + vec2(0.0, 0.22)) - 0.36);
	float lower = step(p.y, 0.02 + 0.0);
	float mouth = smoothstep(0.045, 0.02, arc) * lower;
	float teeth = step(0.5, fract(p.x * 22.0)) * smoothstep(0.1, 0.03, arc);
	vec2 e = abs(uv - vec2(0.5, 0.62)) - vec2(0.2, 0.0);
	float eyes = smoothstep(0.05, 0.02, length(vec2(abs(uv.x - 0.5) - 0.17, uv.y - 0.64)));
	col = mix(col, vec3(0.9, 0.95, 0.85) * (mouth * 0.6 + teeth * 0.5) + vec3(eyes) * vec3(1.0, 0.2, 0.1), on * clamp(mouth + teeth + eyes, 0.0, 1.0));
	ALBEDO = col * (0.8 + 0.2 * sin(t * 90.0));
}
