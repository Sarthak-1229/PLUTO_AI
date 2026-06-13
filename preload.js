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
  loadMemory: () => ipcRenderer.invoke('load-memory'),
  saveMemory: (m) => ipcRenderer.invoke('save-memory', m),

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

  // Groq Vision API (with image)
  chatGroqVision: async (messages, model, base64Image, apiKey) => {
    try {
      if (!apiKey) throw new Error('No Groq API key provided');
      
      // Build messages: system stays as-is, user message gets multimodal content
      const msgs = messages.map((m, i) => {
        if (i === messages.length - 1 && m.role === 'user') {
          return { 
            role: 'user', 
            content: [
              { type: 'text', text: m.content },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
            ] 
          };
        }
        return m;
      });

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({ 
          model, 
          messages: msgs, 
          max_tokens: 300,
          temperature: 0.7
        })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
      return { ok: true, text: data.choices[0].message.content };
    } catch (err) {
      console.error('Groq Vision error:', err.message);
      return { ok: false, error: err.message };
    }
  },

  // Groq Chat API with retries
  chatGroq: async (messages, model, apiKey) => {
    if (!apiKey) return { ok: false, error: 'No Groq API key provided' };
    
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: 512,
            temperature: 0.7
          })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
        return { ok: true, text: data.choices[0].message.content };
      } catch (err) {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
        return { ok: false, error: err.message };
      }
    }
  }
});
