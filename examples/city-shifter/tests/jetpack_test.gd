extends SceneTree
## The jetpack engine room: fuel burns while thrusting and refills on the ground, heat rises and the thrusters cut out at 100 % until they cool to 35 %.

func _initialize() -> void:
	var j := JetpackSystem.new()
	j.max_fuel = 1000.0
	j.fuel = 1000.0
	T.check(j.can_thrust() and j.heat_frac() == 0.0, "a fresh pack is full and cold")
	var t := 0.0
	var cut := false
	while t < 12.0 and j.burn(1.0 / 60.0):
		t += 1.0 / 60.0
	cut = not j.can_thrust()
	T.check(cut and j.hot, "holding JET hot enough cuts the engine out (%.1f s)" % t)
	T.check(t > 2.0 and t < 5.0, "after a believable burn time (%.1f s)" % t)
	T.check(j.fuel > 100.0, "with fuel still in the tank (%.0f): it was the heat" % j.fuel)
	T.check(not j.burn(1.0 / 60.0), "a hot pack will not thrust")
	var cool := 0.0
	while j.hot and cool < 10.0:
		j.rest(1.0 / 60.0, false)
		cool += 1.0 / 60.0
	T.check(not j.hot and j.heat <= JetpackSystem.RECOVER_AT + 0.01, "it recovers after cooling (%.1f s)" % cool)
	T.check(j.can_thrust() and j.burn(1.0 / 60.0), "and thrusts again")
	var k := JetpackSystem.new()
	k.max_fuel = 100.0
	k.fuel = 100.0
	var n := 0
	while k.burn(1.0 / 60.0) and n < 1200:
		n += 1
		if k.heat > 0.6:
			k.heat = 0.6            # keep it cool to test the tank on its own
	T.check(k.fuel <= 0.0 and not k.can_thrust(), "an empty tank stops the thrust (%d frames)" % n)
	k.rest(1.0, true)
	T.check(k.fuel > 20.0, "on the ground it refills fast (%.0f)" % k.fuel)
	var a := JetpackSystem.new()
	a.fuel = 10.0
	a.rest(1.0, false)
	T.check(a.fuel < 15.0, "in the air it barely refills (%.0f)" % a.fuel)
	T.done(self)
