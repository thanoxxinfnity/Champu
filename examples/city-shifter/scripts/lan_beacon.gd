class_name LanBeacon
extends Node
## Finds games on the same Wi-Fi: a host shouts "CSHIFT|name|players" to the broadcast address once a second, a finder listens and lists who it heard.

signal found(ip: String, host_name: String, players: int)

const PORT := 7778
const TAG := "CSHIFT"

var host_name := "PLAYER"
var players := 1
var _send: PacketPeerUDP
var _recv: PacketPeerUDP
var _t := 0.0
var heard := {}                       # ip -> [name, players, seconds since heard]


func start_host(name_: String) -> void:
	stop()
	host_name = name_
	_send = PacketPeerUDP.new()
	_send.set_broadcast_enabled(true)
	_send.set_dest_address("255.255.255.255", PORT)


func start_find() -> void:
	stop()
	heard.clear()
	_recv = PacketPeerUDP.new()
	if _recv.bind(PORT) != OK:
		_recv = null


func stop() -> void:
	if _send != null:
		_send.close()
	if _recv != null:
		_recv.close()
	_send = null
	_recv = null


func _process(delta: float) -> void:
	_t += delta
	if _send != null and _t > 1.0:
		_t = 0.0
		_send.put_packet(("%s|%s|%d" % [TAG, host_name.replace("|", " "), players]).to_utf8_buffer())
	if _recv != null:
		while _recv.get_available_packet_count() > 0:
			var msg := _recv.get_packet().get_string_from_utf8()
			var ip := _recv.get_packet_ip()
			var parts := msg.split("|")
			if parts.size() >= 3 and parts[0] == TAG and ip != "":
				var fresh := not heard.has(ip)
				heard[ip] = [parts[1], int(parts[2]), 0.0]
				if fresh:
					found.emit(ip, parts[1], int(parts[2]))
	for ip in heard.keys():
		heard[ip][2] = float(heard[ip][2]) + delta
		if float(heard[ip][2]) > 5.0:
			heard.erase(ip)
