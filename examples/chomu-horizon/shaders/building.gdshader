shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

// City towers: unit boxes in a MultiMesh, scaled per instance. Facades are
// drawn in world space (3.6 m floors), so any box size gets real-sized
// windows. INSTANCE_CUSTOM: r = style (0..3)/4, g = seed, b = hue shift.
// At night a random share of the windows lights up and shop fronts glow.

uniform float night = 0.0;
uniform sampler2D grime : filter_linear_mipmap, repeat_enable;

varying vec3 world_pos;
varying vec3 world_normal;
varying vec4 custom;

float hash2(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	world_normal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	custom = INSTANCE_CUSTOM;
}

void fragment() {
	int style = int(custom.r * 4.0 + 0.1);
	float seed = custom.g * 1000.0;
	vec3 n = world_normal;
	float g = texture(grime, world_pos.xz / 23.0 + world_pos.y / 31.0).r;
	if (n.y > 0.5) {
		ALBEDO = vec3(0.16, 0.16, 0.17) * mix(0.8, 1.1, g);
		ROUGHNESS = 0.9;
	} else {
		vec2 f = vec2(abs(n.x) > 0.5 ? world_pos.z : world_pos.x, world_pos.y);
		vec2 cell_size = style == 0 ? vec2(2.4, 3.6) : (style == 1 ? vec2(3.4, 3.6) : (style == 2 ? vec2(3.0, 3.4) : vec2(4.2, 3.9)));
		vec2 cell = f / cell_size;
		vec2 fr = fract(cell);
		vec2 id = floor(cell);
		vec3 wall;
		float win;
		if (style == 0) {
			wall = vec3(0.1, 0.12, 0.14);
			win = step(0.06, fr.x) * step(0.1, fr.y);
		} else if (style == 1) {
			wall = vec3(0.55, 0.53, 0.5);
			win = step(0.18, fr.x) * step(fr.x, 0.82) * step(0.28, fr.y) * step(fr.y, 0.86);
		} else if (style == 2) {
			wall = vec3(0.42, 0.2, 0.14);
			win = step(0.22, fr.x) * step(fr.x, 0.78) * step(0.22, fr.y) * step(fr.y, 0.82);
		} else {
			wall = vec3(0.78, 0.78, 0.76);
			win = step(0.08, fr.x) * step(fr.x, 0.92) * step(0.3, fr.y) * step(fr.y, 0.8);
		}
		wall *= mix(vec3(1.0), vec3(0.85 + custom.b * 0.3, 0.9, 1.1 - custom.b * 0.3), 0.5);
		wall *= mix(0.75, 1.1, g);
		float shop = step(world_pos.y, 4.2);
		float lit = step(0.55, hash2(id + seed));
		vec3 glass = mix(vec3(0.03, 0.045, 0.06), vec3(0.08, 0.1, 0.12), hash2(id * 1.7 + seed));
		ALBEDO = mix(wall, glass, win);
		METALLIC = win * 0.6;
		ROUGHNESS = mix(0.85, 0.08, win);
		vec3 warm = mix(vec3(1.0, 0.72, 0.4), vec3(0.75, 0.85, 1.0), hash2(id + seed * 3.1));
		EMISSION = warm * win * lit * night * 0.9;
		if (shop > 0.5) {
			vec3 neon = 0.5 + 0.5 * cos(6.2831 * (custom.b + vec3(0.0, 0.33, 0.67)));
			ALBEDO = mix(vec3(0.05), glass, 0.6);
			EMISSION = mix(vec3(1.0, 0.85, 0.6) * 0.45, neon * 1.6, step(3.4, world_pos.y)) * night;
			METALLIC = 0.5;
			ROUGHNESS = 0.1;
		}
	}
}
