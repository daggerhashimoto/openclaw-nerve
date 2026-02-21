/**
 * Provider interfaces for TTS and STT services.
 * 
 * Defines common interfaces for voice providers to enable
 * plugin-style architecture with multiple backends.
 */

export interface TTSOptions {
  voice?: string;
  model?: string;
  language?: string;
  speed?: number;
  [key: string]: any; // Allow provider-specific options
}

export interface STTOptions {
  model?: string;
  language?: string;
  keywords?: string[];
  interim?: boolean;
  [key: string]: any; // Allow provider-specific options
}

export interface TTSResult {
  ok: boolean;
  buf?: Buffer;
  contentType?: string;
  message?: string;
  status?: number;
}

export interface STTResult {
  ok: boolean;
  text?: string;
  message?: string;
  status?: number;
}

export interface TTSProvider {
  name: string;
  requiresApiKey: boolean;
  synthesize(text: string, options: TTSOptions): Promise<TTSResult>;
  getVoices(): string[];
}

export interface STTProvider {
  name: string;
  requiresApiKey: boolean;
  supportsStreaming: boolean;
  transcribe(audio: Buffer, options: STTOptions): Promise<STTResult>;
}

export interface CustomProviderConfig {
  name: string;
  endpoint: string;
  apiKey?: string;
  headers?: Record<string, string>;
  requestTemplate: string; // JSON template with {{text}} or {{audio}} placeholders
  responseParser: string; // JSONPath to extract result
}

/**
 * Voice provider configuration (runtime, stored in voice-providers.json)
 */
export interface VoiceProvidersConfig {
  tts: {
    provider: 'openai' | 'edge' | 'replicate' | 'deepgram' | 'custom';
    deepgram?: {
      model: string;
      apiKey?: string;
    };
    openai?: {
      model: string;
      voice: string;
      apiKey?: string;
    };
    edge?: {
      voice: string;
    };
    replicate?: {
      model: string;
      apiKey?: string;
    };
    custom?: CustomProviderConfig;
  };
  stt: {
    provider: 'local' | 'openai' | 'deepgram' | 'custom';
    deepgram?: {
      model: string;
      keywords?: string[];
      apiKey?: string;
    };
    openai?: {
      model: string;
      apiKey?: string;
    };
    local?: {
      model: string;
    };
    custom?: CustomProviderConfig;
  };
}
