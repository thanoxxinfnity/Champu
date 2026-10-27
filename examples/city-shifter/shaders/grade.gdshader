shader_type canvas_item;
// Anime colour grade over the whole 3D picture: a little more saturation and contrast, a soft bloom feel (lifted brights), a warm/cool split, and a light vignette.

uniform sampler2D screen : hint_screen_texture, filter_linear_mipmap;
uniform float saturation = 1.22;
uniform float contrast = 1.04;
uniform float vignette = 0.22;

void fragment() {
	vec3 c = texture(screen, SCREEN_UV).rgb;
	float l = dot(c, vec3(0.299, 0.587, 0.114));
	c = mix(vec3(l), c, saturation);
	c = (c - 0.5) * contrast + 0.5;
	// soft glow from the blurred brights
	vec3 b = textureLod(screen, SCREEN_UV, 3.0).rgb;
	c += max(b - 0.85, 0.0) * 0.25;
	c = mix(c * vec3(0.96, 0.98, 1.06), c * vec3(1.06, 1.0, 0.94), smoothstep(0.2, 0.9, l));
	vec2 q = SCREEN_UV - 0.5;
	c *= 1.0 - dot(q, q) * vignette * 2.0;
	COLOR = vec4(c, 1.0);
}
