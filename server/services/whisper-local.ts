/**
 * Local Whisper transcription via @fugood/whisper.node.
 *
 * Keeps a singleton WhisperContext alive for the server's lifetime.
 * Converts incoming audio to 16kHz mono WAV via ffmpeg, then transcribes.
 * @module
 */

import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, accessSync, mkdirSync, createWriteStream, readdirSync } from 'node:fs';
import { join, delimiter as pathDelimiter } from 'node:path';
import { tmpdir, cpus, availableParallelism } from 'node:os';
import { randomUUID } from 'node:crypto';
import { initWhisper } from '@fugood/whisper.node';
import type { WhisperContext, TranscribeOptions } from '@fugood/whisper.node';
import { config } from '../lib/config.js';
import { WHISPER_MODEL_FILES, WHISPER_MODELS_BASE_URL } from '../lib/constants.js';
import { resolveLanguage } from '../lib/language.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TranscribeLocalResult {
  ok: true;
  text: string;
}

export interface TranscribeLocalError {
  ok: false;
  status: number;
  message: string;
}

// ── Singleton context ────────────────────────────────────────────────────────

let whisperContext: WhisperContext | null = null;
let contextInitializing: Promise<WhisperContext> | null = null;
let activeModel: string = config.whisperModel;

/** Resolve the full path to a Whisper model file. */
function modelPath(model?: string): string {
  const m = model || activeModel;
  const filename = WHISPER_MODEL_FILES[m];
  if (!filename) throw new Error(`Unknown Whisper model: ${m}`);
  return join(config.whisperModelDir, filename);
}

/** Get the currently active model name. */
export function getActiveModel(): string {
  return activeModel;
}

/** Check if a Whisper model file exists. */
export function isModelAvailable(model?: string): boolean {
  try {
    accessSync(modelPath(model));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get or initialize the singleton WhisperContext.
 * The context loads the model into memory once and reuses it for all requests.
 * This avoids ~2-3 second model loading time on every transcription.
 */
async function getContext(): Promise<WhisperContext> {
  if (whisperContext) return whisperContext;

  // Prevent concurrent initialization (multiple requests hitting at same time)
  if (contextInitializing) return contextInitializing;

  // useGpu is meaningful on macOS (triggers Metal) and on Linux when a Vulkan
  // ICD is present; on Linux without Vulkan we must keep useGpu false too so
  // initWhisper doesn't fall into "useGpu=true + backend=undefined" territory
  // and probe on its own. `detectGpu()` is too permissive for the backend
  // gate — it returns true on CUDA-only NVIDIA containers where nvidia-smi
  // works but no Vulkan ICD is installed, and forcing 'vulkan' in that case
  // makes initWhisper throw at context init.
  const useGpu = process.platform !== 'linux' || hasVulkanBackend();
  const backend = process.platform === 'linux' && useGpu ? 'vulkan' : undefined;

  // initWhisper throws synchronously inside the promise if the requested
  // backend can't initialize (e.g., the ICD manifest probe matched a stale
  // JSON whose driver library isn't loadable). Fall back to CPU once if the
  // Vulkan path fails — the probes are heuristics, not load-time guarantees.
  const initWithFallback = async (): Promise<WhisperContext> => {
    try {
      return await initWhisper({ filePath: modelPath(), useGpu }, backend);
    } catch (err) {
      if (backend !== 'vulkan') throw err;
      console.warn(
        `[whisper-local] Vulkan init failed, retrying on CPU: ${(err as Error).message}`,
      );
      vulkanBackendAvailable = false; // poison the cache so future inits skip the probe
      gpuDetected = null; // force detectGpu() to recompute so getSystemInfo() reports the post-fallback state
      return initWhisper({ filePath: modelPath(), useGpu: false });
    }
  };

  contextInitializing = initWithFallback().then((ctx) => {
    whisperContext = ctx;
    contextInitializing = null;
    console.log(`[whisper-local] Model loaded: ${activeModel}`);
    return ctx;
  }).catch((err) => {
    contextInitializing = null;
    throw err;
  });

  return contextInitializing;
}

/** Release the Whisper context (call on server shutdown). */
export async function releaseWhisperContext(): Promise<void> {
  if (whisperContext) {
    await whisperContext.release();
    whisperContext = null;
    console.log('[whisper-local] Context released');
  }
}

// ── Model download ───────────────────────────────────────────────────────────

interface DownloadProgress {
  model: string;
  downloading: boolean;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  error?: string;
}

let currentDownload: DownloadProgress | null = null;
let currentDownloadAbort: AbortController | null = null;

/** Get current download progress (null if no download active). */
export function getDownloadProgress(): DownloadProgress | null {
  return currentDownload;
}

/**
 * Download a Whisper model from HuggingFace.
 * Tracks progress in `currentDownload` for the UI to poll.
 */
async function downloadModel(model: string): Promise<{ ok: boolean; message: string }> {
  const filename = WHISPER_MODEL_FILES[model];
  if (!filename) return { ok: false, message: `Unknown model: ${model}` };

  const destPath = modelPath(model);
  const tmpPath = destPath + '.downloading';

  // Ensure directory exists
  mkdirSync(config.whisperModelDir, { recursive: true });

  const url = `${WHISPER_MODELS_BASE_URL}/${filename}`;
  console.log(`[whisper-local] Downloading model: ${model} from ${url}`);

  const progress: DownloadProgress = { model, downloading: true, bytesDownloaded: 0, totalBytes: 0, percent: 0 };
  currentDownload = progress;

  const controller = new AbortController();
  currentDownloadAbort = controller;

  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!response.ok || !response.body) {
      if (currentDownload === progress) {
        progress.downloading = false;
        progress.error = `HTTP ${response.status}`;
      }
      return { ok: false, message: `Download failed: HTTP ${response.status}` };
    }

    const totalBytes = Number(response.headers.get('content-length') || 0);
    progress.totalBytes = totalBytes;

    const writer = createWriteStream(tmpPath);
    let bytesDownloaded = 0;

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(Buffer.from(value));
      bytesDownloaded += value.byteLength;
      progress.bytesDownloaded = bytesDownloaded;
      progress.percent = totalBytes > 0 ? Math.round((bytesDownloaded / totalBytes) * 100) : 0;
    }
    writer.end();

    // Wait for file to finish writing
    await new Promise<void>((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // Rename tmp → final (atomic-ish)
    const { renameSync } = await import('node:fs');
    renameSync(tmpPath, destPath);

    if (currentDownload === progress) {
      progress.downloading = false;
      progress.percent = 100;
    }
    console.log(`[whisper-local] Model downloaded: ${model} (${(bytesDownloaded / 1024 / 1024).toFixed(0)}MB)`);

    // Clear download state after a moment so UI can see completion
    setTimeout(() => {
      if (currentDownload === progress) currentDownload = null;
    }, 3000);

    return { ok: true, message: `Downloaded ${model}` };
  } catch (err) {
    const isAbort = (err as { name?: string })?.name === 'AbortError';
    const msg = isAbort ? 'Download cancelled' : (err as Error).message;
    if (!isAbort) {
      console.error('[whisper-local] Download failed:', msg);
    }

    if (currentDownload === progress) {
      progress.downloading = false;
      progress.error = msg;
    }

    // Clean up partial file
    try { unlinkSync(tmpPath); } catch { /* ignore */ }

    // Clear error/cancel state after a moment
    setTimeout(() => {
      if (currentDownload === progress) currentDownload = null;
    }, isAbort ? 1200 : 5000);

    return { ok: false, message: isAbort ? `${model} download cancelled` : `Download failed: ${msg}` };
  } finally {
    if (currentDownloadAbort === controller) {
      currentDownloadAbort = null;
    }
  }
}

/**
 * Switch to a different Whisper model at runtime.
 * If the model isn't downloaded, triggers download automatically.
 */
export async function setWhisperModel(model: string): Promise<{ ok: boolean; message: string; downloading?: boolean }> {
  if (!WHISPER_MODEL_FILES[model]) {
    return { ok: false, message: `Unknown model: ${model}. Available: ${Object.keys(WHISPER_MODEL_FILES).join(', ')}` };
  }

  // If model not available, start downloading
  if (!isModelAvailable(model)) {
    if (currentDownload?.downloading) {
      if (currentDownload.model === model) {
        return { ok: true, message: `Already downloading ${currentDownload.model}`, downloading: true };
      }
      // User switched model while another download is running.
      // Cancel stale download and start requested model instead.
      currentDownloadAbort?.abort();
    }

    // Fire and forget — download runs in background
    downloadModel(model).then((result) => {
      if (result.ok) {
        // Auto-switch after successful download
        releaseWhisperContext().then(() => {
          activeModel = model;
          console.log(`[whisper-local] Switched to downloaded model: ${model}`);
        });
      }
    });
    return { ok: true, message: `Downloading ${model}...`, downloading: true };
  }

  // If switching to an already-available model while another download is in progress,
  // cancel the stale background download to avoid confusing progress UI.
  if (currentDownload?.downloading && currentDownload.model !== model) {
    currentDownloadAbort?.abort();
  }

  if (model === activeModel && whisperContext) {
    return { ok: true, message: `Already using ${model}` };
  }

  // Release current context — next request will init with new model
  await releaseWhisperContext();
  activeModel = model;
  console.log(`[whisper-local] Switched to model: ${model}`);
  return { ok: true, message: `Switched to ${model}` };
}

// ── System info ──────────────────────────────────────────────────────────────

let gpuDetected: boolean | null = null;
let vulkanBackendAvailable: boolean | null = null;

/** Standard Vulkan loader ICD manifest directories per the Vulkan-Loader spec. */
const VULKAN_ICD_DIRS = [
  '/usr/share/vulkan/icd.d',
  '/usr/local/share/vulkan/icd.d',
  '/etc/vulkan/icd.d',
];

/**
 * Detect a Vulkan ICD via manifest enumeration — covers slim containers that ship
 * libvulkan + ICD JSONs but omit the `vulkan-tools` (`vulkaninfo`) CLI package.
 * Honors `VK_DRIVER_FILES` / `VK_ICD_FILENAMES` overrides as the loader does.
 */
function hasVulkanIcdManifest(): boolean {
  const checkPath = (p: string): boolean => {
    if (!p) return false;
    try { accessSync(p); return true; } catch { return false; }
  };
  const checkList = (raw: string | undefined): boolean =>
    // Loader splits these env vars on the OS path-list delimiter (`:` POSIX, `;` Win).
    // Hardcoding `:` would mangle Windows entries like `C:\drivers\nvidia.json`.
    raw ? raw.split(pathDelimiter).some(checkPath) : false;

  // VK_DRIVER_FILES / legacy VK_ICD_FILENAMES *replace* the loader's default search.
  const replace = (process.env.VK_DRIVER_FILES ?? process.env.VK_ICD_FILENAMES)?.trim();
  if (replace) return checkList(replace);

  // VK_ADD_DRIVER_FILES is *additive* on top of the default search.
  if (checkList(process.env.VK_ADD_DRIVER_FILES?.trim())) return true;

  return VULKAN_ICD_DIRS.some(dir => {
    try {
      return readdirSync(dir).some(f => f.endsWith('.json'));
    } catch {
      return false;
    }
  });
}

/**
 * Probe for a Vulkan ICD/runtime — the stricter check needed before passing 'vulkan'
 * to initWhisper. Prefers `vulkaninfo --summary` (most authoritative), then falls
 * back to ICD manifest enumeration so slim Linux containers with the runtime but
 * no CLI tools still light up the GPU path.
 */
function hasVulkanBackend(): boolean {
  if (vulkanBackendAvailable !== null) return vulkanBackendAvailable;
  try {
    execSync('vulkaninfo --summary', { stdio: 'pipe', timeout: 3000 });
    vulkanBackendAvailable = true;
    return vulkanBackendAvailable;
  } catch { /* fall through */ }
  vulkanBackendAvailable = hasVulkanIcdManifest();
  return vulkanBackendAvailable;
}

/** Check if a GPU is available by looking at Vulkan/Metal/CUDA device presence. */
function detectGpu(): boolean {
  if (gpuDetected !== null) return gpuDetected;
  try {
    // Try nvidia-smi (CUDA)
    try { execSync('nvidia-smi', { stdio: 'pipe', timeout: 3000 }); gpuDetected = true; return true; } catch { /* no nvidia */ }
    // Reuse the Vulkan probe so vulkaninfo is spawned at most once per process.
    if (hasVulkanBackend()) { gpuDetected = true; return true; }
    // macOS Metal is always available on Apple Silicon
    if (process.platform === 'darwin' && process.arch === 'arm64') { gpuDetected = true; return true; }
    gpuDetected = false;
    return false;
  } catch {
    gpuDetected = false;
    return false;
  }
}

/** Return system info relevant to STT performance. */
export function getSystemInfo(): { hasGpu: boolean; cpuCount: number } {
  return {
    hasGpu: detectGpu(),
    cpuCount: cpus().length,
  };
}

// ── ffmpeg ────────────────────────────────────────────────────────────────────

let ffmpegAvailable: boolean | null = null;

/** Check if ffmpeg is available (cached after first call). */
function hasFfmpeg(): boolean {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe', timeout: 5000 });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

/** Convert audio to 16kHz mono WAV using ffmpeg. */
function convertToWav(inputPath: string, outputPath: string): void {
  execFileSync('ffmpeg', [
    '-i', inputPath,
    '-ar', '16000',       // 16kHz sample rate (required by Whisper)
    '-ac', '1',            // mono
    '-sample_fmt', 's16',  // 16-bit signed PCM
    '-f', 'wav',
    '-y',                  // overwrite output
    outputPath,
  ], { stdio: 'pipe', timeout: 30_000 });
}

// ── Main transcription function ──────────────────────────────────────────────

/**
 * Transcribe audio using the local Whisper model.
 *
 * Flow:
 *   1. Save uploaded buffer to temp file
 *   2. ffmpeg convert to 16kHz mono WAV
 *   3. whisper context.transcribeFile() → TranscribeResult
 *   4. Extract result.result (full text string)
 *   5. Clean up temp files
 */
export async function transcribeLocal(
  fileData: Buffer,
  filename: string,
  language?: string,
): Promise<TranscribeLocalResult | TranscribeLocalError> {
  // Pre-flight checks
  if (!isModelAvailable()) {
    return {
      ok: false,
      status: 500,
      message: `Speech model not found at ${modelPath()}. Re-run the installer or set STT_PROVIDER=openai with an OPENAI_API_KEY.`,
    };
  }

  if (!hasFfmpeg()) {
    return {
      ok: false,
      status: 500,
      message: 'ffmpeg not found. Install it: apt install ffmpeg (Linux) or brew install ffmpeg (macOS)',
    };
  }

  // Resolve the effective language for whisper
  const effectiveLang = language || config.language;
  const isEnModel = activeModel.endsWith('.en');

  // If language is non-English and model is .en, warn and fall back
  if (effectiveLang !== 'en' && isEnModel) {
    console.warn(
      `[whisper-local] Language "${effectiveLang}" requested but model "${activeModel}" is English-only. ` +
      'Falling back to English. Switch to a multilingual model (e.g. "base") for better non-English support.',
    );
  }

  // Build whisper options: .en models only accept 'en'; multilingual accepts language codes
  const whisperLang = isEnModel ? 'en' : (resolveLanguage(effectiveLang)?.whisperCode || effectiveLang);

  const id = randomUUID().slice(0, 8);
  const inputTmp = join(tmpdir(), `nerve-stt-in-${id}-${filename}`);
  const wavTmp = join(tmpdir(), `nerve-stt-${id}.wav`);

  try {
    // 1. Save uploaded audio to temp file
    writeFileSync(inputTmp, fileData);

    // 2. Convert to 16kHz mono WAV
    try {
      convertToWav(inputTmp, wavTmp);
    } catch (err) {
      console.error('[whisper-local] ffmpeg conversion failed:', (err as Error).message);
      return { ok: false, status: 500, message: 'Audio format conversion failed' };
    }

    // 3. Get/init the singleton context and transcribe
    const ctx = await getContext();
    const transcribeOpts: TranscribeOptions = {
      temperature: 0.0,
      language: whisperLang,
      // availableParallelism honors cgroup CPU quota on Linux (libuv reads
      // cgroup v1/v2 CFS limits + sched_getaffinity); cpus().length over-allocates
      // worker threads inside containers with a CPU quota smaller than the host.
      maxThreads: availableParallelism(),
    };
    const { promise } = ctx.transcribeFile(wavTmp, transcribeOpts);

    const result = await promise;

    // 4. Extract text
    if (result.isAborted) {
      return { ok: false, status: 500, message: 'Transcription was aborted' };
    }

    const text = result.result?.trim() || '';
    if (!text) {
      return { ok: false, status: 500, message: 'Transcription returned empty result' };
    }

    return { ok: true, text };
  } catch (err) {
    console.error('[whisper-local] Transcription failed:', (err as Error).message);
    return { ok: false, status: 500, message: 'Local transcription failed: ' + (err as Error).message };
  } finally {
    // 5. Always clean up temp files
    try { unlinkSync(inputTmp); } catch { /* ignore */ }
    try { unlinkSync(wavTmp); } catch { /* ignore */ }
  }
}
