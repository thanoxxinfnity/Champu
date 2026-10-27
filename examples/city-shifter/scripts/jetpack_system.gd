class_name JetpackSystem
extends RefCounted
## The jetpack's engine room: a fuel tank that burns while you thrust and refills on the ground, and a heat gauge that rises while the thrusters burn and falls
## when they rest. Run it hot to 100 % and the thrusters cut out (OVERHEAT) until they have cooled to 35 % — so holding JET forever is not free even with fuel.
## PlayerController owns one; the HUD draws `fuel_frac()` and `heat_frac()`; the avatar's flame follows `thrusting`.

signal overheated
signal recovered
signal emptied

const BURN := 26.0               # fuel per second while thrusting
const REGEN_GROUND := 30.0
const REGEN_AIR := 3.0
const HEAT_UP := 0.34            # heat per second while thrusting: ~3 s from cold to OVERHEAT, about as long as a tank of 100 lasts
const COOL := 0.28
const RECOVER_AT := 0.35

var max_fuel := 100.0
var fuel := 100.0
var heat := 0.0
var hot := false                 # cut out by overheating
var thrusting := false
var cool_mult := 1.0


func can_thrust() -> bool:
	return fuel > 0.0 and not hot


## One frame of thrust: burns fuel, builds heat. Returns false when the engine had to cut out.
func burn(delta: float) -> bool:
	if not can_thrust():
		thrusting = false
		return false
	thrusting = true
	fuel = maxf(0.0, fuel - BURN * delta)
	heat = minf(1.0, heat + HEAT_UP * delta)
	if heat >= 1.0 and not hot:
		hot = true
		thrusting = false
		overheated.emit()
		return false
	if fuel <= 0.0:
		thrusting = false
		emptied.emit()
	return true


## One frame without thrust: cools, and refills the tank (fast on the ground).
func rest(delta: float, on_floor: bool) -> void:
	thrusting = false
	heat = maxf(0.0, heat - COOL * cool_mult * delta * (1.4 if hot else 1.0))
	if hot and heat <= RECOVER_AT:
		hot = false
		recovered.emit()
	fuel = minf(max_fuel, fuel + (REGEN_GROUND if on_floor else REGEN_AIR) * delta)


func fuel_frac() -> float:
	return fuel / maxf(max_fuel, 0.001)


func heat_frac() -> float:
	return heat


func refill() -> void:
	fuel = max_fuel
	heat = 0.0
	hot = false
