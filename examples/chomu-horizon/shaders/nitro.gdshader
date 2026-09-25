shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never;

// A boost pad laid flat on the road: animated chevrons pointing the way
// through. Additive and depth-never so it never fights the asphalt for z.

uniform vec4 color : source_color = vec4(0.15, 0.75, 1.0, 1.0);

void fragment() {
	float chevron = abs(fract((UV.y - TIME * 1.1) * 4.0) - 0.5) * 2.0;
	float edge = smoothstep(0.5, 0.08, abs(UV.x - 0.5) * 2.0);
	float glow = smoothstep(1.0, 0.15, chevron);
	ALBEDO = color.rgb;
	ALPHA = (glow * 0.85 + 0.1) * edge;
}
