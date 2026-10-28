shader_type spatial;
render_mode cull_back, diffuse_toon, specular_disabled;
// Anime grass: two flat greens in big soft patches with a few lighter tufts, worldspace so it never swims; the horizon fades into the fog colour.

varying vec3 wpos;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = wpos.xz;
	float big = noise(p * 0.035);
	float mid = noise(p * 0.18 + 7.0);
	vec3 a = vec3(0.40, 0.68, 0.30);
	vec3 b = vec3(0.28, 0.54, 0.26);
	vec3 col = mix(a, b, smoothstep(0.42, 0.58, big));
	col = mix(col, col * 1.12 + vec3(0.03, 0.05, 0.0), smoothstep(0.62, 0.66, mid) * 0.8);
	float tuft = step(0.985, hash(floor(p * 2.2)));
	col = mix(col, vec3(0.62, 0.9, 0.42), tuft * 0.7);
	// lit (cel) so the sun's shadow lands on the grass; the albedo is scaled so sun + sky give back the same greens as before
	ALBEDO = col * 0.62;
	ROUGHNESS = 1.0;
}
