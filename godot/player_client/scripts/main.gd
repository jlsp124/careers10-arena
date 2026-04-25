extends Node

func _ready() -> void:
	if Engine.is_editor_hint():
		return
	DisplayServer.window_set_title("Cortisol Player Client")
