extends Control

@onready var screen_host: Control = %ScreenHost

var active_screen: Node = null

func _ready() -> void:
	if Engine.is_editor_hint():
		return
	DisplayServer.window_set_title("Cortisol Player Client")
	SceneRouter.navigation_requested.connect(_on_navigation_requested)
	SceneRouter.route_to_boot()

func _on_navigation_requested(scene_path: String) -> void:
	var packed_scene := load(scene_path) as PackedScene
	if packed_scene == null:
		push_error("Failed to load scene: %s" % scene_path)
		return

	var next_screen := packed_scene.instantiate()
	if next_screen == null:
		push_error("Failed to instantiate scene: %s" % scene_path)
		return

	if active_screen != null:
		screen_host.remove_child(active_screen)
		active_screen.queue_free()

	active_screen = next_screen
	screen_host.add_child(active_screen)
