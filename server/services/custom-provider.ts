/**
 * Generic custom provider for TTS and STT.
 * 
 * Allows users to configure any HTTP-based voice API using templates.
 * Supports JSONPath for response parsing.
 */

import type { TTSOptions, STTOptions, TTSResult, STTResult, CustomProviderConfig } from '../lib/provider-interfaces.js';

/**
 * Simple JSONPath parser (supports basic dot notation and array indices).
 * For production, consider using a full JSONPath library like `jsonpath-plus`.
 */
function parseJSONPath(data: any, path: string): any {
  if (!path || path === '$') return data;
  
  // Remove leading $ and split by dots
  const parts = path.replace(/^\$\.?/, '').split('.');
  let current = data;
  
  for (const part of parts) {
    // Handle array indices: data[0]
    const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
    if (arrayMatch) {
      const [, key, index] = arrayMatch;
      current = current?.[key]?.[parseInt(index, 10)];
    } else {
      current = current?.[part];
    }
    
    if (current === undefined) return undefined;
  }
  
  return current;
}

/**
 * Substitute template variables: {{text}}, {{voice}}, {{audio_base64}}, etc.
 */
function substituteTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  
  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }
  
  return result;
}

/**
 * Synthesize speech using custom HTTP endpoint.
 */
export async function synthesizeCustom(
  text: string,
  config: CustomProviderConfig,
  options: TTSOptions = {}
): Promise<TTSResult> {
  if (!config.endpoint) {
    return {
      ok: false,
      message: 'Custom TTS endpoint not configured',
      status: 400,
    };
  }

  const apiKey = options.apiKey || config.apiKey;
  const voice = options.voice || 'default';

  console.log(`[custom-tts] Synthesizing ${text.length} chars to ${config.endpoint}`);

  try {
    // Substitute template variables
    const requestBody = substituteTemplate(config.requestTemplate, {
      text,
      voice,
      model: options.model || '',
      language: options.language || 'en',
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[custom-tts] API error ${response.status}:`, errorText);
      return {
        ok: false,
        message: `Custom TTS failed: ${response.status} ${response.statusText}`,
        status: response.status,
      };
    }

    // Parse response
    const contentType = response.headers.get('content-type') || '';
    
    // If response is audio, return directly
    if (contentType.includes('audio/')) {
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      return {
        ok: true,
        buf: audioBuffer,
        contentType,
      };
    }

    // Otherwise parse JSON and extract audio URL or base64
    const jsonResponse = await response.json();
    const audioData = parseJSONPath(jsonResponse, config.responseParser);

    if (!audioData) {
      return {
        ok: false,
        message: `Could not parse audio from response using path: ${config.responseParser}`,
        status: 500,
      };
    }

    // If audioData is a URL, fetch it
    if (typeof audioData === 'string' && audioData.startsWith('http')) {
      const audioResponse = await fetch(audioData);
      const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
      return {
        ok: true,
        buf: audioBuffer,
        contentType: audioResponse.headers.get('content-type') || 'audio/mpeg',
      };
    }

    // If audioData is base64, decode it
    if (typeof audioData === 'string') {
      const audioBuffer = Buffer.from(audioData, 'base64');
      return {
        ok: true,
        buf: audioBuffer,
        contentType: 'audio/mpeg',
      };
    }

    return {
      ok: false,
      message: 'Unexpected audio data format in response',
      status: 500,
    };
  } catch (err) {
    console.error('[custom-tts] Synthesis error:', (err as Error).message);
    return {
      ok: false,
      message: `Custom TTS failed: ${(err as Error).message}`,
      status: 500,
    };
  }
}

/**
 * Transcribe audio using custom HTTP endpoint.
 */
export async function transcribeCustom(
  audio: Buffer,
  config: CustomProviderConfig,
  options: STTOptions = {}
): Promise<STTResult> {
  if (!config.endpoint) {
    return {
      ok: false,
      message: 'Custom STT endpoint not configured',
      status: 400,
    };
  }

  const apiKey = options.apiKey || config.apiKey;

  console.log(`[custom-stt] Transcribing ${audio.length} bytes to ${config.endpoint}`);

  try {
    // Convert audio to base64 for JSON transport
    const audioBase64 = audio.toString('base64');

    // Substitute template variables
    const requestBody = substituteTemplate(config.requestTemplate, {
      audio_base64: audioBase64,
      model: options.model || '',
      language: options.language || 'en',
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[custom-stt] API error ${response.status}:`, errorText);
      return {
        ok: false,
        message: `Custom STT failed: ${response.status} ${response.statusText}`,
        status: response.status,
      };
    }

    const jsonResponse = await response.json();
    const transcript = parseJSONPath(jsonResponse, config.responseParser);

    if (typeof transcript !== 'string') {
      return {
        ok: false,
        message: `Could not parse transcript from response using path: ${config.responseParser}`,
        status: 500,
      };
    }

    console.log(`[custom-stt] Transcribed: "${transcript.substring(0, 100)}"`);

    return {
      ok: true,
      text: transcript,
    };
  } catch (err) {
    console.error('[custom-stt] Transcription error:', (err as Error).message);
    return {
      ok: false,
      message: `Custom STT failed: ${(err as Error).message}`,
      status: 500,
    };
  }
}
