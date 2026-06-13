const { app, BrowserWindow, ipcMain, screen, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

// Disable hardware acceleration to resolve transparent window rendering issues on Windows
app.disableHardwareAcceleration();

let mainWindow;
const HISTORY_PATH = path.join(__dirname, 'chat_history.json');
const SETTINGS_PATH = path.join(__dirname, 'pluto_settings.json');

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: scrWidth, height: scrHeight } = primaryDisplay.workAreaSize;
  console.log(`Primary display work area: ${scrWidth}x${scrHeight}`);

  mainWindow = new BrowserWindow({
    width: 450,
    height: 420,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    show: false, // Create hidden, show when ready to prevent flashes
    backgroundColor: '#00000000', // Explicitly transparent background
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  // Center window on creation explicitly
  mainWindow.center();
  const [wx, wy] = mainWindow.getPosition();
  console.log(`Window created and centered at position: x=${wx}, y=${wy}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    console.log('Window shown and focused.');
  });

  // Forward renderer logs to main terminal log
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Log] ${message} (at ${path.basename(sourceId)}:${line})`);
  });

  // Log load failures or finish
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`Page failed to load: ${errorDescription} (code: ${errorCode})`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page finished loading successfully.');
  });

  // Auto-grant microphone permissions
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => {
    const allowed = ['media', 'audioCapture', 'microphone'];
    cb(allowed.includes(perm));
  });
  mainWindow.webContents.session.setPermissionCheckHandler((_wc, perm) => {
    const allowed = ['media', 'audioCapture', 'microphone'];
    return allowed.includes(perm);
  });

  // Open devtools in detached mode to check console/elements
  mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  // Pre-warm whisper model in background
  setTimeout(() => preWarmWhisper(), 3000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Window & Drag IPC ─────────────────────────────────────────────────────
ipcMain.on('set-window-position', (_e, { x, y }) => {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.setPosition(Math.round(x), Math.round(y));
});

ipcMain.on('get-window-position', (event) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition();
    event.returnValue = { x, y };
  } else {
    event.returnValue = { x: 0, y: 0 };
  }
});

ipcMain.on('set-ignore-mouse', (_e, ignore, opts) => {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.setIgnoreMouseEvents(ignore, opts);
});

let dragOff = { x: 0, y: 0 };

ipcMain.on('start-drag', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const c = screen.getCursorScreenPoint();
  const [wx, wy] = mainWindow.getPosition();
  dragOff = { x: c.x - wx, y: c.y - wy };
});

ipcMain.on('drag', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const c = screen.getCursorScreenPoint();
  mainWindow.setPosition(Math.round(c.x - dragOff.x), Math.round(c.y - dragOff.y));
});

ipcMain.on('close-app', () => app.quit());

// ── Chat History IPC ──────────────────────────────────────────────────────
ipcMain.handle('load-history', async () => {
  try {
    if (fs.existsSync(HISTORY_PATH))
      return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
  } catch (e) { /* ignore */ }
  return [];
});

ipcMain.handle('save-history', async (_e, h) => {
  try { fs.writeFileSync(HISTORY_PATH, JSON.stringify(h, null, 2), 'utf-8'); return true; }
  catch (e) { return false; }
});

ipcMain.handle('clear-history', async () => {
  try { if (fs.existsSync(HISTORY_PATH)) fs.unlinkSync(HISTORY_PATH); return true; }
  catch (e) { return false; }
});

// ── Settings Persistence ──────────────────────────────────────────────────
ipcMain.handle('load-settings', async () => {
  try {
    if (fs.existsSync(SETTINGS_PATH))
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch (e) { /* ignore */ }
  return {};
});

ipcMain.handle('save-settings', async (_e, s) => {
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf-8'); return true; }
  catch (e) { return false; }
});

// ── ElevenLabs TTS ────────────────────────────────────────────────────────
ipcMain.handle('elevenlabs-tts', async (_event, text, voiceId, apiKey) => {
  try {
    if (!apiKey) return { ok: false, error: 'No API key' };

    const https = require('https');
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    const body = JSON.stringify({
      text: text.substring(0, 2500),
      model_id: 'eleven_flash_v2_5', // Upgraded to state-of-the-art low latency model
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true
      }
    });

    return new Promise((resolve) => {
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
          'Accept': 'audio/mpeg'
        }
      }, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          if (res.statusCode === 200) {
            const audioBuffer = Buffer.concat(chunks);
            resolve({ ok: true, audio: audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) });
          } else {
            const errBody = Buffer.concat(chunks).toString();
            console.log('ElevenLabs error:', res.statusCode, errBody);
            resolve({ ok: false, error: `HTTP ${res.statusCode}` });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ ok: false, error: err.message });
      });

      req.write(body);
      req.end();
    });

  } catch (err) {
    console.error('ElevenLabs TTS error:', err);
    return { ok: false, error: err.message };
  }
});

// ── Whisper Speech-to-Text ────────────────────────────────────────────────
let transcriber = null;

async function preWarmWhisper() {
  try {
    console.log('Pre-warming Whisper model...');
    const { pipeline } = await import('@huggingface/transformers');
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', { dtype: 'fp32' });
    console.log('Whisper model pre-warmed and ready!');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whisper-status', 'ready');
    }
  } catch (e) {
    console.log('Pre-warm failed (will retry on first use):', e.message);
  }
}

// ── Screen Capture IPC ────────────────────────────────────────────────────
ipcMain.handle('capture-screen', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 } // High-res capture for readable text
    });
    if (sources.length > 0) {
      const dataUrl = sources[0].thumbnail.toDataURL('image/png');
      // Extract base64 part (remove "data:image/png;base64,")
      const base64 = dataUrl.split(',')[1];
      return { ok: true, base64 };
    }
    return { ok: false, error: 'No screen sources found' };
  } catch (err) {
    console.error('Screen capture error:', err);
    return { ok: false, error: err.message };
  }
});

// ── Live Web Search IPC ───────────────────────────────────────────────────
ipcMain.handle('search-duckduckgo', async (_event, query) => {
  return new Promise((resolve) => {
    const https = require('https');
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
      }
    }, (res) => {
      let html = '';
      res.on('data', chunk => html += chunk);
      res.on('end', () => {
        try {
          const results = [];
          const snippets = [];
          const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
          let match;
          while ((match = snippetRegex.exec(html)) !== null) {
            snippets.push(match[1].replace(/<[^>]*>/g, '').trim());
          }

          const titles = [];
          const titleRegex = /<a class="result__url"[^>]*>([\s\S]*?)<\/a>/g;
          while ((match = titleRegex.exec(html)) !== null) {
            titles.push(match[1].replace(/<[^>]*>/g, '').trim());
          }

          for (let i = 0; i < Math.min(5, titles.length, snippets.length); i++) {
            results.push({ title: titles[i], snippet: snippets[i] });
          }

          resolve({ ok: true, results });
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });
  });
});

ipcMain.handle('transcribe-audio', async (_event, pcmData) => {
  try {
    let samples;
    if (pcmData instanceof Float32Array) {
      samples = pcmData;
    } else if (pcmData instanceof ArrayBuffer) {
      samples = new Float32Array(pcmData);
    } else if (pcmData.buffer && pcmData.buffer instanceof ArrayBuffer) {
      samples = new Float32Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 4);
    } else {
      // Fallback for serialized objects
      samples = new Float32Array(Object.values(pcmData));
    }

    console.log('Transcribing raw PCM samples...', samples.length);

    if (samples.length < 1600) {
      return { ok: false, error: 'Audio too short' };
    }

    // Lazy-load the transcriber (ESM dynamic import)
    if (!transcriber) {
      console.log('Loading Whisper model (first time, please wait)...');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('whisper-status', 'Loading Whisper AI model (first time ~30s)...');
      }
      const { pipeline } = await import('@huggingface/transformers');
      transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        dtype: 'fp32',
      });
      console.log('Whisper model loaded!');
    }

    // Transcribe
    const result = await transcriber(samples);
    console.log('Transcription:', result.text);
    return { ok: true, text: result.text.trim() };

  } catch (err) {
    console.error('Transcription error:', err);
    return { ok: false, error: err.message };
  }
});

// ── Writing Automation IPC ────────────────────────────────────────────────
ipcMain.handle('type-text', async (_event, text) => {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    // Escape special characters for SendKeys: +, ^, %, ~, (, ), {, }
    const escaped = text.replace(/([+^%~(){}[\]])/g, '{$1}')
                        .replace(/\n/g, '{ENTER}');

    const psScript = `[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}');`;

    exec(`powershell -Command "${psScript}"`, (error) => {
      if (error) {
        console.error('Type text error:', error);
        resolve({ ok: false, error: error.message });
      } else {
        resolve({ ok: true });
      }
    });
  });
});

// ── File Reading IPC ──────────────────────────────────────────────────────
ipcMain.handle('read-file', async (_event, filePath) => {
  try {
    const fs = require('fs');
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.size > 1024 * 1024) { // 1MB limit
        return { ok: false, error: 'File is too large (max 1MB)' };
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      return { ok: true, content };
    }
    return { ok: false, error: 'File not found' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

