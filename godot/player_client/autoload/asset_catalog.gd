extends Node
class_name AssetCatalog

const MANIFEST_PATH := "res://assets_imported/asset_manifest.json"

var loaded_manifest: Dictionary = {}

func lookup_asset(asset_id: String) -> Dictionary:
	return loaded_manifest.get(asset_id, {})
