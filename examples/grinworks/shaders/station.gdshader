shader_type spatial;
render_mode cull_back, diffuse_burley;

// A toy factory, painted like a nursery and left to rot: wallpaper with polka dots above a coloured
// wainscot, checkerboard floors, a stained ceiling. One shader driven by world position, so a box of any
// size is textured without UVs.   mode: 0 wall, 1 floor, 2 ceiling

uniform int mode = 0;
uniform vec3 base : source_color = vec3(0.10, 0.50, 0.56);   // wall: paper    floor: tile A
uniform vec3 trim : source_color = vec3(0.96, 0.76, 0.18);   // wall: wainscot floor: tile B
uniform float grime = 0.55;

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
	float rough_v = 0.8;

	if (mode == 0) {
		float wain = 1.15;
		float along = wp.x + wp.z;
		if (wp.y < wain) {
			// Wainscot: broad vertical stripes in the trim colour.
			float st = step(0.5, fract(along * 1.2));
			col = mix(trim, trim * 0.78, st);
		} else {
			// Wallpaper: a field of soft polka dots.
			vec2 g = fract(vec2(along * 0.8, wp.y * 0.8)) - 0.5;
			float dots = smoothstep(0.2, 0.17, length(g));
			col = mix(base, base * 1.3 + vec3(0.07), dots);
		}
		// A white rail where they meet, and a dark skirting at the floor.
		float rail = smoothstep(0.04, 0.0, abs(wp.y - wain));
		col = mix(col, vec3(0.95, 0.93, 0.88), rail);
		col = mix(col, col * 0.4, smoothstep(0.12, 0.0, wp.y));
		// Years of damp: darker patches, and streaks running down from the ceiling.
		col *= 0.62 + n * 0.55;
		float streak = smoothstep(0.58, 0.9, vnoise(vec2(along * 3.5, wp.y * 0.5 + 3.0)) * (1.0 - wp.y * 0.16) + n * 0.25);
		col = mix(col, col * 0.35, streak * grime * 0.7);
	} else if (mode == 1) {
		// Checkerboard, a metre a square, scuffed.
		float chk = step(0.5, fract((floor(uv.x) + floor(uv.y)) * 0.5));
		col = mix(base, trim, chk);
		vec2 g = fract(uv);
		float grout = 1.0 - smoothstep(0.0, 0.03, min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y)));
		col = mix(col, col * 0.4, grout * 0.7);
		col *= 0.6 + n * 0.6;
		col = mix(col, col * 0.4, smoothstep(0.55, 0.85, fbm(uv * 0.5 + 9.0)) * grime * 0.7);
		rough_v = 0.5;
	} else {
		col = base * 0.6 * (0.7 + n * 0.5);
		float drip = smoothstep(0.6, 0.85, fbm(uv * 0.7 + 4.0));
		col = mix(col, vec3(0.04, 0.05, 0.04), drip * 0.5);
	}
	col *= 0.9 + fine * 0.15;
	ALBEDO = col;
	ROUGHNESS = rough_v;
}
