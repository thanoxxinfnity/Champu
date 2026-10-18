shader_type spatial;
// The island's ground in four layers worked out from height and slope: wet sand at the waterline, grass, bare earth on the
// flats around settlements (a vertex-colour mask), and rock on cliffs and the peak. Tiled from world position, two scales.

uniform sampler2D sand_a : source_color, repeat_enable, filter_linear_mipmap;
uniform sampler2D sand_n : hint_normal, repeat_enable, filter_linear_mipmap;
uniform sampler2D grass_a : source_color, repeat_enable, filter_linear_mipmap;
uniform sampler2D grass_n : hint_normal, repeat_enable, filter_linear_mipmap;
uniform sampler2D rock_a : source_color, repeat_enable, filter_linear_mipmap;
uniform sampler2D rock_n : hint_normal, repeat_enable, filter_linear_mipmap;
uniform sampler2D dirt_a : source_color, repeat_enable, filter_linear_mipmap;
uniform sampler2D dirt_n : hint_normal, repeat_enable, filter_linear_mipmap;

varying vec3 wpos;
varying vec3 wnorm;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnorm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

vec3 two(sampler2D t, vec2 p, float s) {
	return texture(t, p * s).rgb * 0.62 + texture(t, p * s * 0.13).rgb * 0.5;
}

void fragment() {
	vec2 p = wpos.xz;
	float slope = 1.0 - clamp(wnorm.y, 0.0, 1.0);
	float h = wpos.y;
	float sand = smoothstep(3.2, 1.2, h);
	float rock = clamp(smoothstep(0.2, 0.42, slope) + smoothstep(95.0, 150.0, h) * 0.8, 0.0, 1.0);
	float dirt = COLOR.r;
	vec3 g = two(grass_a, p, 0.12);
	vec3 s = two(sand_a, p, 0.10);
	vec3 r = two(rock_a, p, 0.07) * 0.78;
	vec3 d = two(dirt_a, p, 0.14);
	// A slow patchwork of lighter and darker grass so the meadows are not one flat green.
	float patch = texture(grass_a, p * 0.004).g;
	g *= mix(0.72, 1.18, patch);
	vec3 col = mix(g, d, dirt);
	col = mix(col, s, sand);
	col = mix(col, r, rock);
	ALBEDO = col;
	vec3 n = mix(texture(grass_n, p * 0.12).rgb, texture(dirt_n, p * 0.14).rgb, dirt);
	n = mix(n, texture(sand_n, p * 0.1).rgb, sand);
	n = mix(n, texture(rock_n, p * 0.07).rgb, rock);
	NORMAL_MAP = n;
	ROUGHNESS = mix(0.95, 0.85, sand);
}
