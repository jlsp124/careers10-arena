extends Control

@onready var continue_button: Button = $Center/Panel/ContentMargin/Content/ContinueButton

func _ready() -> void:
	continue_button.pressed.connect(_on_continue_pressed)

func _on_continue_pressed() -> void:
	SceneRouter.route_to_connect()
