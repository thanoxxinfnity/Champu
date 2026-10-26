shader_type canvas_item;
// Full-screen finish: ink edges from the colour buffer, posterised shadows, crimson mist tint, vignette and a little film grain.
// `hurt` pulses red when the player is hit, `fear` pushes the vignette in when something dangerous is near.

uniform sampler2D screen_tex : hint_screen_texture, filter_linear;
uniform float hurt = 0.0;
uniform float fear = 0.0;
uniform float mist = 0.08;
uniform float edge_strength = 0.55;
uniform float t = 0.0;
uniform float lite = 0.0;        // 1 = fewer texture reads and no grain (MEDIUM graphics: the screen is far bigger than the 3D view)
uniform float dof = 0.0;         // cinematic shots: a soft focus away from the middle band, like a wide lens at f/2
uniform float bars = 0.0;        // cinematic letterbox (fraction of the screen height taken by each black bar)

float luma(vec3 c) {
	return dot(c, vec3(0.299, 0.587, 0.114));
}

void fragment() {
	vec2 px = 1.0 / vec2(textureSize(screen_tex, 0));
	vec3 c = texture(screen_tex, SCREEN_UV).rgb;
	if (dof > 0.0) {
		// bokeh stand-in: a ring of taps whose radius grows with the distance from the focus band across the middle of the frame
		float away = smoothstep(0.12, 0.5, abs(SCREEN_UV.y - 0.52)) * dof;
		vec3 acc = c;
		for (int i = 0; i < 8; i++) {
			float a = float(i) * 0.7853982;
			acc += texture(screen_tex, SCREEN_UV + vec2(cos(a), sin(a)) * px * 7.0 * away).rgb;
		}
		c = mix(c, acc / 9.0, clamp(away * 1.4, 0.0, 1.0));
	}
	float edge;
	if (lite > 0.5) {
		float a0 = luma(texture(screen_tex, SCREEN_UV + vec2(px.x, 0.0) * 1.5).rgb);
		float a1 = luma(texture(screen_tex, SCREEN_UV + vec2(0.0, px.y) * 1.5).rgb);
		float lc = luma(c);
		edge = clamp((abs(a0 - lc) + abs(a1 - lc)) * 3.6, 0.0, 1.0);
	} else {
		float l0 = luma(texture(screen_tex, SCREEN_UV + vec2(px.x, 0.0) * 1.2).rgb);
		float l1 = luma(texture(screen_tex, SCREEN_UV - vec2(px.x, 0.0) * 1.2).rgb);
		float l2 = luma(texture(screen_tex, SCREEN_UV + vec2(0.0, px.y) * 1.2).rgb);
		float l3 = luma(texture(screen_tex, SCREEN_UV - vec2(0.0, px.y) * 1.2).rgb);
		edge = clamp((abs(l0 - l1) + abs(l2 - l3)) * 3.2, 0.0, 1.0);
	}
	c = mix(c, c * vec3(0.12, 0.13, 0.16), edge * edge_strength);
	c = mix(c, floor(c * 7.0 + 0.5) / 7.0, 0.35);
	float g0 = luma(c);
	c = mix(c, vec3(g0) * vec3(0.95, 1.02, 1.08) + vec3(0.0, 0.01, 0.02), 0.22 + mist);
	vec2 uv = SCREEN_UV - 0.5;
	float vig = smoothstep(0.35 - fear * 0.12, 0.95, length(uv * vec2(1.0, 0.9)));
	c *= 1.0 - vig * (0.55 + fear * 0.3);
	c = mix(c, vec3(0.75, 0.04, 0.06), hurt * (0.25 + vig * 0.7));
	if (lite < 0.5) {
		float g = fract(sin(dot(SCREEN_UV * 900.0 + t, vec2(12.9898, 78.233))) * 43758.5453);
		c += (g - 0.5) * 0.035;
	}
	c *= step(bars, SCREEN_UV.y) * step(SCREEN_UV.y, 1.0 - bars);
	COLOR = vec4(c, 1.0);
}
