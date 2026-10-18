class_name GameBoot
extends RefCounted
## What the loading screen hands to the game scene: which mode the player picked.

enum Mode { STORY, FREE_ROAM }

static var mode := Mode.STORY
static var continue_save := false
