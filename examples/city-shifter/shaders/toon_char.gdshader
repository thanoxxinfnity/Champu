shader_type spatial;
render_mode diffuse_toon, specular_disabled, cull_disabled;
// Anime character shading: the texture, a slightly richer colour, light in two crisp steps (lit / soft shade / cool shadow tinted violet, not grey) and a pink-white rim
// light on the side away from the sun, like cel animation. The outline is a dark edge in this shader (the inverted-hull pass, ink.gdshader, is kept for vehicles and props).

global uniform float cel;              // 1 = anime cel shading, 0 = realistic (soft light, no ink edge, natural colour): SETTINGS > LOOK

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec4 albedo : source_color = vec4(1.0);
uniform bool has_tex = true;
uniform vec3 shade_tint : source_color = vec3(0.62, 0.56, 0.92);
uniform vec3 rim_col : source_color = vec3(1.0, 0.82, 0.93);
uniform float rim_amt = 0.3;
uniform float sat = 1.14;
uniform float edge_dark = 0.45;
uniform float edge_from = 0.9;
uniform float bright = 1.0;            // already-bright textures (the MMD models) are dimmed

void fragment() {
	vec4 t = has_tex ? texture(albedo_tex, UV) : vec4(1.0);
	vec3 c = t.rgb * albedo.rgb;
	float l = dot(c, vec3(0.299, 0.587, 0.114));
	c = mix(vec3(l), c, mix(1.0, sat, cel));
	// a soft ink line where the surface turns away from the eye: the anime outline without a second, shard-prone hull pass
	float edge = 1.0 - clamp(abs(dot(NORMAL, VIEW)), 0.0, 1.0);
	c *= mix(1.0, mix(1.0, edge_dark, cel), smoothstep(edge_from, edge_from + 0.12, edge));
	ALBEDO = c * bright;
	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
}

void light() {
	float ndl = dot(NORMAL, LIGHT);
	// (soft band edges: the detailed generated heroes have busy normals, and razor steps turned every bump into a speckle)
	float soft = smoothstep(-0.2, 0.2, ndl);
	float full = smoothstep(0.3, 0.6, ndl);
	vec3 shade = mix(shade_tint * 0.45, vec3(0.8), soft);
	shade = mix(shade, vec3(1.15), full);
	vec3 natural = vec3(0.12 + 1.0 * smoothstep(-0.15, 0.85, ndl));
	shade = mix(natural, shade, cel);
	DIFFUSE_LIGHT += shade * LIGHT_COLOR * ATTENUATION / PI;
	float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.2);
	DIFFUSE_LIGHT += rim * rim_col * rim_amt * mix(0.35, 1.0, cel) * clamp(0.35 - ndl * 0.5, 0.0, 1.0) * LIGHT_COLOR / PI;
}
