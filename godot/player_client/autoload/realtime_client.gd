extends Node
class_name RealtimeClient

signal connection_state_changed(state: StringName)

var connection_state: StringName = &"offline"
var lobby_snapshot: Dictionary = {}
var room_snapshot: Dictionary = {}

func set_connection_state(state: StringName) -> void:
	connection_state = state
	connection_state_changed.emit(state)
