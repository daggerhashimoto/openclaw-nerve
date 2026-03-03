/**
 * Server-side constants — no hardcoded values in service files.
 * External API URLs, paths, and defaults all live here.
 * Override via env vars where noted.
 */

// ─── External API base URLs ───────────────────────────────────────────────────
// Override for proxies, self-hosted endpoints, or API-compatible alternatives.

export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
export const REPLICATE_BASE_URL = process.env.REPLICATE_BASE_URL || 'https://api.replicate.com/v1';

// ─── API endpoints (derived from base URLs) ──────────────────────────────────

export const OPENAI_TTS_URL = `${OPENAI_BASE_URL}/audio/speech`;
export const OPENAI_WHISPER_URL = `${OPENAI_BASE_URL}/audio/transcriptions`;
export const REPLICATE_QWEN_TTS_URL = `${REPLICATE_BASE_URL}/models/qwen/qwen3-tts/predictions`;

// ─── Default connection ──────────────────────────────────────────────────────

export const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:18789';
export const DEFAULT_GATEWAY_WS = 'ws://127.0.0.1:18789';
export const DEFAULT_PORT = 3080;
export const DEFAULT_SSL_PORT = 3443;
export const DEFAULT_HOST = '127.0.0.1';

// ─── Codex integration ──────────────────────────────────────────────────────

export const CODEX_DIR = process.env.CODEX_DIR || '.codex';

// ─── Whisper STT models (HuggingFace) ────────────────────────────────────────

export const WHISPER_MODELS_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
export const WHISPER_MODEL_FILES: Record<string, string> = {
  // English-only (legacy, slightly better English accuracy)
  'tiny.en':  'ggml-tiny.en.bin',
  'base.en':  'ggml-base.en.bin',
  'small.en': 'ggml-small.en.bin',
  // Multilingual (same size, 99 languages)
  'tiny':     'ggml-tiny.bin',
  'base':     'ggml-base.bin',
  'small':    'ggml-small.bin',
};

// New installs default to multilingual base for better multilingual accuracy.
export const WHISPER_DEFAULT_MODEL = 'base';

// ─── Language registry ───────────────────────────────────────────────────────

export interface LanguageConfig {
  code: string;         // ISO 639-1
  name: string;         // Display name
  nativeName: string;   // Name in own language
  whisperCode: string;  // Whisper language code
  edgeTtsVoices: {
    female: string;
    male: string;
  };
  qwen3Language: string | null;  // null = not supported
}

export const SUPPORTED_LANGUAGES: LanguageConfig[] = [
  {
    code: 'en', name: 'English', nativeName: 'English',
    whisperCode: 'en',
    edgeTtsVoices: { female: 'en-US-AriaNeural', male: 'en-US-GuyNeural' },
    qwen3Language: 'English',
  },
  {
    code: 'zh', name: 'Chinese', nativeName: '中文',
    whisperCode: 'zh',
    edgeTtsVoices: { female: 'zh-CN-XiaoxiaoNeural', male: 'zh-CN-YunxiNeural' },
    qwen3Language: 'Chinese',
  },
  {
    code: 'hi', name: 'Hindi', nativeName: 'हिन्दी',
    whisperCode: 'hi',
    edgeTtsVoices: { female: 'hi-IN-SwaraNeural', male: 'hi-IN-MadhurNeural' },
    qwen3Language: null,
  },
  {
    code: 'es', name: 'Spanish', nativeName: 'Español',
    whisperCode: 'es',
    edgeTtsVoices: { female: 'es-ES-ElviraNeural', male: 'es-ES-AlvaroNeural' },
    qwen3Language: 'Spanish',
  },
  {
    code: 'fr', name: 'French', nativeName: 'Français',
    whisperCode: 'fr',
    edgeTtsVoices: { female: 'fr-FR-DeniseNeural', male: 'fr-FR-HenriNeural' },
    qwen3Language: 'French',
  },
  {
    code: 'ar', name: 'Arabic', nativeName: 'العربية',
    whisperCode: 'ar',
    edgeTtsVoices: { female: 'ar-SA-ZariyahNeural', male: 'ar-SA-HamedNeural' },
    qwen3Language: null,
  },
  {
    code: 'bn', name: 'Bengali', nativeName: 'বাংলা',
    whisperCode: 'bn',
    edgeTtsVoices: { female: 'bn-IN-TanishaaNeural', male: 'bn-BD-PradeepNeural' },
    qwen3Language: null,
  },
  {
    code: 'pt', name: 'Portuguese', nativeName: 'Português',
    whisperCode: 'pt',
    edgeTtsVoices: { female: 'pt-BR-FranciscaNeural', male: 'pt-BR-AntonioNeural' },
    qwen3Language: 'Portuguese',
  },
  {
    code: 'ru', name: 'Russian', nativeName: 'Русский',
    whisperCode: 'ru',
    edgeTtsVoices: { female: 'ru-RU-SvetlanaNeural', male: 'ru-RU-DmitryNeural' },
    qwen3Language: 'Russian',
  },
  {
    code: 'ja', name: 'Japanese', nativeName: '日本語',
    whisperCode: 'ja',
    edgeTtsVoices: { female: 'ja-JP-NanamiNeural', male: 'ja-JP-KeitaNeural' },
    qwen3Language: 'Japanese',
  },
  {
    code: 'de', name: 'German', nativeName: 'Deutsch',
    whisperCode: 'de',
    edgeTtsVoices: { female: 'de-DE-KatjaNeural', male: 'de-DE-ConradNeural' },
    qwen3Language: 'German',
  },
  {
    code: 'tr', name: 'Turkish', nativeName: 'Türkçe',
    whisperCode: 'tr',
    edgeTtsVoices: { female: 'tr-TR-EmelNeural', male: 'tr-TR-AhmetNeural' },
    qwen3Language: null, // Not supported by Qwen3
  },
];

export const DEFAULT_LANGUAGE = 'en';

// ─── Default voice phrases per language ──────────────────────────────────────
// Used as suggestions when user first selects a non-English language.
// English defaults are the canonical set; others are translations.

export interface LanguageVoicePhrases {
  stopPhrases: string[];
  cancelPhrases: string[];
  wakePhrases?: string[];  // Optional — overrides default "hey <agent>" for this language
}

export const DEFAULT_VOICE_PHRASES: Record<string, LanguageVoicePhrases> = {
  en: {
    stopPhrases: ["boom", "i'm done", "im done", "all right i'm done", "alright i'm done", "that's it", "thats it", "send it", "done"],
    cancelPhrases: ['cancel', 'never mind', 'nevermind'],
  },
  zh: {
    stopPhrases: ['发送', '完了', '好了', '搞定', '就这样'],
    cancelPhrases: ['取消', '算了'],
  },
  hi: {
    stopPhrases: ['भेजो', 'हो गया', 'बस', 'भेज दो', 'बस इतना'],
    cancelPhrases: ['रद्द', 'छोड़ो', 'रहने दो'],
  },
  es: {
    stopPhrases: ['enviar', 'listo', 'ya está', 'terminé', 'envíalo'],
    cancelPhrases: ['cancelar', 'déjalo', 'olvídalo'],
  },
  fr: {
    stopPhrases: ['envoie', 'terminé', "c'est tout", 'fini', 'envoyer'],
    cancelPhrases: ['annuler', 'laisse tomber', "tant pis"],
  },
  ar: {
    stopPhrases: ['أرسل', 'خلاص', 'تم', 'انتهيت', 'كفاية'],
    cancelPhrases: ['إلغاء', 'خلاص ما أبي', 'لا تهتم'],
  },
  bn: {
    stopPhrases: ['পাঠাও', 'হয়ে গেছে', 'এটাই', 'শেষ'],
    cancelPhrases: ['বাতিল', 'থাক', 'দরকার নেই'],
  },
  pt: {
    stopPhrases: ['enviar', 'pronto', 'é isso', 'terminei', 'manda'],
    cancelPhrases: ['cancelar', 'deixa', 'esquece'],
  },
  ru: {
    stopPhrases: ['отправь', 'готово', 'всё', 'отправить', 'хватит'],
    cancelPhrases: ['отмена', 'забудь', 'не надо'],
  },
  ja: {
    stopPhrases: ['送って', '送信', '以上', '終わり', 'おわり'],
    cancelPhrases: ['キャンセル', 'やめて', 'いいや'],
  },
  de: {
    stopPhrases: ['sende', 'fertig', "das war's", 'erledigt', 'abschicken'],
    cancelPhrases: ['abbrechen', 'vergiss es', 'lass es'],
  },
  tr: {
    stopPhrases: ['gönder', 'tamam', 'bitti', 'bu kadar', 'yolla'],
    cancelPhrases: ['iptal', 'boşver', 'vazgeç'],
  },
};
