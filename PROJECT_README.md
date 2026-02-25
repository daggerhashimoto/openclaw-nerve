# Arda's Nerve Fork

**Repository:** https://github.com/arda-aciksoz/openclaw-nerve  
**Location:** `/root/.openclaw/workspace/projects/nerve-fork/`  
**Status:** ✅ Running on port 3080

## Quick Start

**Access Nerve:**
- URL: http://76.13.130.117:3080
- Gateway: http://127.0.0.1:18789
- Token: Admin135

**Restart Nerve:**
```bash
cd /root/.openclaw/workspace/projects/nerve-fork
pkill -f "node.*nerve-fork.*server-dist"
node server-dist/index.js > /tmp/nerve-fork.log 2>&1 &
```

**View logs:**
```bash
tail -f /tmp/nerve-fork.log
```

## Development Workflow

### 1. Make Changes
Edit files in `/root/.openclaw/workspace/projects/nerve-fork/`

### 2. Build
```bash
cd /root/.openclaw/workspace/projects/nerve-fork
npm run build          # Frontend
npm run build:server   # Backend
```

### 3. Test
Restart Nerve and test at http://76.13.130.117:3080

### 4. Commit & Push
```bash
cd /root/.openclaw/workspace/projects/nerve-fork
git add .
git commit -m "feat: your change description"
git push origin master  # Pushes to arda-aciksoz/openclaw-nerve
```

## Git Remotes

- **origin** → `https://github.com/arda-aciksoz/openclaw-nerve.git` (your fork)
- **upstream** → `https://github.com/daggerhashimoto/openclaw-nerve.git` (original)

**Pull latest from upstream:**
```bash
git fetch upstream
git merge upstream/master
```

## Planned Features

### Deepgram Integration
- [ ] Add Deepgram STT service (`server/services/deepgram-stt.ts`)
- [ ] Add Deepgram TTS service (`server/services/deepgram-tts.ts`)
- [ ] Update `.env` to support `STT_PROVIDER=deepgram`
- [ ] Update TTS routes to support Deepgram
- [ ] Add Deepgram config to settings UI

## Configuration

**.env location:** `/root/.openclaw/workspace/projects/nerve-fork/.env`

**Current settings:**
- PORT: 3080
- HOST: 0.0.0.0 (network access)
- GATEWAY_URL: http://127.0.0.1:18789
- GATEWAY_TOKEN: Admin135
- AGENT_NAME: Kora
- NERVE_AUTH: true (authentication enabled)

## Notes

- Credentials managed via `/root/.openclaw/workspace/.agent-credentials/`
- GitHub auth uses `korathemaiden` account token
- Always rebuild after code changes
- Keep original openclaw-nerve for reference at `/root/.openclaw/workspace/projects/openclaw-nerve/`
