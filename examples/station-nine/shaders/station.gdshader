shader_type spatial;
render_mode cull_back, diffuse_burley;

// The station's hull: painted steel wall panels with a hazard stripe, a floor of dark
// grating, a stained ceiling. One shader driven by world position, so a box of any
// size is textured without UVs.   mode: 0 wall, 1 floor, 2 ceiling

uniform int mode = 0;
uniform vec3 base : source_color = vec3(0.34, 0.38, 0.40);
uniform vec3 trim : source_color = vec3(0.78, 0.6, 0.12);
uniform float rust = 0.5;
uniform float lit = 0.0;

varying vec3 wp;
varying vec3 wn;

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < 3; i++) {
		v += a * vnoise(p);
		p = p * 2.03 + 7.1;
		a *= 0.5;
	}
	return v;
}

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	bool horizontal = abs(wn.y) > 0.6;
	vec2 uv = horizontal ? wp.xz : vec2(wp.x + wp.z, wp.y);
	float n = fbm(uv * 0.9);
	float fine = vnoise(uv * 14.0);
	vec3 col = base;
	float rough_v = 0.78;
	float metal_v = 0.25;

	if (mode == 0) {
		// Vertical panel seams every 2 m, rivet line near the top and bottom.
		vec2 g = vec2(fract((wp.x + wp.z) / 2.0), wp.y);
		float seam = 1.0 - smoothstep(0.0, 0.025, min(g.x, 1.0 - g.x));
		col = mix(col, col * 0.45, seam);
		float rail = smoothstep(0.02, 0.0, abs(wp.y - 1.0)) + smoothstep(0.02, 0.0, abs(wp.y - 2.4));
		col = mix(col, col * 0.55, rail);
		// Hazard stripe along the bottom 0.25 m.
		if (wp.y < 0.25) {
			float s = step(0.5, fract((wp.x + wp.z + wp.y) * 2.2));
			col = mix(trim * 0.7, vec3(0.07), s);
		}
		col *= 0.78 + n * 0.5;
		// Rust runs down from the seams and collects at the floor.
		float streak = smoothstep(0.55, 0.9, vnoise(vec2((wp.x + wp.z) * 4.0, wp.y * 0.6 + 3.0)) * (1.0 - wp.y * 0.18) + n * 0.25);
		col = mix(col, vec3(0.32, 0.15, 0.06), streak * rust * 0.8);
	} else if (mode == 1) {
		// Floor grating: dark squares with lighter bars.
		vec2 g = fract(uv * 1.6);
		float bar = step(0.12, g.x) * step(0.12, g.y);
		col = mix(vec3(0.2, 0.22, 0.24), vec3(0.04, 0.045, 0.05), bar);
		col *= 0.75 + n * 0.5;
		col = mix(col, vec3(0.2, 0.1, 0.05), smoothstep(0.55, 0.85, fbm(uv * 0.5 + 9.0)) * rust * 0.6);
		metal_v = 0.5;
		rough_v = 0.55;
	} else {
		col = base * 0.5 * (0.7 + n * 0.5);
		float drip = smoothstep(0.6, 0.85, fbm(uv * 0.7 + 4.0));
		col = mix(col, vec3(0.04, 0.05, 0.04), drip * 0.5);
	}
	col *= 0.9 + fine * 0.15;
	ALBEDO = col;
	ROUGHNESS = rough_v;
	METALLIC = metal_v;
}
