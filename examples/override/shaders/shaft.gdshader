shader_type spatial;
render_mode blend_add, unshaded, cull_disabled, depth_draw_never;

// A cone of light dust under a lamp (or a siren's sweeping beam): bright at the source, gone at the far end.
uniform vec4 tint : source_color = vec4(0.6, 0.75, 1.0, 1.0);
uniform float strength = 0.10;
uniform float flicker = 0.0;

void fragment() {
	// UV.y runs from the top of the cone (0) to the bottom (1).
	float fade = pow(1.0 - UV.y, 1.6);
	float soft = pow(abs(dot(normalize(NORMAL), normalize(VIEW))), 1.5);   // brighter where you look through the middle, thin at the edge
	float k = strength * fade * soft * (1.0 - flicker * (0.5 + 0.5 * sin(TIME * 47.0)));
	ALBEDO = tint.rgb * k;
	ALPHA = 1.0;
}
