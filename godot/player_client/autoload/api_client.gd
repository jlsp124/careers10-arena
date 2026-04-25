extends Node
class_name ApiClient

func probe_host(_origin: String) -> Dictionary:
	return {
		"ok": false,
		"message": "Networking is not implemented in Phase A.",
	}


func login(_username: String, _password: String) -> Dictionary:
	return {
		"ok": false,
		"message": "Login is not implemented in Phase A.",
	}
