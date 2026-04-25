extends Control

@onready var arena_button: Button = $Shell/Content/Cards/ArenaButton
@onready var pong_button: Button = $Shell/Content/Cards/PongButton
@onready var crypto_button: Button = $Shell/Content/Cards/CryptoButton
@onready var messages_button: Button = $Shell/Content/Cards/MessagesButton
@onready var logout_button: Button = $Shell/Content/Header/LogoutButton

func _ready() -> void:
	arena_button.pressed.connect(_on_arena_pressed)
	pong_button.pressed.connect(_on_pong_pressed)
	crypto_button.pressed.connect(_on_crypto_pressed)
	messages_button.pressed.connect(_on_messages_pressed)
	logout_button.pressed.connect(_on_logout_pressed)

func _on_arena_pressed() -> void:
	SceneRouter.route_to_arena()

func _on_pong_pressed() -> void:
	SceneRouter.route_to_pong()

func _on_crypto_pressed() -> void:
	SceneRouter.route_to_crypto()

func _on_messages_pressed() -> void:
	SceneRouter.route_to_messages()

func _on_logout_pressed() -> void:
	SceneRouter.route_to_login()
