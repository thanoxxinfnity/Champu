shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx, cull_disabled;

// Water (or ice): two scrolling normal maps, Fresnel towards the sky colour,
// sharp sun highlight. Opaque, so it costs one pass on a phone.

uniform sampler2D waves : filter_linear_mipmap, repeat_enable;
uniform vec4 deep_color : source_color = vec4(0.02, 0.09, 0.12, 1.0);
uniform vec4 sky_color : source_color = vec4(0.45, 0.6, 0.75, 1.0);
uniform float wave_scale = 38.0;
uniform float speed = 1.0;
uniform bool ice = false;
uniform sampler2D cracks : source_color, filter_linear_mipmap, repeat_enable;

varying vec3 world_pos;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = world_pos.xz;
	if (ice) {
		float c = texture(cracks, p / 11.0).r;
		float c2 = texture(cracks, p / 53.0).r;
		ALBEDO = mix(vec3(0.55, 0.7, 0.8), vec3(0.85, 0.92, 0.97), smoothstep(0.2, 0.6, c2)) * mix(0.8, 1.05, c);
		NORMAL_MAP = texture(waves, p / 60.0).rgb * 0.3 + vec3(0.35, 0.35, 0.7);
		ROUGHNESS = 0.12 + c * 0.2;
		SPECULAR = 0.6;
	} else {
		float t = TIME * speed;
		vec3 n1 = texture(waves, p / wave_scale + vec2(t * 0.012, t * 0.007)).rgb;
		vec3 n2 = texture(waves, p / (wave_scale * 0.43) - vec2(t * 0.009, t * 0.016)).rgb;
		NORMAL_MAP = normalize(mix(n1, n2, 0.5) * 2.0 - 1.0) * 0.5 + 0.5;
		NORMAL_MAP_DEPTH = 0.7;
		float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 4.0);
		ALBEDO = mix(deep_color.rgb, sky_color.rgb * 0.6, fres);
		ROUGHNESS = 0.04;
		SPECULAR = 0.8;
	}
}
