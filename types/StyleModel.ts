export interface StyleModel {
	id: string;
	name: string;
	description?: string;
	version: number;
	downloadUrl: string;
	thumbnailUrl: string;
	fileSize?: string;
	isActive: boolean;
}

export type DownloadStatus =
	| "not_downloaded"
	| "downloading"
	| "downloaded"
	| "update_available"
	| "error";

export interface LocalModelMeta {
	id: string;
	version: number;
	localPath: string; // Absolute path to .tflite on device
	downloadedAt: number; // Unix ms
	fileSizeBytes: number;
}
