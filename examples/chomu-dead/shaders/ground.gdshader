shader_type spatial;
render_mode cull_back, diffuse_burley;

// Saint Aster's ground in one procedural material: dead grass and dirt, a
// cracked asphalt road with worn lane paint, pavements, and two dirt paths.
// World-space maths only, so it needs no textures and never tiles visibly.

uniform float road_z0 = -62.0;
uniform float road_z1 = 128.0;
uniform float wet = 0.0;

varying vec3 wp;

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
		p = p * 2.03 + 11.7;
		a *= 0.5;
	}
	return v;
}

float seg(vec2 p, vec2 a, vec2 b, float w) {
	vec2 pa = p - a;
	vec2 ba = b - a;
	float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
	return 1.0 - smoothstep(w * 0.7, w, length(pa - ba * h));
}

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = wp.xz;
	float n = fbm(p * 0.35);
	float big = fbm(p * 0.06);
	float fine = vnoise(p * 6.0);

	// Dead grass over dirt.
	vec3 dirt = mix(vec3(0.11, 0.09, 0.065), vec3(0.2, 0.165, 0.115), n);
	vec3 grass = mix(vec3(0.07, 0.09, 0.05), vec3(0.13, 0.15, 0.07), n);
	vec3 col = mix(dirt, grass, smoothstep(0.35, 0.65, big));
	col *= 0.85 + fine * 0.3;

	// Dirt paths: to the gas station and to the church gate.
	float path = max(seg(p, vec2(-5.0, 3.0), vec2(-26.0, 3.0), 2.6), seg(p, vec2(5.0, 24.0), vec2(27.0, 24.0), 2.4));
	col = mix(col, mix(vec3(0.16, 0.13, 0.09), vec3(0.2, 0.17, 0.12), n), path * 0.9);

	// Road.
	float in_z = smoothstep(road_z0 - 0.3, road_z0 + 0.3, p.y) * (1.0 - smoothstep(road_z1 - 0.3, road_z1 + 0.3, p.y));
	float ax = abs(p.x);
	float road = (1.0 - smoothstep(5.0, 5.25, ax)) * in_z;
	float walk = (1.0 - smoothstep(6.6, 6.8, ax)) * in_z * (1.0 - road);
	vec3 asphalt = vec3(0.055, 0.057, 0.062) + n * 0.035 + fine * 0.012;
	// Cracks: thin ridges of noise.
	float crack = 1.0 - smoothstep(0.0, 0.035, abs(fbm(p * 0.9) - 0.5));
	asphalt *= 1.0 - crack * 0.55;
	// Lane paint, worn away by a second noise.
	float worn = smoothstep(0.35, 0.6, vnoise(p * 1.3));
	float dash = step(0.5, fract(p.y / 5.0)) * (1.0 - smoothstep(0.1, 0.16, ax));
	float edge = (1.0 - smoothstep(0.05, 0.1, abs(ax - 4.5))) * 0.6;
	asphalt = mix(asphalt, vec3(0.5, 0.42, 0.14), dash * worn * 0.7);
	asphalt = mix(asphalt, vec3(0.4, 0.4, 0.4), edge * worn * 0.5);
	vec3 pave = vec3(0.12, 0.12, 0.125) + n * 0.04;
	pave *= 1.0 - (1.0 - smoothstep(0.0, 0.04, abs(fract(p.y / 2.5) - 0.5) - 0.48)) * 0.3;
	col = mix(col, pave, walk);
	col = mix(col, asphalt, road);

	// Dark oil and stains on the road.
	float stain = smoothstep(0.62, 0.8, fbm(p * 0.22 + 4.0)) * road;
	col *= 1.0 - stain * 0.5;

	ALBEDO = col;
	ROUGHNESS = mix(0.95, 0.55, road * wet);
	SPECULAR = 0.25 + road * 0.2;
}
