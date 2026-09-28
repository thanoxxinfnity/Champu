shader_type spatial;
render_mode blend_mix, cull_disabled, unshaded, depth_draw_always;
// A cascading sheet of water: vertically scrolling streaks with a brighter
// foam band that races down faster than the base flow, so it reads as
// falling water rather than a static blue plane even from a distance.

uniform vec4 tint : source_color = vec4(0.72, 0.87, 0.93, 0.82);
uniform float speed = 1.6;

void fragment() {
	vec2 uv = UV;
	float t = TIME * speed;
	float streak = sin(uv.x * 26.0 + sin(uv.y * 4.0 + t * 0.6) * 2.0) * 0.5 + 0.5;
	float foam = smoothstep(0.8, 1.0, fract(uv.y * 7.0 - t * 1.8 + streak * 0.15));
	float edge_fade = smoothstep(0.0, 0.06, uv.x) * smoothstep(1.0, 0.94, uv.x);
	vec3 col = mix(tint.rgb, vec3(1.0), foam * 0.85 + streak * 0.1);
	float alpha = tint.a * mix(0.5, 1.0, streak) * edge_fade;
	ALBEDO = col;
	ALPHA = clamp(alpha + foam * 0.35, 0.0, 1.0);
	EMISSION = col * 0.12;
}
