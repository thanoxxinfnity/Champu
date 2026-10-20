shader_type spatial;
// Ground for the open world: biome colour from height and distance, plus procedural roads (grid in the city, radial roads out of it).
// Pure function of world position, so it needs no road geometry and stays crisp at any distance.

uniform float cell = 96.0;
uniform float road = 16.0;
uniform float city_r = 1750.0;
uniform vec2 lake_c = vec2(-1300.0, 1100.0);
uniform float lake_r = 330.0;

varying vec3 wpos;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = wpos.xz;
	float r = length(p);
	float h = wpos.y;
	vec3 grass = mix(vec3(0.16, 0.27, 0.12), vec3(0.10, 0.20, 0.09), noise(p * 0.05));
	grass *= 0.85 + 0.3 * noise(p * 0.8);
	vec3 rock = mix(vec3(0.30, 0.28, 0.27), vec3(0.42, 0.40, 0.38), noise(p * 0.12));
	vec3 snow = vec3(0.86, 0.88, 0.92);
	vec3 sand = vec3(0.55, 0.50, 0.36);
	vec3 col = grass;
	col = mix(col, rock, smoothstep(55.0, 110.0, h));
	col = mix(col, snow, smoothstep(230.0, 300.0, h));
	col = mix(col, sand, smoothstep(-1.0, -4.0, h) * 0.0 + (1.0 - smoothstep(-2.0, 1.5, h)) * 0.8);
	// city paving
	float city = 1.0 - smoothstep(city_r - 120.0, city_r, r);
	vec3 pave = mix(vec3(0.34, 0.34, 0.35), vec3(0.28, 0.28, 0.30), noise(p * 0.3));
	col = mix(col, pave, city * 0.85);
	// roads: grid
	vec2 g = mod(p, cell) - 0.0;
	float dx = min(g.x, cell - g.x);
	float dz = min(g.y, cell - g.y);
	float on_road = max(1.0 - smoothstep(road * 0.5 - 0.6, road * 0.5 + 0.6, dx), 1.0 - smoothstep(road * 0.5 - 0.6, road * 0.5 + 0.6, dz));
	vec3 asphalt = vec3(0.10, 0.10, 0.11) * (0.9 + 0.2 * noise(p * 1.7));
	// cracks and oil stains on the asphalt
	asphalt *= 1.0 - 0.35 * smoothstep(0.62, 0.66, noise(p * 0.9)) - 0.25 * step(0.985, noise(p * 6.0));
	// sidewalks: a light paving band with tile joints along every road
	float side_x = step(road * 0.5, dx) * (1.0 - step(road * 0.5 + 4.5, dx));
	float side_z = step(road * 0.5, dz) * (1.0 - step(road * 0.5 + 4.5, dz));
	float sidewalk = max(side_x, side_z) * (1.0 - on_road);
	vec2 tile = fract(p / 1.5);
	float joint = step(0.94, max(tile.x, tile.y));
	vec3 paving = mix(vec3(0.52, 0.51, 0.49), vec3(0.40, 0.39, 0.38), joint) * (0.9 + 0.15 * noise(p * 0.7));
	col = mix(col, paving, sidewalk * city);
	// curb line
	float curb = max((1.0 - smoothstep(0.0, 0.35, abs(dx - road * 0.5))), (1.0 - smoothstep(0.0, 0.35, abs(dz - road * 0.5))));
	col = mix(col, vec3(0.7, 0.7, 0.68), curb * city * 0.8);
	col = mix(col, asphalt, on_road * city);
	// zebra crossings in front of every intersection
	float near_x = step(road * 0.5 + 0.5, dz) * (1.0 - step(road * 0.5 + 5.0, dz)) * (1.0 - step(road * 0.5, dx));
	float near_z = step(road * 0.5 + 0.5, dx) * (1.0 - step(road * 0.5 + 5.0, dx)) * (1.0 - step(road * 0.5, dz));
	float zebra = near_x * step(0.5, fract(p.x / 1.6)) + near_z * step(0.5, fract(p.y / 1.6));
	col = mix(col, vec3(0.85, 0.85, 0.82), clamp(zebra, 0.0, 1.0) * city * 0.9);
	// centre lines
	float line_x = (1.0 - smoothstep(0.12, 0.2, dx)) * step(0.5, fract(p.y / 8.0));
	float line_z = (1.0 - smoothstep(0.12, 0.2, dz)) * step(0.5, fract(p.x / 8.0));
	col = mix(col, vec3(0.8, 0.72, 0.35), max(line_x, line_z) * city * on_road * 0.9);
	// highways out of the city along the axes
	float hw = max(1.0 - smoothstep(5.0, 6.0, abs(p.x)), 1.0 - smoothstep(5.0, 6.0, abs(p.y))) * (1.0 - city) * step(r, 2350.0);
	col = mix(col, asphalt, hw);
	ALBEDO = col;
	ROUGHNESS = 0.92;
}
