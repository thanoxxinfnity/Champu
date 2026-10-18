shader_type spatial;
// The land beyond the city: grass on the flats, rock on the steep parts, tiled from world position so it needs no UVs.

uniform sampler2D grass_a : source_color, repeat_enable, filter_linear_mipmap;
uniform sampler2D grass_n : hint_normal, repeat_enable, filter_linear_mipmap;
uniform sampler2D rock_a : source_color, repeat_enable, filter_linear_mipmap;
uniform sampler2D rock_n : hint_normal, repeat_enable, filter_linear_mipmap;
uniform float tile = 0.06;
uniform float far_tile = 0.008;

varying vec3 wpos;
varying vec3 wnorm;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnorm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec2 uv = wpos.xz * tile;
	vec2 uv2 = wpos.xz * far_tile;
	// Two scales blended so the repeat does not show from far away.
	vec3 g = texture(grass_a, uv).rgb * 0.6 + texture(grass_a, uv2).rgb * 0.5;
	vec3 r = texture(rock_a, wpos.xz * tile * 0.7).rgb * 0.6 + texture(rock_a, uv2 * 1.7).rgb * 0.5;
	float slope = 1.0 - clamp(wnorm.y, 0.0, 1.0);
	float rock = smoothstep(0.18, 0.38, slope) + smoothstep(120.0, 220.0, wpos.y) * 0.5;
	rock = clamp(rock, 0.0, 1.0);
	ALBEDO = mix(g, r, rock);
	NORMAL_MAP = mix(texture(grass_n, uv).rgb, texture(rock_n, uv * 0.7).rgb, rock);
	ROUGHNESS = 0.95;
}
