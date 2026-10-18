class_name Phone
extends CanvasLayer
## The smartphone. Up arrow opens it; four apps: Contacts / Missions, Valet, Maze Bank, Time & Weather. The phone only asks the
## director to do things (call the car, start a mission) and reads GameState; it owns no game rules itself.

signal opened
signal closed

var director: Node
var is_open := false
var page := &"home"

var _root: Control
var _body: VBoxContainer
var _title: Label
var _status: Label
var _back: Button


func _ready() -> void:
	layer = 40
	visible = false
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)
	var shell := PanelContainer.new()
	shell.name = "Shell"
	shell.set_anchors_preset(Control.PRESET_CENTER_RIGHT)
	shell.offset_left = -420.0
	shell.offset_right = -40.0
	shell.offset_top = -330.0
	shell.offset_bottom = 330.0
	var sb := UiKit.panel_style(0.96, 36)
	sb.set_border_width_all(4)
	sb.border_color = Color(0.2, 0.2, 0.24)
	sb.bg_color = Color(0.05, 0.06, 0.09)
	shell.add_theme_stylebox_override("panel", sb)
	_root.add_child(shell)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 10)
	shell.add_child(col)
	_status = UiKit.label("", 15, Color(0.7, 0.72, 0.78))
	col.add_child(_status)
	var head := HBoxContainer.new()
	col.add_child(head)
	_back = UiKit.button("‹", Vector2(44, 40), 24)
	_back.pressed.connect(func(): show_page(&"home"))
	head.add_child(_back)
	_title = UiKit.label("", 26, UiKit.ACCENT)
	_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	head.add_child(_title)
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 10)
	_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(_body)
	show_page(&"home")


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("smartphone"):
		toggle()
		get_viewport().set_input_as_handled()
	elif is_open and event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		close()


func toggle() -> void:
	if is_open:
		close()
	else:
		open()


func open() -> void:
	if is_open or director == null or not director.can_use_phone():
		return
	is_open = true
	visible = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	show_page(&"home")
	opened.emit()


func close() -> void:
	if not is_open:
		return
	is_open = false
	visible = false
	closed.emit()


func _process(_d: float) -> void:
	if is_open:
		_status.text = "%s   •   $%s" % [director.atmosphere.clock_text(), Hud._commas(director.state.cash)]


func _clear() -> void:
	for c in _body.get_children():
		_body.remove_child(c)
		c.queue_free()


func show_page(p: StringName) -> void:
	page = p
	_clear()
	_back.visible = p != &"home"
	match p:
		&"home":
			_title.text = "Phone"
			var grid := GridContainer.new()
			grid.columns = 2
			grid.add_theme_constant_override("h_separation", 12)
			grid.add_theme_constant_override("v_separation", 12)
			_body.add_child(grid)
			for app in [[&"contacts", "Contacts\nMissions"], [&"valet", "Valet"], [&"bank", "Maze Bank"], [&"time", "Time &\nWeather"]]:
				var b := UiKit.button(app[1], Vector2(160, 130), 22)
				b.name = "App_%s" % app[0]
				b.pressed.connect(show_page.bind(app[0]))
				grid.add_child(b)
		&"contacts":
			_title.text = "Contacts"
			_contacts_page()
		&"valet":
			_title.text = "Valet"
			_valet_page()
		&"bank":
			_title.text = "Maze Bank"
			_bank_page()
		&"time":
			_title.text = "Time & Weather"
			_time_page()


func _note(text: String) -> Label:
	var l := UiKit.label(text, 17, Color(0.78, 0.8, 0.86))
	l.autowrap_mode = TextServer.AUTOWRAP_WORD
	_body.add_child(l)
	return l


func _contacts_page() -> void:
	var st: GameState = director.state
	_note("Vance — fixer\nMr. Vance wants a briefcase from the Crimson Tower's executive floor.")
	var b := UiKit.button("Mission: The Penthouse Deal" if st.mission_stage == 0 else ("Mission: In progress…" if st.mission_stage < 99 else "Mission: Complete ✓"), Vector2(0, 52))
	b.name = "StartMission"
	b.disabled = st.mission_stage != 0
	b.pressed.connect(func():
		director.start_mission()
		close())
	_body.add_child(b)
	var wp := UiKit.button("Set waypoint: Crimson Tower", Vector2(0, 44), 16)
	wp.pressed.connect(func():
		director.set_waypoint(director.tower_waypoint())
		close())
	_body.add_child(wp)
	var home := UiKit.button("Set waypoint: Safehouse", Vector2(0, 44), 16)
	home.pressed.connect(func():
		director.set_waypoint(director.home_waypoint())
		close())
	_body.add_child(home)


func _valet_page() -> void:
	_note("Your %s is parked in the garage. The valet drives it to the nearest road for $50." % String(director.state.garage_car))
	var b := UiKit.button("Call valet — $50", Vector2(0, 54))
	b.name = "CallValet"
	b.pressed.connect(func():
		var msg: String = director.call_valet()
		_note(msg))
	_body.add_child(b)


func _bank_page() -> void:
	var st: GameState = director.state
	var cash := UiKit.label("", 20)
	var bank := UiKit.label("", 20, Color(0.55, 0.95, 0.55))
	_body.add_child(cash)
	_body.add_child(bank)
	var refresh := func():
		cash.text = "Cash:  $%s" % Hud._commas(st.cash)
		bank.text = "Balance:  $%s" % Hud._commas(st.bank)
	refresh.call()
	for amt in [1000, 5000]:
		var d := UiKit.button("Deposit $%s" % Hud._commas(amt), Vector2(0, 44), 17)
		d.pressed.connect(func():
			st.transfer_to_bank(amt)
			refresh.call())
		_body.add_child(d)
		var w := UiKit.button("Withdraw $%s" % Hud._commas(amt), Vector2(0, 44), 17)
		w.pressed.connect(func():
			st.withdraw(amt)
			refresh.call())
		_body.add_child(w)


func _time_page() -> void:
	var atm: Atmosphere = director.atmosphere
	var l := UiKit.label("", 22)
	_body.add_child(l)
	var refresh := func(): l.text = "%s\n%s  %d°C" % [atm.clock_text(), String(atm.weather).capitalize(), int(atm.temperature())]
	refresh.call()
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	_body.add_child(row)
	for h in [[6.0, "Dawn"], [12.0, "Noon"], [19.0, "Dusk"], [23.5, "Night"]]:
		var b := UiKit.button(h[1], Vector2(80, 44), 15)
		b.pressed.connect(func():
			atm.set_hour(h[0])
			refresh.call())
		row.add_child(b)
	for w in [&"clear", &"haze", &"rain"]:
		var b := UiKit.button(String(w).capitalize(), Vector2(0, 44), 17)
		b.name = "Weather_%s" % w
		b.pressed.connect(func():
			atm.set_weather(w)
			refresh.call())
		_body.add_child(b)
