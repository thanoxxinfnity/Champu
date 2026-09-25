shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

// Terrain: a shared grid mesh per chunk, lifted in the vertex shader from a
// float heightmap (texelFetch, so every vertex lands exactly on a height
// sample and collision matches). Layers blend by slope, height and noise:
// flat (grass/sand/snow), steep (rock), patches (dirt) and peaks (snow).

uniform sampler2D height_map : filter_nearest, repeat_disable;
uniform bool use_height_map = true;
uniform float spacing = 4.0;
uniform float half_size = 1024.0;
uniform int grid_n = 513;
uniform float skirt_depth = 8.0;

uniform sampler2D flat_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D flat_normal : filter_linear_mipmap, repeat_enable;
uniform sampler2D steep_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D steep_normal : filter_linear_mipmap, repeat_enable;
uniform sampler2D patch_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D peak_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D macro_noise : filter_linear_mipmap, repeat_enable;

uniform vec4 flat_tint : source_color = vec4(1.0);
uniform vec4 steep_tint : source_color = vec4(1.0);
uniform vec4 patch_tint : source_color = vec4(1.0);
uniform vec4 peak_tint : source_color = vec4(1.0);
uniform float flat_scale = 7.0;
uniform float steep_scale = 26.0;
uniform float steep_start = 0.28;
uniform float steep_end = 0.5;
uniform float patch_amount = 0.35;
uniform float peak_start = 9999.0;
uniform float peak_blend = 40.0;
uniform float shore_level = -9999.0;
uniform float water_level = -9999.0;
uniform float normal_strength = 1.0;

varying vec3 world_pos;
varying vec3 world_normal;

float fetch_h(ivec2 t) {
	t = clamp(t, ivec2(0), ivec2(grid_n - 1));
	return texelFetch(height_map, t, 0).r;
}

void vertex() {
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	if (use_height_map) {
		ivec2 t = ivec2(round((wp.xz + half_size) / spacing));
		float h = fetch_h(t);
		float hl = fetch_h(t - ivec2(1, 0));
		float hr = fetch_h(t + ivec2(1, 0));
		float hd = fetch_h(t - ivec2(0, 1));
		float hu = fetch_h(t + ivec2(0, 1));
		// Skirt vertices (alpha 0) hang below the edge to hide LOD cracks.
		float skirt = (1.0 - COLOR.a) * skirt_depth;
		VERTEX.y = h - skirt - MODEL_MATRIX[3].y;
		NORMAL = normalize(vec3(hl - hr, 2.0 * spacing, hd - hu));
		wp.y = h - skirt;
	}
	world_pos = wp;
	world_normal = NORMAL;
	TANGENT = normalize(cross(NORMAL, vec3(0.0, 0.0, 1.0)));
	BINORMAL = normalize(cross(TANGENT, NORMAL));
}

vec3 triplanar(sampler2D tex, vec3 p, vec3 n, float scale) {
	vec3 w = pow(abs(n), vec3(4.0));
	w /= (w.x + w.y + w.z);
	vec3 c = vec3(0.0);
	if (w.x > 0.05) c += texture(tex, p.zy / scale).rgb * w.x;
	if (w.z > 0.05) c += texture(tex, p.xy / scale).rgb * w.z;
	if (w.y > 0.05) c += texture(tex, p.xz / scale).rgb * w.y;
	return c / max(w.x * step(0.05, w.x) + w.y * step(0.05, w.y) + w.z * step(0.05, w.z), 0.001);
}

void fragment() {
	vec3 n = normalize(world_normal);
	vec2 uv = world_pos.xz / flat_scale;
	float macro = texture(macro_noise, world_pos.xz / 420.0).r;
	float macro2 = texture(macro_noise, world_pos.xz / 97.0 + vec2(0.37, 0.11)).r;

	// Flat layer, sampled at two scales so the tiling does not show.
	vec3 flat_c = texture(flat_albedo, uv).rgb;
	vec3 flat_far = texture(flat_albedo, uv * 0.137 + vec2(0.3, 0.7)).rgb;
	flat_c = mix(flat_c, flat_far, 0.35) * flat_tint.rgb;
	flat_c *= mix(0.78, 1.22, macro);

	float slope = 1.0 - n.y;
	float steep = smoothstep(steep_start, steep_end, slope + (macro2 - 0.5) * 0.12);
	float patch = smoothstep(0.62 - patch_amount * 0.3, 0.72 - patch_amount * 0.3, macro2 * 0.7 + macro * 0.3) * patch_amount * 2.0;
	float shore = 1.0 - smoothstep(shore_level, shore_level + 2.5, world_pos.y + (macro2 - 0.5) * 2.0);
	patch = clamp(max(patch, shore), 0.0, 1.0) * (1.0 - steep);
	float peak = smoothstep(peak_start, peak_start + peak_blend, world_pos.y + (macro - 0.5) * 60.0) * (1.0 - steep * 0.75);

	vec3 col = flat_c;
	if (patch > 0.01) {
		vec3 p = texture(patch_albedo, uv * 0.8).rgb * patch_tint.rgb * mix(0.85, 1.15, macro);
		col = mix(col, p, patch);
	}
	vec3 nm = texture(flat_normal, uv).rgb;
	if (steep > 0.01) {
		vec3 r = triplanar(steep_albedo, world_pos, n, steep_scale) * steep_tint.rgb * mix(0.8, 1.2, macro2);
		col = mix(col, r, steep);
		nm = mix(nm, texture(steep_normal, world_pos.xz / steep_scale + world_pos.y / steep_scale).rgb, steep * 0.5);
	}
	if (peak > 0.01) {
		col = mix(col, texture(peak_albedo, uv * 0.6).rgb * peak_tint.rgb, peak);
	}
	if (world_pos.y < water_level) {
		float d = clamp((water_level - world_pos.y) / 6.0, 0.0, 1.0);
		col = mix(col * 0.55, vec3(0.03, 0.07, 0.08), d);
	}
	ALBEDO = col;
	NORMAL_MAP = mix(vec3(0.5, 0.5, 1.0), nm, normal_strength);
	ROUGHNESS = mix(0.95, 0.75, steep) - peak * 0.25;
	SPECULAR = 0.3 + peak * 0.2;
}
