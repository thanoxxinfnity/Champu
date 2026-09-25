shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_opaque;

// A boost pad laid flat on the road: a solid glowing strip with animated
// chevrons pointing the way through. Mostly opaque and depth-correct (not
// pure additive), so it reads as a painted pad, not a rendering glitch.

uniform vec4 base_color : source_color = vec4(0.03, 0.22, 0.32, 0.94);
uniform vec4 glow_color : source_color = vec4(0.35, 0.9, 1.0, 1.0);

void fragment() {
	float chevron = abs(fract((UV.y - TIME * 1.1) * 4.0) - 0.5) * 2.0;
	float edge = smoothstep(0.5, 0.15, abs(UV.x - 0.5) * 2.0);
	float end_fade = smoothstep(0.0, 0.08, UV.y) * smoothstep(1.0, 0.92, UV.y);
	float glow = smoothstep(1.0, 0.1, chevron);
	vec3 col = mix(base_color.rgb, glow_color.rgb, glow);
	ALBEDO = col;
	ALPHA = edge * end_fade * base_color.a;
}
