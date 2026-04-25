extends Control

@onready var continue_button: Button = $Center/Panel/ContentMargin/Content/ContinueButton
@onready var back_button: Button = $Center/Panel/ContentMargin/Content/BackButton

func _ready() -> void:
	continue_button.pressed.connect(_on_continue_pressed)
	back_button.pressed.connect(_on_back_pressed)

func _on_continue_pressed() -> void:
	SceneRouter.route_to_login()

func _on_back_pressed() -> void:
	SceneRouter.route_to_boot()
