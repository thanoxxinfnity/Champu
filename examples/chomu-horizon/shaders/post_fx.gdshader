shader_type canvas_item;

// Full-screen finishing pass: vignette, speed-linked chromatic aberration
// at the screen edges, and a light unsharp-mask so the phone's scaled-up
// render still looks crisp. One backbuffer read, gated off at BATTERY.

uniform sampler2D screen_tex : hint_screen_texture, filter_linear;
uniform float vignette_strength : hint_range(0.0, 1.0) = 0.35;
uniform float aberration : hint_range(0.0, 0.01) = 0.0018;
uniform float sharpen : hint_range(0.0, 1.0) = 0.28;
uniform float grain : hint_range(0.0, 0.1) = 0.02;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void fragment() {
	vec2 uv = SCREEN_UV;
	vec2 centered = uv - 0.5;
	float d = length(centered * vec2(1.0, 0.72));

	vec2 dir = normalize(centered + 1e-5);
	float shift = aberration * smoothstep(0.15, 0.75, d);
	vec3 col;
	col.r = texture(screen_tex, uv - dir * shift).r;
	col.g = texture(screen_tex, uv).g;
	col.b = texture(screen_tex, uv + dir * shift).b;

	// Unsharp mask: subtract a blurred sample from the source.
	vec2 texel = SCREEN_PIXEL_SIZE * 1.5;
	vec3 blur = (
		texture(screen_tex, uv + vec2(texel.x, 0.0)).rgb +
		texture(screen_tex, uv - vec2(texel.x, 0.0)).rgb +
		texture(screen_tex, uv + vec2(0.0, texel.y)).rgb +
		texture(screen_tex, uv - vec2(0.0, texel.y)).rgb
	) * 0.25;
	col += (col - blur) * sharpen;

	float vig = 1.0 - vignette_strength * smoothstep(0.35, 0.92, d);
	col *= vig;
	col += (hash(uv * vec2(1920.0, 1080.0) + TIME) - 0.5) * grain;

	COLOR = vec4(col, 1.0);
}
