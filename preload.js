const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window
  setWindowPosition: (x, y) => ipcRenderer.send('set-window-position', { x, y }),
  getWindowPosition: () => ipcRenderer.sendSync('get-window-position'),
  setIgnoreMouse: (ignore, opts) => ipcRenderer.send('set-ignore-mouse', ignore, opts),

  // Drag
  startDrag: () => ipcRenderer.send('start-drag'),
  drag: () => ipcRenderer.send('drag'),

  // App
  closeApp: () => ipcRenderer.send('close-app'),

  // Chat history
  loadHistory: () => ipcRenderer.invoke('load-history'),
  saveHistory: (h) => ipcRenderer.invoke('save-history', h),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  // Settings persistence
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  // ElevenLabs TTS
  elevenLabsTTS: (text, voiceId, apiKey) => ipcRenderer.invoke('elevenlabs-tts', text, voiceId, apiKey),

  // Whisper speech-to-text
  transcribeAudio: (audioBuffer) => ipcRenderer.invoke('transcribe-audio', audioBuffer),
  onWhisperStatus: (callback) => {
    ipcRenderer.on('whisper-status', (_event, msg) => callback(msg));
  },

  // Screen capture
  captureScreen: () => ipcRenderer.invoke('capture-screen'),

  // DuckDuckGo Search API
  searchDuckDuckGo: (query) => ipcRenderer.invoke('search-duckduckgo', query),

  // File System reading
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),

  // Keyboard automation / writing
  typeText: (text) => ipcRenderer.invoke('type-text', text),

  // Ollama Vision API (with image)
  chatOllamaVision: async (messages, model, base64Image) => {
    try {
      // Add image to the last user message
      const msgs = messages.map((m, i) => {
        if (i === messages.length - 1 && m.role === 'user') {
          return { ...m, images: [base64Image] };
        }
        return m;
      });
      const res = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: msgs, stream: false })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { ok: true, text: data.message.content };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  // Ollama API with 3 retries and speed optimizations
  chatOllama: async (messages, model = 'llama3.2') => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch('http://localhost:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            options: {
              num_predict: 120, // Keep responses short and fast
              temperature: 0.7,
              num_ctx: 2048     // Optimizes evaluation time
            }
          })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return { ok: true, text: data.message.content };
      } catch (err) {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
        return { ok: false, error: err.message };
      }
    }
  }
});
