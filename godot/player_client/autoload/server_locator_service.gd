extends Node
class_name ServerLocatorService

var saved_hosts: Array[Dictionary] = []
var locator_url: String = ""
var last_probe_result: Dictionary = {}

func get_saved_hosts() -> Array[Dictionary]:
	return saved_hosts


func remember_probe_result(result: Dictionary) -> void:
	last_probe_result = result.duplicate(true)
