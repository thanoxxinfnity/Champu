shader_type spatial;
render_mode cull_back;
// A tower facade with no texture: window bays are worked out from world position, so any box of any size
// gets a consistent grid. At night a hash of each bay decides whether its light is on.

global uniform float night;

uniform vec3 wall_color : source_color = vec3(0.58, 0.56, 0.53);
uniform vec3 glass_color : source_color = vec3(0.12, 0.2, 0.28);
uniform vec3 lit_color : source_color = vec3(1.0, 0.8, 0.5);
uniform vec2 bay = vec2(3.4, 3.6);          // metres per window bay (across, up)
uniform vec2 glass_frac = vec2(0.66, 0.62);  // how much of a bay is glass
uniform float glassiness : hint_range(0.0, 1.0) = 0.7;
uniform float lit_chance : hint_range(0.0, 1.0) = 0.55;
uniform float seed = 0.0;

varying vec3 wpos;
varying vec3 wnorm;

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21) + seed);
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnorm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 n = wnorm;
	vec2 uv = abs(n.x) > abs(n.z) ? vec2(wpos.z, wpos.y) : vec2(wpos.x, wpos.y);
	vec2 cell = floor(uv / bay);
	vec2 f = fract(uv / bay);
	vec2 lo = (1.0 - glass_frac) * 0.5;
	vec2 inside = step(lo, f) * step(f, 1.0 - lo);
	// Roofs are plain; only walls get windows.
	float is_wall = step(n.y, 0.5);
	float is_glass = inside.x * inside.y * is_wall;
	float lit = step(hash(cell + floor(wpos.xz * 0.01)), lit_chance) * night;

	vec3 col = mix(wall_color, glass_color, is_glass);
	col = mix(wall_color * 0.55, col, is_wall);
	ALBEDO = col;
	METALLIC = is_glass * 0.6;
	ROUGHNESS = mix(0.9, 0.12, is_glass * glassiness);
	SPECULAR = 0.6;
	EMISSION = lit_color * lit * is_glass * 1.6;
}
