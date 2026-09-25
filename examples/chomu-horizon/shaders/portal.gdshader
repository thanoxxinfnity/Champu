shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never;

// Portal membrane: a swirling energy disc (UV centred on 0.5).

uniform vec4 color_a : source_color = vec4(0.1, 0.8, 1.0, 1.0);
uniform vec4 color_b : source_color = vec4(1.0, 0.2, 0.8, 1.0);
uniform sampler2D noise : filter_linear_mipmap, repeat_enable;

void fragment() {
	vec2 p = UV - 0.5;
	float r = length(p) * 2.0;
	float a = atan(p.y, p.x);
	float swirl = texture(noise, vec2(a / 6.2831 + TIME * 0.08 + r * 0.6, r * 0.8 - TIME * 0.25)).r;
	float edge = smoothstep(1.0, 0.82, r);
	float core = smoothstep(0.9, 0.0, r);
	vec3 c = mix(color_b.rgb, color_a.rgb, swirl);
	ALBEDO = c * (0.35 + swirl * 0.9);
	ALPHA = edge * (0.55 + swirl * 0.35);
}
