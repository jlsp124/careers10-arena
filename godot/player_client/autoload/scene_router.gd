extends Node
class_name SceneRouter

signal navigation_requested(scene_path: String)

const BOOT_SCENE := "res://scenes/boot/boot.tscn"
const CONNECT_SCENE := "res://scenes/connect/connect.tscn"
const LOGIN_SCENE := "res://scenes/auth/login.tscn"
const MAIN_MENU_SCENE := "res://scenes/menu/main_menu.tscn"
const ARENA_SCENE := "res://scenes/modes/arena/arena_mode_shell.tscn"
const PONG_SCENE := "res://scenes/modes/pong/pong_mode_shell.tscn"
const CRYPTO_SCENE := "res://scenes/modes/crypto/crypto_mode_shell.tscn"
const MESSAGES_SCENE := "res://scenes/modes/messages/messages_mode_shell.tscn"

var current_scene_path: String = BOOT_SCENE

func request_scene(scene_path: String) -> void:
	if scene_path.is_empty():
		push_warning("SceneRouter received an empty scene path.")
		return
	current_scene_path = scene_path
	navigation_requested.emit(scene_path)

func route_to_boot() -> void:
	request_scene(BOOT_SCENE)

func route_to_connect() -> void:
	request_scene(CONNECT_SCENE)

func route_to_login() -> void:
	request_scene(LOGIN_SCENE)

func route_to_main_menu() -> void:
	request_scene(MAIN_MENU_SCENE)

func route_to_arena() -> void:
	request_scene(ARENA_SCENE)

func route_to_pong() -> void:
	request_scene(PONG_SCENE)

func route_to_crypto() -> void:
	request_scene(CRYPTO_SCENE)

func route_to_messages() -> void:
	request_scene(MESSAGES_SCENE)
