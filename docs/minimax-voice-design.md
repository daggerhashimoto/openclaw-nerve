# MiniMax voice design

Set `MINIMAX_API_KEY` in the server environment and restart the server. Send
`POST /api/tts/minimax/voice-design` with a JSON body:

```json
{
  "prompt": "A warm, calm narrator with a clear delivery",
  "preview_text": "Welcome to your daily briefing.",
  "voice_id": "daily_briefing_voice",
  "region": "global_en"
}
```

The description, preview text, and custom voice ID are required. Descriptions
accept up to 5000 characters; preview text accepts up to 500 characters. Region
can be `global_en` (default) or `cn_zh` and must match the API key's account.
The endpoint uses the server's existing authentication and speech rate limit.
When authentication is enabled, include a valid Nerve session cookie.

The JSON response contains `voice_id` and hex-encoded `trial_audio`. This API
creates the voice and preview; it does not change the selected chat voice.
Preview generation incurs MiniMax usage charges. Requests are not retried
automatically. Invalid input returns 400, missing server credentials return 503,
and upstream failures or invalid responses return 502 without upstream details.

See the [MiniMax voice design API](https://platform.minimax.io/docs/api-reference/voice-design-design).
