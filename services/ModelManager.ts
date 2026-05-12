import * as FileSystem from "expo-file-system";
import { createMMKV } from "react-native-mmkv";
import {
	StyleModel,
	LocalModelMeta,
	DownloadStatus,
} from "../types/StyleModel";
import config from "../utils/config";

// ── MMKV storage instance ─────────────────────────────────────────────────────
// Module-level declaration is valid with MMKV v4 (NitroModules).
// The native instance is lazily initialised on first access, not at import time.
export const storage = createMMKV({
	id: "artlens-models",
});

// ── Models directory ──────────────────────────────────────────────────────────
// expo-file-system paths include the 'file://' scheme.
// documentDirectory may theoretically be null on web (not a target platform).
const DOC_DIR = FileSystem.Directory ?? "file:///tmp/artlens/";
export const MODELS_DIR = `${DOC_DIR}artlens_models`;

// ── API ───────────────────────────────────────────────────────────────────────
const API_BASE = config.API_BASE;

export async function fetchModelList(): Promise<StyleModel[]> {
	const res = await fetch(`${API_BASE}/api/models-manifest`, {
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		method: "POST",
	});
	if (!res.ok) throw new Error(`API error: ${res.status}`);
	const data = await res.json();
	return data.updates as StyleModel[];
}

// ── MMKV metadata helpers — all synchronous ───────────────────────────────────

/** Read model metadata synchronously. Returns null if not found. */
export function getLocalMeta(id: string): LocalModelMeta | null {
	const raw = storage.getString(`model_meta:${id}`);
	return raw ? (JSON.parse(raw) as LocalModelMeta) : null;
}

function setLocalMeta(meta: LocalModelMeta): void {
	storage.set(`model_meta:${meta.id}`, JSON.stringify(meta));
}

function removeLocalMeta(id: string): void {
	storage.remove(`model_meta:${id}`);
}

// ── Download status ───────────────────────────────────────────────────────────
// Synchronous — MMKV reads instantly.
export function getDownloadStatus(model: StyleModel): DownloadStatus {
	const meta = getLocalMeta(model.id);
	if (!meta) return "not_downloaded";
	if (meta.version < model.version) return "update_available";
	return "downloaded";
}

/** Canonical on-device path for a given model (includes file:// scheme). */
export function expectedLocalPath(model: StyleModel): string {
	return `${MODELS_DIR}/${model.id}_v${model.version}.tflite`;
}

// ── Storage guard ─────────────────────────────────────────────────────────────
const MIN_FREE_MB = 100;

async function assertSufficientStorage(requiredBytes: number): Promise<void> {
	// expo-file-system returns bytes as a number
	const free = await FileSystem.getFreeDiskStorageAsync();
	const freeMB = free / 1_000_000;
	const needMB = requiredBytes / 1_000_000;
	if (freeMB < needMB + MIN_FREE_MB) {
		throw new Error(
			`Insufficient storage. Need ${needMB.toFixed(0)} MB + ` +
				`${MIN_FREE_MB} MB buffer, only ${freeMB.toFixed(0)} MB free.`,
		);
	}
}

// ── File integrity ────────────────────────────────────────────────────────────
async function verifyFileIntegrity(
	fileUri: string,
	expectedBytes?: number,
): Promise<boolean> {
	try {
		// { size: true } is required to populate the size field
		const info = await FileSystem.getInfoAsync(fileUri);
		if (!info.exists) return false;

		// Expo's getInfoAsync with size:true guarantees size is present
		const size = "size" in info ? (info.size ?? 0) : 0;
		if (size < 1_000) return false; // < 1 KB → definitely corrupt

		if (
			expectedBytes !== undefined &&
			Math.abs(size - expectedBytes) > 1_024
		) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

// ── Download manager ──────────────────────────────────────────────────────────
type ProgressCallback = (percent: number) => void;
export type DownloadResult =
	| { success: true; path: string }
	| { success: false; error: string };

export async function downloadModel(
	model: StyleModel,
	onProgress?: ProgressCallback,
): Promise<DownloadResult> {
	try {
		// 1. Ensure models directory exists
		await FileSystem.makeDirectoryAsync(MODELS_DIR, {
			intermediates: true,
		});

		const expectedBytes = model.fileSize
			? parseInt(model.fileSize, 10)
			: undefined;

		// 2. Check available storage BEFORE writing anything
		await assertSufficientStorage(expectedBytes ?? 60_000_000);

		const destUri = expectedLocalPath(model);

		// 3. Remove stale old-version file if the version number changed
		const oldMeta = getLocalMeta(model.id);
		if (oldMeta && oldMeta.localPath !== destUri) {
			await FileSystem.deleteAsync(oldMeta.localPath, {
				idempotent: true,
			});
		}

		// 4. Already downloaded and valid → return immediately (idempotent)
		if (await verifyFileIntegrity(destUri, expectedBytes)) {
			const info = await FileSystem.getInfoAsync(destUri);
			const size = "size" in info ? (info.size ?? 0) : 0;
			setLocalMeta({
				id: model.id,
				version: model.version,
				localPath: destUri,
				downloadedAt: Date.now(),
				fileSizeBytes: size,
			});
			return { success: true, path: destUri };
		}

		// 5. Download via expo-file-system's resumable downloader.
		//    createDownloadResumable supports:
		//      • progress callbacks (totalBytesWritten / totalBytesExpectedToWrite)
		//      • resume after interruption (call .resumeAsync())
		//      • pause mid-download (call .pauseAsync())
		let lastProgress = 0;
		const downloadResumable = FileSystem.createDownloadResumable(
			model.downloadUrl,
			destUri,
			{}, // options (headers, md5, cache etc.)
			(progress) => {
				const { totalBytesWritten, totalBytesExpectedToWrite } =
					progress;
				if (totalBytesExpectedToWrite > 0) {
					const pct =
						(totalBytesWritten / totalBytesExpectedToWrite) * 100;
					// Only notify on meaningful progress delta to avoid flooding the store
					if (pct - lastProgress >= 1) {
						lastProgress = pct;
						onProgress?.(pct);
					}
				}
			},
		);

		const downloadResult = await downloadResumable.downloadAsync();

		if (
			!downloadResult ||
			downloadResult.status < 200 ||
			downloadResult.status >= 300
		) {
			throw new Error(
				`Server returned HTTP ${downloadResult?.status ?? "unknown"}`,
			);
		}

		// 6. Verify the downloaded file
		if (!(await verifyFileIntegrity(destUri, expectedBytes))) {
			await FileSystem.deleteAsync(destUri, { idempotent: true });
			return {
				success: false,
				error: "Downloaded file is corrupt or incomplete.",
			};
		}

		// 7. Persist metadata to MMKV (synchronous write)
		const info = await FileSystem.getInfoAsync(destUri);
		const size = "size" in info ? (info.size ?? 0) : 0;
		setLocalMeta({
			id: model.id,
			version: model.version,
			localPath: destUri,
			downloadedAt: Date.now(),
			fileSizeBytes: size,
		});

		return { success: true, path: destUri };
	} catch (err: unknown) {
		// Clean up any partial download (idempotent = safe even if file doesn't exist)
		const destUri = expectedLocalPath(model);
		await FileSystem.deleteAsync(destUri, { idempotent: true }).catch(
			() => {},
		);
		const message =
			err instanceof Error ? err.message : "Unknown download error.";
		return { success: false, error: message };
	}
}

export async function deleteModel(id: string): Promise<void> {
	const meta = getLocalMeta(id);
	if (!meta) return;
	// idempotent: no error if the file was already deleted externally
	await FileSystem.deleteAsync(meta.localPath, { idempotent: true });
	removeLocalMeta(id);
}
