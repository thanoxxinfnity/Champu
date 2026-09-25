shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

// One shader for every finish so switching finish is a uniform change, not a
// material swap (no hitch, no recompile on the phone).
uniform vec4 base_color : source_color = vec4(0.9, 0.3, 0.05, 1.0);
// Colour seen at grazing angles; equal to base_color for a plain metallic,
// hue-shifted for pearlescent.
uniform vec4 flip_color : source_color = vec4(0.9, 0.3, 0.05, 1.0);
uniform float metallic_amount : hint_range(0.0, 1.0) = 0.75;
uniform float roughness_amount : hint_range(0.0, 1.0) = 0.3;
uniform float clearcoat_amount : hint_range(0.0, 1.0) = 1.0;
uniform float flake_amount : hint_range(0.0, 1.0) = 0.35;
uniform float flake_scale = 160.0;

varying vec3 local_pos;

void vertex() {
	local_pos = VERTEX;
}

float hash3(vec3 p) {
	p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void fragment() {
	float facing = clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	float flip = pow(1.0 - facing, 1.6);
	vec3 col = mix(base_color.rgb, flip_color.rgb, flip);
	float sparkle = step(0.93, hash3(floor(local_pos * flake_scale))) * flake_amount;
	ALBEDO = col + vec3(sparkle * 0.35);
	METALLIC = metallic_amount;
	ROUGHNESS = clamp(roughness_amount - sparkle * 0.25, 0.03, 1.0);
	CLEARCOAT = clearcoat_amount;
	CLEARCOAT_ROUGHNESS = 0.05;
}
