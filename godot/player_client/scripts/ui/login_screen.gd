extends Control

@onready var username_input: LineEdit = $Center/Panel/ContentMargin/Content/UsernameInput
@onready var password_input: LineEdit = $Center/Panel/ContentMargin/Content/PasswordInput
@onready var login_button: Button = $Center/Panel/ContentMargin/Content/LoginButton
@onready var create_account_button: Button = $Center/Panel/ContentMargin/Content/CreateAccountButton
@onready var back_button: Button = $Center/Panel/ContentMargin/Content/BackButton

func _ready() -> void:
	login_button.pressed.connect(_on_submit_pressed)
	create_account_button.pressed.connect(_on_submit_pressed)
	back_button.pressed.connect(_on_back_pressed)
	username_input.grab_focus()

func _on_submit_pressed() -> void:
	_ = username_input.text
	_ = password_input.text
	SceneRouter.route_to_main_menu()

func _on_back_pressed() -> void:
	SceneRouter.route_to_connect()
