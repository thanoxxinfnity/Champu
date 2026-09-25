shader_type spatial;
render_mode blend_mix, cull_disabled;

// A stunt ring gate: a solid glowing torus you fly a jump through.

uniform vec4 color : source_color = vec4(1.0, 0.82, 0.15, 1.0);

void fragment() {
	float pulse = 0.75 + 0.25 * sin(TIME * 3.0);
	ALBEDO = color.rgb;
	EMISSION = color.rgb * pulse * 1.8;
	METALLIC = 0.35;
	ROUGHNESS = 0.25;
}
