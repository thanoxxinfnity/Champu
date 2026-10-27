shader_type sky;
// A pastel anime sky: deep blue up, warm peach at the horizon, a big sun with a ring, and two layers of flat-edged clouds drifting by (no textures).

uniform vec3 top : source_color = vec3(0.22, 0.46, 0.92);
uniform vec3 mid : source_color = vec3(0.55, 0.78, 1.0);
uniform vec3 horizon : source_color = vec3(1.0, 0.82, 0.72);
uniform vec3 sun_dir = vec3(-0.35, 0.28, -0.9);

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
	return noise(p) * 0.55 + noise(p * 2.1) * 0.3 + noise(p * 4.3) * 0.15;
}

void sky() {
	vec3 d = normalize(EYEDIR);
	float h = clamp(d.y, -0.2, 1.0);
	vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
	col = mix(col, top, smoothstep(0.15, 0.8, h));
	// clouds on a flat dome, hard-edged so they read as drawn
	if (d.y > 0.02) {
		vec2 uv = d.xz / (d.y + 0.25) * 1.6 + vec2(TIME * 0.012, 0.0);
		float c = fbm(uv * 1.3);
		float shape = smoothstep(0.52, 0.56, c);
		float shade = smoothstep(0.52, 0.72, fbm(uv * 1.3 + vec2(0.08, -0.12)));
		vec3 cloud = mix(vec3(1.0, 0.99, 0.97), vec3(0.78, 0.84, 0.97), shade * 0.6);
		col = mix(col, cloud, shape * smoothstep(0.02, 0.2, d.y));
	}
	// the sun
	vec3 s = normalize(sun_dir);
	float a = dot(d, s);
	col += vec3(1.0, 0.92, 0.7) * smoothstep(0.9985, 0.9992, a);
	col += vec3(1.0, 0.8, 0.55) * smoothstep(0.994, 0.9985, a) * 0.35;
	col += vec3(1.0, 0.85, 0.7) * pow(max(a, 0.0), 24.0) * 0.25;
	COLOR = col;
}
