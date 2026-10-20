shader_type canvas_item;
// Anime impact frame (high-contrast inverted black/white flash) and radial speed lines, over the whole screen.
uniform sampler2D screen: hint_screen_texture, filter_linear_mipmap;
uniform float invert = 0.0;
uniform float lines = 0.0;
uniform float tint_amount = 0.0;
uniform vec3 tint = vec3(1.0, 0.2, 0.2);

float h(float x) { return fract(sin(x * 91.7) * 43758.5453); }

void fragment() {
	vec3 c = texture(screen, SCREEN_UV).rgb;
	float l = dot(c, vec3(0.3, 0.59, 0.11));
	vec3 manga = vec3(step(0.42, 1.0 - l));
	c = mix(c, manga, invert);
	vec2 p = SCREEN_UV - 0.5;
	p.x *= 1.7;
	float a = atan(p.y, p.x);
	float r = length(p);
	float seg = floor(a * 70.0);
	float s = step(0.88, h(seg + floor(TIME * 24.0))) * smoothstep(0.22, 0.7, r);
	c = mix(c, vec3(1.0), s * lines * 0.75);
	c = mix(c, c * tint, tint_amount);
	COLOR = vec4(c, 1.0);
}
