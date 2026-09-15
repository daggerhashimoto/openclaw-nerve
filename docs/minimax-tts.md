# MiniMax speech synthesis

Set `MINIMAX_API_KEY` in the server environment. Send `POST /api/tts` with
`provider: "minimax"`, `text`, and a MiniMax `voice` ID. Optional `model` selects a
supported speech model; the default is `speech-2.8-hd`.
Use `region: "global_en"` (default) or `region: "cn_zh"` for the corresponding
account region. The endpoint returns MP3 audio and rejects incomplete or invalid
synthesis responses.

See the [MiniMax HTTP speech API](https://platform.minimax.io/docs/api-reference/speech-t2a-http).
