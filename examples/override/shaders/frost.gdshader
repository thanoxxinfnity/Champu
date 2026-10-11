shader_type canvas_item;

// Frosted glass: the frozen game behind the backpack, blurred and cooled.
uniform sampler2D screen : hint_screen_texture, filter_linear_mipmap;
uniform float blur = 3.2;

void fragment() {
	vec3 c = textureLod(screen, SCREEN_UV, blur).rgb;
	vec3 c2 = textureLod(screen, SCREEN_UV + vec2(0.004, 0.0), blur + 1.0).rgb;
	c = mix(c, c2, 0.5);
	c = mix(c, vec3(0.55, 0.72, 0.82), 0.16) * 0.85;
	float v = smoothstep(0.2, 0.9, length(SCREEN_UV - 0.5));
	COLOR = vec4(c * (1.0 - v * 0.5), 1.0);
}
