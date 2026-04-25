extends Control

@export var mode_title: String = "Mode"
@export_multiline var mode_description: String = "Mode shell placeholder."

@onready var title_label: Label = $Center/Panel/ContentMargin/Content/Title
@onready var description_label: Label = $Center/Panel/ContentMargin/Content/Description
@onready var back_button: Button = $Center/Panel/ContentMargin/Content/BackButton

func _ready() -> void:
	title_label.text = mode_title
	description_label.text = mode_description
	back_button.pressed.connect(_on_back_pressed)

func _on_back_pressed() -> void:
	SceneRouter.route_to_main_menu()
