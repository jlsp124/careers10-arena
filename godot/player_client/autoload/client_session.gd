extends Node
class_name ClientSession

var auth_token: String = ""
var active_host_url: String = ""
var profile: Dictionary = {}
var capabilities: Array[String] = []

func is_logged_in() -> bool:
	return not auth_token.is_empty()


func clear() -> void:
	auth_token = ""
	active_host_url = ""
	profile = {}
	capabilities.clear()
