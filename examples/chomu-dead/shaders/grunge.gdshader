shader_type spatial;
render_mode cull_back, diffuse_burley;

// Dirty painted walls, tiled floors and stained ceilings for the clinic, in one
// shader driven by world position. `tile` > 0 draws a tile grid (the lower wall
// and the floor), `stain` is how much grime runs down the surface.

uniform vec3 base : source_color = vec3(0.55, 0.58, 0.52);
uniform vec3 low : source_color = vec3(0.22, 0.34, 0.3);
uniform float tile = 0.0;
uniform float split = 1.15;      // wall height where tiles stop and paint starts
uniform float stain = 1.0;
uniform float rough = 0.85;

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
	for (int i = 0; i < 4; i++) {
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
	bool flat_h = abs(wn.y) > 0.6;
	vec2 uv = flat_h ? wp.xz : vec2(wp.x + wp.z, wp.y);
	float n = fbm(uv * 1.4);
	float fine = vnoise(uv * 9.0);
	vec3 col = base;

	if (!flat_h && tile > 0.0 && wp.y < split) {
		col = low;
		vec2 g = fract(uv / tile);
		float line = 1.0 - smoothstep(0.0, 0.04, min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y)));
		col = mix(col, col * 0.4, line);
	} else if (flat_h && tile > 0.0) {
		vec2 g = fract(uv / tile);
		float line = 1.0 - smoothstep(0.0, 0.03, min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y)));
		float chk = step(0.5, fract(floor(uv.x / tile) * 0.5 + floor(uv.y / tile) * 0.5)) * 0.1;
		col = mix(base * (0.9 + chk), base * 0.3, line);
	}

	col *= 0.7 + n * 0.5 + fine * 0.12;
	// Grime runs down from the ceiling, damp collects near the floor.
	float drip = smoothstep(0.55, 0.8, vnoise(vec2(uv.x * 3.0, 0.0)) * (1.0 - wp.y * 0.25) + n * 0.3);
	col *= 1.0 - drip * 0.35 * stain;
	col *= 1.0 - smoothstep(0.6, 0.0, wp.y) * 0.25 * stain;
	float blood = smoothstep(0.72, 0.8, fbm(uv * 0.9 + 3.0)) * stain;
	col = mix(col, vec3(0.2, 0.015, 0.015), blood * 0.7);

	ALBEDO = col;
	ROUGHNESS = rough;
}
