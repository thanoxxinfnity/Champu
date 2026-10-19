shader_type canvas_item;
// Full-screen overload effect: radial blur + chromatic aberration, both strongest at the edges.
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform float strength : hint_range(0.0, 1.0) = 0.0;

void fragment() {
	vec2 uv = SCREEN_UV;
	vec2 dir = uv - vec2(0.5);
	float d = length(dir);
	float amt = strength * smoothstep(0.1, 0.8, d);
	vec3 col = vec3(0.0);
	const int N = 6;
	for (int i = 0; i < N; i++) {
		float k = float(i) / float(N - 1);
		vec2 o = dir * (amt * 0.06) * k;
		float ca = amt * 0.012 * (0.4 + k);
		col.r += texture(screen_tex, uv - o + dir * ca).r;
		col.g += texture(screen_tex, uv - o).g;
		col.b += texture(screen_tex, uv - o - dir * ca).b;
	}
	COLOR = vec4(col / float(N), 1.0);
}
