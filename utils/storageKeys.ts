export const STORAGE_KEYS = {
	// Key: "model_meta:{id}" → LocalModelMeta JSON
	modelMeta: (id: string) => `model_meta:${id}`,
	// Key: "all_model_ids" → JSON array of known IDs
	allModelIds: "all_model_ids",
} as const;
