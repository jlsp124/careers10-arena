extends Node
class_name SceneRouter

const BOOT_SCENE := "res://scenes/boot/boot.tscn"
const CONNECT_SCENE := "res://scenes/connect/connect.tscn"
const LOGIN_SCENE := "res://scenes/auth/login.tscn"
const MAIN_MENU_SCENE := "res://scenes/menu/main_menu.tscn"
const ARENA_SCENE := "res://scenes/modes/arena/arena_mode_shell.tscn"
const PONG_SCENE := "res://scenes/modes/pong/pong_mode_shell.tscn"
const CRYPTO_SCENE := "res://scenes/modes/crypto/crypto_mode_shell.tscn"
const MESSAGES_SCENE := "res://scenes/modes/messages/messages_mode_shell.tscn"

var current_scene_path: String = BOOT_SCENE

func set_scene_path(scene_path: String) -> void:
	current_scene_path = scene_path
