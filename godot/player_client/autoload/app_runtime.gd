extends Node
class_name AppRuntime

const APP_PHASE := "Phase A"
const APP_VERSION := "0.0.1-scaffold"

var current_mode: StringName = &"boot"
var overlay_stack: Array[StringName] = []

func set_mode(mode_name: StringName) -> void:
	current_mode = mode_name


func push_overlay(overlay_name: StringName) -> void:
	overlay_stack.append(overlay_name)


func pop_overlay() -> StringName:
	if overlay_stack.is_empty():
		return &""
	return overlay_stack.pop_back()
