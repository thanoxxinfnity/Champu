shader_type canvas_item;
// Full-screen finish: ink edges from the colour buffer, posterised shadows, crimson mist tint, vignette and a little film grain.
// `hurt` pulses red when the player is hit, `fear` pushes the vignette in when something dangerous is near.

uniform sampler2D screen_tex : hint_screen_texture, filter_linear;
uniform float hurt = 0.0;
uniform float fear = 0.0;
uniform float mist = 0.08;
uniform float edge_strength = 0.55;
uniform float t = 0.0;

float luma(vec3 c) {
	return dot(c, vec3(0.299, 0.587, 0.114));
}

void fragment() {
	vec2 px = 1.0 / vec2(textureSize(screen_tex, 0));
	vec3 c = texture(screen_tex, SCREEN_UV).rgb;
	float l0 = luma(texture(screen_tex, SCREEN_UV + vec2(px.x, 0.0) * 1.2).rgb);
	float l1 = luma(texture(screen_tex, SCREEN_UV - vec2(px.x, 0.0) * 1.2).rgb);
	float l2 = luma(texture(screen_tex, SCREEN_UV + vec2(0.0, px.y) * 1.2).rgb);
	float l3 = luma(texture(screen_tex, SCREEN_UV - vec2(0.0, px.y) * 1.2).rgb);
	float edge = clamp((abs(l0 - l1) + abs(l2 - l3)) * 3.2, 0.0, 1.0);
	c = mix(c, c * vec3(0.12, 0.13, 0.16), edge * edge_strength);
	c = mix(c, floor(c * 7.0 + 0.5) / 7.0, 0.35);
	float g0 = luma(c);
	c = mix(c, vec3(g0) * vec3(0.95, 1.02, 1.08) + vec3(0.0, 0.01, 0.02), 0.22 + mist);
	vec2 uv = SCREEN_UV - 0.5;
	float vig = smoothstep(0.35 - fear * 0.12, 0.95, length(uv * vec2(1.0, 0.9)));
	c *= 1.0 - vig * (0.55 + fear * 0.3);
	c = mix(c, vec3(0.75, 0.04, 0.06), hurt * (0.25 + vig * 0.7));
	float g = fract(sin(dot(SCREEN_UV * 900.0 + t, vec2(12.9898, 78.233))) * 43758.5453);
	c += (g - 0.5) * 0.035;
	COLOR = vec4(c, 1.0);
}
