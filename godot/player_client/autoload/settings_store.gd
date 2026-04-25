extends Node
class_name SettingsStore

const SETTINGS_PATH := "user://settings.json"

var settings := {
	"fullscreen": false,
	"audio_enabled": true,
	"audio_volume": 1.0,
	"debug_overlay": false,
	"remembered_locator_url": "",
}

func get_value(key: String, default_value = null):
	return settings.get(key, default_value)


func set_value(key: String, value) -> void:
	settings[key] = value
