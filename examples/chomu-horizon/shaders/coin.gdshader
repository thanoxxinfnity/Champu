shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

// Spinning, bobbing coins. The disc is modelled with its axis along Y and
// turned to face sideways here; every instance spins with its own phase.

uniform vec4 gold : source_color = vec4(1.0, 0.72, 0.12, 1.0);
uniform float glow = 0.6;

void vertex() {
	float phase = float(INSTANCE_ID) * 0.71;
	float a = TIME * 2.6 + phase;
	// Stand the disc up: Y axis to Z.
	vec3 v = vec3(VERTEX.x, -VERTEX.z, VERTEX.y);
	vec3 nn = vec3(NORMAL.x, -NORMAL.z, NORMAL.y);
	float c = cos(a), s = sin(a);
	VERTEX = vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
	NORMAL = vec3(nn.x * c + nn.z * s, nn.y, -nn.x * s + nn.z * c);
	VERTEX.y += sin(TIME * 2.0 + phase) * 0.12;
}

void fragment() {
	float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 2.0);
	ALBEDO = gold.rgb;
	METALLIC = 1.0;
	ROUGHNESS = 0.22;
	EMISSION = gold.rgb * (glow + rim * 1.2);
}
