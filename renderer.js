// ═══════════════════════════════════════════════════════════════════════════
// renderer.js — Pluto AI Study Companion v3.0
// Command detection, Ollama helpers, continuous voice, mood TTS, persistence
// ═══════════════════════════════════════════════════════════════════════════

const api = window.electronAPI;
const $ = id => document.getElementById(id);

// ── State ────────────────────────────────────────────────────────────────
let hunger = 7, happiness = 8, energy = 6;
let isSleeping = false, isDragging = false;
let isListening = false, isSpeaking = false, isThinking = false;
let voiceEnabled = true, volume = 0.9;
let groqKey = '';
let elevenLabsKey = '', elevenLabsVoice = '21m00Tcm4TlvDq8ikWAM';
let chatHistory = [];
let statusTimer = null;
let shouldKeepListening = false;
let currentAudio = null;

const SYS_PROMPT = `You are Pluto, a sleek, cute desktop AI assistant like Jarvis. Be smart, conversational, and helpful. Call the user 'buddy'. Talk directly and naturally, like a voice assistant (ChatGPT Live/Gemini Live). DO NOT use headers, bullet points, asterisks for actions, or emoji icons. Your answers MUST be extremely short and precise (1 sentence, maximum 20 words). Speak directly to what is asked without any fluff. NEVER say you are an AI or have a knowledge cutoff; you have live internet access and know everything happening right now.`;

// ── DOM ──────────────────────────────────────────────────────────────────
const petZone   = $('pet-zone');
const avatar    = $('pluto-avatar');
const msgArea   = $('msg-area');
const msgText   = $('msg-text');
const msgLabel  = $('msg-label');
const ctxMenu   = $('ctx-menu');
const settings  = $('settings-panel');
const chatBox   = $('chat-box');
const chatIn    = $('chat-in');
const statusBub = $('status-bubble');
const viDot     = $('vi-dot');

// ── Mouse passthrough ───────────────────────────────────────────────────
api.setIgnoreMouse(true, { forward: true });
document.querySelectorAll('.interactive').forEach(el => {
  el.addEventListener('mouseenter', () => api.setIgnoreMouse(false));
  el.addEventListener('mouseleave', () => api.setIgnoreMouse(true, { forward: true }));
});

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  const saved = await api.loadHistory();
  if (saved && saved.length) chatHistory = saved;

  // Load saved settings
  const s = await api.loadSettings();
  if (s.elevenLabsKey) { elevenLabsKey = s.elevenLabsKey; $('opt-el-key').value = s.elevenLabsKey; }
  if (s.elevenLabsVoice) { elevenLabsVoice = s.elevenLabsVoice; $('opt-el-voice').value = s.elevenLabsVoice; }
  if (s.groqKey) { groqKey = s.groqKey; $('opt-groq-key').value = s.groqKey; }
  if (s.voiceEnabled !== undefined) { voiceEnabled = s.voiceEnabled; $('opt-voice').checked = s.voiceEnabled; }
  if (s.volume !== undefined) { volume = s.volume; $('opt-vol').value = Math.round(s.volume * 100); }

  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  setInterval(decayStats, 60000);
  setInterval(randomChatter, 50000);
  updateStats();
  updateAnim();

  // Listen for whisper ready
  api.onWhisperStatus((msg) => {
    if (msg === 'ready') {
      showStatus('✅ Voice ready!', 'st-listen');
      setTimeout(hideStatus, 2000);
    } else {
      showStatus(`🧠 ${msg}`, 'st-think');
    }
  });
});

// ── Close overlays ──────────────────────────────────────────────────────
window.addEventListener('mousedown', e => {
  if (!ctxMenu.contains(e.target))  ctxMenu.style.display = 'none';
  if (!settings.contains(e.target)) settings.classList.remove('visible');
  if (!chatBox.contains(e.target) && !petZone.contains(e.target)) chatBox.classList.remove('visible');
});

// ═══════════════════════════════════════════════════════════════════════════
// DRAGGING
// ═══════════════════════════════════════════════════════════════════════════
let dsx = 0, dsy = 0;
petZone.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  isDragging = true; dsx = e.screenX; dsy = e.screenY;
  petZone.classList.remove('anim-idle','anim-bounce','anim-sleep');
  api.startDrag();
  if (isSleeping) { toggleSleep(); showMsg("*yawwwn* Pluto woke up!"); }
});
window.addEventListener('mousemove', e => { if (isDragging) api.drag(); });
window.addEventListener('mouseup', e => {
  if (!isDragging) return;
  isDragging = false; updateAnim();
  if (Math.hypot(e.screenX - dsx, e.screenY - dsy) < 5) handleClick();
});

// ═══════════════════════════════════════════════════════════════════════════
// CLICKS
// ═══════════════════════════════════════════════════════════════════════════
petZone.addEventListener('dblclick', e => { e.stopPropagation(); startVoice(); });
petZone.addEventListener('contextmenu', e => {
  e.preventDefault();
  ctxMenu.style.left = `${e.clientX}px`;
  ctxMenu.style.top  = `${e.clientY}px`;
  ctxMenu.style.display = 'block';
});

function handleClick() {
  // Toggle message area visibility
  if (msgArea.classList.contains('visible')) {
    msgArea.classList.remove('visible');
  } else {
    triggerFeed();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT MENU
// ═══════════════════════════════════════════════════════════════════════════
ctxMenu.addEventListener('click', e => {
  const item = e.target.closest('.ctx-item');
  if (!item) return;
  ctxMenu.style.display = 'none';
  const a = item.dataset.a;
  if (a === 'feed')     triggerFeed();
  if (a === 'play')     triggerPlay();
  if (a === 'sleep')    toggleSleep();
  if (a === 'voice')    startVoice();
  if (a === 'text')     openTextChat();
  if (a === 'settings') openSettings();
  if (a === 'close')    api.closeApp();
});

// ═══════════════════════════════════════════════════════════════════════════
// PET ACTIONS
// ═══════════════════════════════════════════════════════════════════════════
function triggerFeed() {
  if (isSleeping) toggleSleep();
  hunger = Math.min(10, hunger + 3);
  happiness = Math.min(10, happiness + 1);
  updateStats(); updateAnim();
  playJump(); spawnParticles(); spawnSparkles();
  const lines = [
    "NOM NOM! Pluto's fuel cells are charged! 🍕",
    "Yum! Cyber snacks are the best, buddy! ⚡",
    "Pluto is powered up and ready to help! 🔋",
    "Delicious data bytes! Thanks, friend! 💎",
  ];
  showMsg(lines[~~(Math.random()*lines.length)]);
}

function triggerPlay() {
  if (isSleeping) toggleSleep();
  if (energy < 2) { showMsg("Pluto is too tired to play... need recharge, buddy! 😵"); return; }
  happiness = Math.min(10, happiness + 2);
  energy = Math.max(1, energy - 1);
  hunger = Math.max(1, hunger - 1);
  updateStats(); updateAnim(); playJump();
  // Walk wiggle animation
  let wFrame = 0;
  const walkAnim = setInterval(() => {
    avatar.src = wFrame % 2 === 0 ? 'assets/pluto-walk.png' : 'assets/pluto-walk2.png';
    wFrame++;
  }, 250);
  setTimeout(() => { clearInterval(walkAnim); updateSprite(); }, 2000);
  const lines = [
    "Woohoo! Pluto is ZOOMING, buddy! 🚀",
    "Wheee! Cyber boost activated! ⚡",
    "Pluto goes BRRR! That was fun, friend! 🌟",
  ];
  showMsg(lines[~~(Math.random()*lines.length)]);
}

function toggleSleep() {
  isSleeping = !isSleeping;
  const btn = document.querySelector('[data-a="sleep"]');
  if (isSleeping) {
    if (btn) btn.textContent = '☀️ Wake Up';
    avatar.src = 'assets/pluto-sleep.png';
    stopBlink();
    if (isListening) stopListening();
    showMsg("Good night.");
  } else {
    if (btn) btn.textContent = '😴 Sleep';
    avatar.src = 'assets/pluto-idle.png';
    energy = Math.min(10, energy + 2);
    showMsg("I'm awake!");
  }
  updateStats(); updateAnim();
}

// ═══════════════════════════════════════════════════════════════════════════
// ANIMATION STATE MACHINE
// ═══════════════════════════════════════════════════════════════════════════
// Blink animation timer
let blinkTimer = null;
function startBlink() {
  stopBlink();
  blinkTimer = setInterval(() => {
    if (isSleeping || isSpeaking) return;
    avatar.src = 'assets/pluto-blink.png';
    setTimeout(() => {
      if (!isSleeping) updateSprite();
    }, 200);
  }, 3000 + Math.random() * 2000);
}
function stopBlink() {
  if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
}

function updateSprite() {
  if (isSleeping) { avatar.src = 'assets/pluto-sleep.png'; return; }
  if (hunger < 3)         avatar.src = 'assets/pluto-sad.png';
  else if (energy < 3)    avatar.src = 'assets/pluto-sleep.png';
  else if (happiness > 8) avatar.src = 'assets/pluto-happy.png';
  else                    avatar.src = 'assets/pluto-idle.png';
}

function updateAnim() {
  petZone.classList.remove('anim-idle','anim-bounce','anim-sleep','anim-jump');
  if (isSleeping || energy < 3)         { petZone.classList.add('anim-sleep'); stopBlink(); }
  else if (happiness > 8 && energy > 5) { petZone.classList.add('anim-bounce'); startBlink(); }
  else                                   { petZone.classList.add('anim-idle'); startBlink(); }

  // Update avatar sprite based on mood
  updateSprite();
}

function playJump() {
  petZone.classList.remove('anim-idle','anim-bounce','anim-sleep');
  petZone.classList.add('anim-jump');
  setTimeout(() => { petZone.classList.remove('anim-jump'); updateAnim(); }, 800);
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════
function savePlutoSettings() {
  api.saveSettings({
    elevenLabsKey,
    elevenLabsVoice,
    groqKey,
    voiceEnabled,
    volume
  });
}

function openSettings() {
  settings.classList.add('visible');
  chatBox.classList.remove('visible');
}

$('opt-close').onclick = () => {
  settings.classList.remove('visible');
  savePlutoSettings();
};

$('opt-voice').onchange = function() {
  voiceEnabled = this.checked;
  savePlutoSettings();
};

$('opt-vol').oninput = function() {
  volume = this.value / 100;
};
$('opt-vol').onchange = function() {
  savePlutoSettings();
};

$('opt-el-key').onchange = function() {
  elevenLabsKey = this.value.trim();
  savePlutoSettings();
};

$('opt-el-voice').onchange = function() {
  elevenLabsVoice = this.value;
  savePlutoSettings();
};

$('opt-groq-key').onchange = function() {
  groqKey = this.value.trim();
  showMsg("Groq API Key saved! Pluto's brain is supercharged! 🧠⚡");
  savePlutoSettings();
};
$('opt-clear').onclick = async () => {
  await api.clearHistory(); chatHistory = [];
  showMsg("Memory wiped! Pluto has a fresh brain, buddy! 🐾");
};
$('opt-reset').onclick = () => {
  hunger = 7; happiness = 8; energy = 6;
  updateStats(); updateAnim();
  showMsg("Stats recalibrated! ⚡");
  settings.classList.remove('visible');
};

// ═══════════════════════════════════════════════════════════════════════════
// TEXT CHAT
// ═══════════════════════════════════════════════════════════════════════════
function openTextChat() {
  settings.classList.remove('visible');
  chatBox.classList.add('visible');
  chatIn.focus();
}

$('chat-form').onsubmit = async e => {
  e.preventDefault();
  const txt = chatIn.value.trim();
  chatIn.value = '';
  chatBox.classList.remove('visible');
  if (!txt) return;
  if (isSleeping) toggleSleep();
  await processInput(txt);
};

// ═══════════════════════════════════════════════════════════════════════════
// VOICE RECORDING — MediaRecorder + Whisper (local, offline)
// ═══════════════════════════════════════════════════════════════════════════
let mediaStream = null;
let mediaRecorder = null;
let audioChunks = [];
let silenceTimer = null;
let analyserCtx = null;
let analyser = null;
let silenceStart = 0;
let speechDetected = false;
const SILENCE_THRESHOLD = 0.01;
const SILENCE_DURATION = 1500; // 1.5 seconds of silence = end of speech (faster!)



async function startVoice() {
  if (isSleeping) toggleSleep();
  settings.classList.remove('visible');
  chatBox.classList.remove('visible');

  // Toggle off if already listening
  if (isListening) {
    stopListening();
    showMsg("Pluto stopped listening! 👋");
    return;
  }

  if (isSpeaking) {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (currentAudio) {
      try { currentAudio.pause(); currentAudio.src = ''; } catch(e){}
      currentAudio = null;
    }
    isSpeaking = false;
    petZone.classList.remove('is-speaking');
  }

  shouldKeepListening = true;
  showMsg("Pluto is listening! Speak now, buddy! 🎙️ (Say 'stop' or click again to end)");
  await startRecording();
}

async function startRecording() {
  try {
    // Get microphone access
    if (!mediaStream) {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
    }

    audioChunks = [];

    // Set up audio analysis for silence detection
    if (!analyserCtx) analyserCtx = new AudioContext({ sampleRate: 16000 });
    const source = analyserCtx.createMediaStreamSource(mediaStream);
    analyser = analyserCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    // Start recording
    mediaRecorder = new MediaRecorder(mediaStream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm'
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      if (audioChunks.length === 0) return;
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      audioChunks = [];

      if (!speechDetected) {
        // Restart silently if no speech was detected (prevents hallucination loops)
        if (shouldKeepListening) setTimeout(() => startRecording(), 100);
        return;
      }

      if (audioBlob.size < 1000) {
        showStatus("🎙️ Too short — say more, buddy!", 'st-listen');
        if (shouldKeepListening) setTimeout(() => startRecording(), 500);
        return;
      }

      // Convert to WAV and transcribe
      await transcribeRecording(audioBlob);
    };

    mediaRecorder.start(250); // Collect data every 250ms

    isListening = true;
    petZone.classList.add('is-listening');
    viDot.className = 'vi-listen';
    showStatus('🎙️ Listening...', 'st-listen');
    silenceStart = 0;
    speechDetected = false;

    // Start silence detection loop
    detectSilence();

  } catch (err) {
    console.error('Microphone error:', err);
    showMsg(`❌ Can't access microphone: ${err.message}. Check your mic permissions!`);
    showStatus('❌ Mic error!', 'st-error');
    setTimeout(hideStatus, 4000);
    stopListening();
  }
}

function detectSilence() {
  if (!isListening || !analyser) return;

  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);

  // Calculate RMS volume
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / data.length);

  if (rms > SILENCE_THRESHOLD) {
    speechDetected = true;
    silenceStart = 0; // Reset on speech
  } else {
    if (silenceStart === 0) silenceStart = Date.now();
    else if (Date.now() - silenceStart > SILENCE_DURATION) {
      if (speechDetected) {
        // Silence detected after speech — stop recording and transcribe
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          showStatus('🎙️ Processing...', 'st-think');
          mediaRecorder.stop();
          isListening = false;
          petZone.classList.remove('is-listening');
        }
        return;
      } else if (Date.now() - silenceStart > 10000) {
        // 10 seconds of silence without any speech -> abort and restart to prevent OOM
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
          isListening = false;
          petZone.classList.remove('is-listening');
        }
        return;
      }
    }
  }

  requestAnimationFrame(detectSilence);
}

async function transcribeRecording(audioBlob) {
  try {
    viDot.className = 'vi-think';
    showStatus('🧠 Transcribing...', 'st-think');
    showMsgTyping("Pluto is decoding your voice... 🎧");

    // Convert webm to raw PCM using Web Audio API
    const arrayBuffer = await audioBlob.arrayBuffer();
    if (!analyserCtx) analyserCtx = new AudioContext({ sampleRate: 16000 });
    const audioBuffer = await analyserCtx.decodeAudioData(arrayBuffer);
    const pcmData = audioBuffer.getChannelData(0);

    // Send the raw Float32Array PCM data directly
    const result = await api.transcribeAudio(pcmData);

    if (!result.ok) {
      console.error('Transcription failed:', result.error);
      showMsg(`❌ Pluto couldn't understand that: ${result.error}`);
      showStatus('❌ Transcription failed', 'st-error');
      setTimeout(hideStatus, 3000);
      if (shouldKeepListening) setTimeout(() => startRecording(), 1000);
      return;
    }

    const text = result.text.trim();
    console.log('Transcribed:', text);

    const lower = text.toLowerCase().replace(/[^a-z\s]/g, '').trim();
    const hallucinations = ['thank you', 'thanks for watching', 'thank you for watching', 'please subscribe', 'subscribe', 'you', 'amem', 'amen', 'bye', 'the end'];

    if (!text || text.length < 2 || hallucinations.includes(lower)) {
      showStatus("🎙️ Pluto didn't catch that — try again!", 'st-listen');
      if (shouldKeepListening) setTimeout(() => startRecording(), 500);
      return;
    }

    // Check for stop commands
    if (text.toLowerCase().match(/\b(stop|stop listening|quiet|bye)\b/)) {
      showMsg("Pluto stopped listening! Talk later, buddy! 👋");
      stopListening();
      return;
    }

    showStatus(`🎙️ "${text}"`, 'st-listen');
    await processInput(text);

    // Resume listening after processing
    if (shouldKeepListening && !isSpeaking) {
      setTimeout(() => {
        if (shouldKeepListening && !isSpeaking) startRecording();
      }, 800);
    }

  } catch (err) {
    console.error('Transcription error:', err);
    showMsg(`❌ Voice processing error: ${err.message}`);
    if (shouldKeepListening) setTimeout(() => startRecording(), 1000);
  }
}

function stopListening() {
  shouldKeepListening = false;
  isListening = false;
  petZone.classList.remove('is-listening');
  viDot.className = '';
  hideStatus();

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    try { mediaRecorder.stop(); } catch(e) {}
  }
  mediaRecorder = null;
  audioChunks = [];

  // Don't close mediaStream — reuse it for next voice session
}

function resumeListening() {
  if (shouldKeepListening) {
    setTimeout(() => {
      if (shouldKeepListening && !isSpeaking) {
        startRecording();
      }
    }, 700);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND DETECTION + ROUTING
// ═══════════════════════════════════════════════════════════════════════════
async function processInput(text) {
  if (!text) return;

  // Ignore input if we are already thinking to prevent overlapping queries
  if (isThinking) {
    console.log('Query ignored: Pluto is already thinking.');
    return;
  }

  // Cancel any active voice speech if a new query starts
  if (isSpeaking) {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (currentAudio) {
      try { currentAudio.pause(); currentAudio.src = ''; } catch(e){}
      currentAudio = null;
    }
    isSpeaking = false;
    petZone.classList.remove('is-speaking');
  }

  chatHistory.push({ role: 'user', content: text });

  if (chatHistory.length > 10) chatHistory = chatHistory.slice(-10);
  api.saveHistory(chatHistory);

  isThinking = true;
  viDot.className = 'vi-think';
  playBeep();

  const t = text.toLowerCase();
  let result;

  // ── Hard-wired commands (these bypass the LLM router) ────────────────
  // TYPE / WRITE command
  if (t.match(/\b(type|insert|keyboard)\b/) && t.match(/\b(into|in my|on my|field|document|window)\b/)) {
    showStatus('✍️ Pluto is typing...', 'st-think');
    showMsgTyping("Pluto is typing into your active window... ⌨️");
    result = await handleTypeCommand(text);
  }
  // FILE READING command
  else if (t.match(/\b(read file|open file|summarize file|explain file)\b/)) {
    showStatus('📖 Reading file...', 'st-think');
    showMsgTyping("Pluto is reading local file... 📂");
    result = await handleReadFileCommand(text);
  }
  // SCREEN LOOK command
  else if (t.match(/\b(look at|screen|what's on|what do you see|read my|check my|look at my|show me what|what am i doing)\b/)) {
    showStatus('👁️ Scanning your screen...', 'st-think');
    showMsgTyping('Analyzing screen... 👁️');
    result = await lookAtScreen(text);
  }
  // STUDY TIPS (static, no API call needed)
  else if (t.match(/\b(study tips?|how to study|study plan|revision tips?)\b/)) {
    const subj = text.replace(/\b(study tips?|how to study|study plan|give me|for|revision tips?|review)\b/gi, '').trim() || 'general';
    result = getStudyTips(subj);
    isThinking = false; viDot.className = '';
    showMsg(result);
    happiness = Math.min(10, happiness + 0.5);
    updateStats();
    if (voiceEnabled) speakText(result);
    else resumeListening();
    return;
  }
  // ── Smart 3-way LLM Router ───────────────────────────────────────────
  // For everything else, use the fast 8b model to classify the query
  else {
    showStatus('💭 Pluto is analyzing query...', 'st-think');
    showMsgTyping("Pluto is thinking... 💭");

    const routerPrompt = `Classify this user message into exactly one category. Output ONLY the category word, nothing else.

Categories:
- SEARCH: Questions about current events, news, weather, stock prices, sports scores, real-time data, recent happenings, specific facts, people, places, dates, or anything that needs up-to-date information.
- CODE: Programming, debugging, code help, math problems, calculations, algorithms, technical explanations, essay writing, or any complex analytical task.
- CHAT: Greetings, casual conversation, jokes, personal questions, opinions, emotional support, or general chit-chat.

User message: "${text}"

Output ONLY one word: SEARCH, CODE, or CHAT.`;

    const msgs = [
      { role: 'system', content: 'You are a strict classifier. Output exactly one word: SEARCH, CODE, or CHAT.' },
      { role: 'user', content: routerPrompt }
    ];
    
    let route = 'CHAT'; // default fallback
    try {
      const routerRes = await api.chatGroq(msgs, 'llama-3.1-8b-instant', groqKey);
      if (routerRes && routerRes.ok) {
        const decision = routerRes.text.trim().toUpperCase();
        if (decision.includes('SEARCH')) route = 'SEARCH';
        else if (decision.includes('CODE')) route = 'CODE';
        else route = 'CHAT';
      }
    } catch (e) {
      console.error('Router failed, defaulting to CHAT:', e);
    }

    console.log(`[Router] "${text}" → ${route}`);

    if (route === 'SEARCH') {
      showStatus('🔍 Pluto is searching the web...', 'st-think');
      showMsgTyping(`Pluto is searching the live web... 🔍`);
      result = await searchWeb(text);
    } else if (route === 'CODE') {
      showStatus('💻 Pluto is analyzing...', 'st-think');
      showMsgTyping("Pluto is working on it... 🧠");
      result = await callGroq(
        `You are Pluto, a brilliant coding and study assistant. Answer the user's question directly and precisely. Keep your response under 3 sentences. Be conversational and call the user 'buddy'.`,
        text,
        'meta-llama/llama-4-scout-17b-16e-instruct'
      );
    } else {
      result = await normalChat(text);
    }
  }

  isThinking = false;

  if (result) {
    chatHistory.push({ role: 'assistant', content: result });
    api.saveHistory(chatHistory);
    happiness = Math.min(10, happiness + 0.5);
    updateStats(); updateAnim();
    showMsg(result);
    if (voiceEnabled) speakText(result);
    else { viDot.className = ''; hideStatus(); resumeListening(); }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS (Groq-backed)
// ═══════════════════════════════════════════════════════════════════════════
async function solveMath(problem) {
  try {
    const capture = await api.captureScreen();
    if (capture.ok && capture.base64) {
      const msgs = [
        { role: 'system', content: 'You are Pluto. The user needs help solving a math problem. A screenshot of their screen is provided, which contains the problem. Solve it and state the final answer clearly and directly in one short sentence (under 15 words). Do not use markdown headers, asterisks, or extra commentary.' },
        { role: 'user', content: `Solve this math problem: ${problem}` }
      ];
      const r = await api.chatGroqVision(msgs, 'meta-llama/llama-4-scout-17b-16e-instruct', capture.base64, groqKey);
      if (r.ok) return r.text.trim();
    }
  } catch (e) { console.log("Vision math failed, falling back to text", e); }

  const r = await callGroq(
    `Solve this math problem. State the final answer clearly and directly in one short sentence (under 15 words). Problem: ${problem}`,
    problem,
    'meta-llama/llama-4-scout-17b-16e-instruct'
  );
  return r;
}

async function explainConcept(topic) {
  const r = await callGroq(
    `Explain this concept in one short sentence (under 20 words). Topic: ${topic}`,
    topic,
    'meta-llama/llama-4-scout-17b-16e-instruct'
  );
  return r;
}

async function helpWithCode(codeProblem) {
  const r = await callGroq(
    `Explain how to fix this code bug in one short sentence (under 20 words). Problem: ${codeProblem}`,
    codeProblem,
    'meta-llama/llama-4-scout-17b-16e-instruct'
  );
  return r;
}

async function essayOutline(topic) {
  const r = await callGroq(
    `Give a 3-bullet point outline for this topic. Keep each bullet under 5 words. Topic: ${topic}`,
    topic,
    'meta-llama/llama-4-scout-17b-16e-instruct'
  );
  return r;
}

async function handleTypeCommand(userQuery) {
  // Matches text inside quotes like "type 'hello world'" or after a colon like "type: hello"
  const directMatch = userQuery.match(/\b(?:type|write|insert)\s+['"“](.*?)['"”]/i) || 
                      userQuery.match(/\b(?:type|write|insert)\s*:\s*(.*)/i);
  
  let textToType = '';
  if (directMatch) {
    textToType = directMatch[1].trim();
  } else {
    // Generate text via LLM
    const cleanedPrompt = userQuery.replace(/\b(type|write|insert|keyboard|for me|on my screen)\b/gi, '').trim();
    showMsgTyping("Pluto is drafting the text... ✍️");
    const generated = await callGroq(
      `You are writing text that will be typed directly into the user's active document or text field. Generate the text based on this request: "${cleanedPrompt}". Do not include any headers, descriptions, quotes, or conversational phrases. ONLY write the exact text to type.`,
      cleanedPrompt,
      'meta-llama/llama-4-scout-17b-16e-instruct'
    );
    if (generated) textToType = generated.trim();
  }

  if (!textToType) {
    return "❌ I couldn't find any text to type, buddy!";
  }

  // Warn the user to position their cursor
  showMsg("Typing in 3 seconds... Click inside your text area, buddy!");
  if (voiceEnabled) speakText("Click inside your text area now! I will type in 3 seconds.");
  
  // Wait 3 seconds
  await new Promise(resolve => setTimeout(resolve, 3000));

  showStatus('✍️ Typing...', 'st-think');
  const typeRes = await api.typeText(textToType);
  if (typeRes.ok) {
    return `Typed: "${textToType.substring(0, 30)}..."! Done, buddy!`;
  } else {
    return `❌ Typing failed: ${typeRes.error}`;
  }
}

async function handleReadFileCommand(userQuery) {
  // Extract path (e.g. read file C:\test.txt)
  const pathMatch = userQuery.match(/(?:read|open|summarize|explain)\s+file\s*[:\s]\s*['"“]?(.*?)['"”]?$/i) ||
                    userQuery.match(/(?:read|open|summarize|explain)\s+['"“]?(c:\\[^\s'"]+)['"”]?/i);
                    
  if (!pathMatch) {
    return "❌ Please specify a valid file path, buddy! E.g. 'read file C:\\path\\to\\file.txt'";
  }

  const filePath = pathMatch[1].trim();
  showMsgTyping(`Pluto is opening: ${filePath}... 📂`);

  const fileRes = await api.readFile(filePath);
  if (!fileRes.ok) {
    return `❌ Could not read file: ${fileRes.error}`;
  }

  showMsgTyping("Pluto is reading and analyzing... 🧠");
  const cleanedPrompt = userQuery.replace(pathMatch[0], '').trim();
  const instruction = cleanedPrompt || "Summarize the key contents of this file.";

  const r = await callGroq(
    `You are analyzing a local file's content. Read it carefully and answer the user's instruction: "${instruction}".\n` +
    `File Contents:\n${fileRes.content}\n\n` +
    `Keep your response short, direct, and conversational (max 2 sentences, under 30 words).`,
    filePath,
    'meta-llama/llama-4-scout-17b-16e-instruct'
  );

  return r;
}


function getStudyTips(subject) {
  return `📖 STUDY TIPS FOR: ${subject.toUpperCase()}\n\n` +
    `1. 📦 Break into small chunks — don't cram everything at once\n` +
    `2. 🧠 Use active recall — test yourself instead of re-reading\n` +
    `3. 🃏 Make flashcards for key concepts and terms\n` +
    `4. 📅 Practice daily — consistency beats intensity\n` +
    `5. ❌ Review your mistakes — they're your best teachers\n` +
    `6. ⏱️ 30 min study + 5 min break cycles (Pomodoro)\n` +
    `7. 📊 Use diagrams and mind maps to visualize\n` +
    `8. 🗣️ Explain it to someone else (or to Pluto!)\n\n` +
    `⚡ Pluto says: You'll crush this, buddy! I believe in you! 🚀`;
}

async function searchWeb(query) {
  // Use the full query for search — don't strip critical words
  const searchQuery = query.replace(/\b(search|google|look up|find|for me|please|hey pluto|pluto)\b/gi, '').trim() || query;
  showMsgTyping(`Pluto is searching the live web for "${searchQuery}"... 🔍`);

  try {
    const searchRes = await api.searchDuckDuckGo(searchQuery);
    if (searchRes.ok && searchRes.results.length > 0) {
      const webData = searchRes.results.map((r, i) => `${i+1}. ${r.title}\n   ${r.snippet}`).join('\n');
      
      const systemPrompt = `You are Pluto, a smart AI assistant with live internet access. The user asked: "${query}"

Here are LIVE web search results from right now:
${webData}

INSTRUCTIONS:
- Answer the user's question using ONLY the search results above.
- Be direct, factual, and conversational. Call the user 'buddy'.
- Keep it short (1-3 sentences, under 50 words).
- NEVER say you don't have access to real-time data. You DO.`;
        
      const msgs = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query }
      ];
      const r = await api.chatGroq(msgs, 'openai/gpt-oss-120b', groqKey);
      if (r.ok) return r.text.trim();
    }
  } catch (err) {
    console.error('DuckDuckGo search error:', err);
  }

  // Fallback if search fails
  const msgsFallback = [
    { role: 'system', content: `You are Pluto. The user asked: "${query}". The web search failed. Answer with what you know, but keep it short (under 50 words). Be honest if you're unsure. Call the user 'buddy'.` },
    { role: 'user', content: query }
  ];
  const rFallback = await api.chatGroq(msgsFallback, 'openai/gpt-oss-120b', groqKey);
  if (rFallback.ok) return rFallback.text.trim();
  showGroqError();
  return null;
}

async function normalChat(text) {
  const mood = getMoodLine();
  const msgs = [
    { role: 'system', content: SYS_PROMPT + `\n\nCurrent stats: Hunger=${~~hunger}/10, Happiness=${~~happiness}/10, Energy=${~~energy}/10. ${mood} Keep this response to exactly 1 short sentence (under 20 words).` },
    ...chatHistory.slice(-10)
  ];
  const r = await api.chatGroq(msgs, 'llama-3.1-8b-instant', groqKey);
  if (r.ok) return r.text.trim();
  showGroqError();
  return null;
}

async function callGroq(systemPrompt, userContent, model = 'llama-3.1-8b-instant') {
  const msgs = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ];
  const r = await api.chatGroq(msgs, model, groqKey);
  if (r.ok) return r.text.trim();
  showGroqError();
  return null;
}

function showGroqError() {
  isThinking = false; viDot.className = '';
  const errs = [
    "Pluto's brain is confused! Check your Groq API key! 🔑",
    "API Error! Please open settings and add your Groq key. 🧠",
    "Connection to Groq failed! Are we online? 🌐",
  ];
  showMsg(`❌ ${errs[~~(Math.random()*errs.length)]}`);
  showStatus('❌ API Error!', 'st-error');
  setTimeout(hideStatus, 4000);
  resumeListening();
}

function getMoodLine() {
  if (hunger < 3 && energy < 3) return "You are VERY hungry AND tired — mention it!";
  if (hunger < 3) return "You are hungry and want snacks — mention it playfully!";
  if (energy < 3) return "You are very tired and sluggish.";
  if (happiness > 8) return "You are SUPER excited and bouncy!";
  if (happiness < 3) return "You are feeling a bit down.";
  return "You feel good and ready to help.";
}

// ═══════════════════════════════════════════════════════════════════════════
// SPEECH SYNTHESIS — ElevenLabs with browser TTS fallback
// ═══════════════════════════════════════════════════════════════════════════
function cleanTextForSpeech(text) {
  let clean = text;

  // 1. Remove common visual titles/headers at start (e.g. "🧮 MATH SOLUTION", "📚 EXPLANATION")
  clean = clean.replace(/^[^\w]*[A-Z\s]{4,}[^\w]*(\n+)?/g, '');
  
  // 2. Remove footer notes like "✅ Pluto solved it!..." or "💡 Got it..."
  clean = clean.replace(/(\n+)?(✅|💡|🚀|🌟|⚡|🐾|🛸|🛡️)\s+.*$/g, '');

  // 3. Remove asterisks action commentary like *giggles*, *smiles*, *sighs*
  clean = clean.replace(/\*.*?\*/g, '');

  // 4. Remove all emojis/symbols
  clean = clean.replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
               .replace(/[\u{2700}-\u{27BF}]/gu, '')
               .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
               .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
               .replace(/[\u{2600}-\u{26FF}]/gu, '')
               .replace(/[\u{2B50}]/gu, '');

  // 5. Clean up markdown, raw code blocks, and double newlines
  clean = clean.replace(/```[\s\S]*?```/g, ' [code output shown on screen] ')
               .replace(/`([^`]+)`/g, '$1')
               .replace(/\n{2,}/g, '. ')
               .replace(/\n/g, '. ');

  // 6. Final trim and limit
  return clean.substring(0, 1000).trim();
}

async function speakText(text) {
  const clean = cleanTextForSpeech(text);

  if (!clean) { resumeListening(); return; }

  isSpeaking = true;
  petZone.classList.add('is-speaking');
  viDot.className = 'vi-speak';
  showStatus('🔊 Speaking...', 'st-speak');

  // Try ElevenLabs first
  if (elevenLabsKey) {
    try {
      const result = await api.elevenLabsTTS(clean, elevenLabsVoice, elevenLabsKey);
      if (result.ok) {
        const blob = new Blob([result.audio], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        
        // Save the audio object in the global currentAudio variable
        currentAudio = new Audio(url);
        currentAudio.volume = volume;
        currentAudio.onended = () => {
          URL.revokeObjectURL(url);
          isSpeaking = false;
          petZone.classList.remove('is-speaking');
          viDot.className = ''; hideStatus();
          currentAudio = null;
          resumeListening();
        };
        currentAudio.onerror = () => {
          URL.revokeObjectURL(url);
          console.log('ElevenLabs audio playback failed, falling back');
          currentAudio = null;
          speakBrowserTTS(clean);
        };
        currentAudio.play();
        return;
      } else {
        console.log('ElevenLabs failed:', result.error, '- falling back to browser TTS');
      }
    } catch (e) {
      console.log('ElevenLabs error:', e.message);
    }
  }

  // Fallback: browser TTS
  speakBrowserTTS(clean);
}

function speakBrowserTTS(clean) {
  if (!window.speechSynthesis) { finishSpeaking(); return; }
  window.speechSynthesis.cancel();

  const utt = new SpeechSynthesisUtterance(clean.substring(0, 400));
  utt.pitch = 1.1;
  utt.rate = 1.05;
  utt.volume = volume;

  const voices = window.speechSynthesis.getVoices();
  const pref = voices.find(v =>
    v.name.includes('Zira') || v.name.includes('Hazel') ||
    v.name.includes('Google UK English Female') || v.name.includes('Samantha')
  );
  if (pref) utt.voice = pref;

  utt.onstart = () => {
    isSpeaking = true;
    petZone.classList.add('is-speaking');
    viDot.className = 'vi-speak';
    showStatus('🔊 Speaking...', 'st-speak');
  };
  utt.onend = () => finishSpeaking();
  utt.onerror = () => finishSpeaking();

  window.speechSynthesis.speak(utt);
}

function finishSpeaking() {
  isSpeaking = false;
  petZone.classList.remove('is-speaking');
  viDot.className = ''; hideStatus();
  resumeListening();
}

// ═══════════════════════════════════════════════════════════════════════════
// BARK SOUND (synthesized)
// ═══════════════════════════════════════════════════════════════════════════
function playBark() {
  try {
    const ctx = new AudioContext();
    // Two short bark bursts
    for (let b = 0; b < 2; b++) {
      const t = ctx.currentTime + b * 0.3;
      // Main bark tone (sawtooth sweep down)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(500 + b * 80, t);
      osc.frequency.exponentialRampToValueAtTime(180, t + 0.12);
      gain.gain.setValueAtTime(0.35 * volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.18);

      // Noise burst for texture
      const bufSize = ctx.sampleRate * 0.1;
      const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const noiseData = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) noiseData[i] = (Math.random() * 2 - 1) * 0.15;
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.2 * volume, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      noise.connect(nGain); nGain.connect(ctx.destination);
      noise.start(t); noise.stop(t + 0.1);
    }
  } catch(e) { console.log('Bark error:', e); }
}

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN CAPTURE + VISION
// ═══════════════════════════════════════════════════════════════════════════
async function lookAtScreen(userQuery) {
  try {
    const capture = await api.captureScreen();
    if (!capture.ok) {
      return '❌ Could not capture screen: ' + capture.error;
    }

    const cleanedQuery = userQuery.replace(/\b(look at|see|screen|what's on|what do you see|read my|check my|look at my|show me what|what am i doing)\b/gi, '').trim();
    const query = cleanedQuery || 'What do you see on my screen?';

    const msgs = [
      { 
        role: 'system', 
        content: `You are Pluto, a smart Jarvis-like desktop assistant. The user wants you to analyze their screen.\n` +
          `A high-resolution screenshot is attached. Read all text, identify active windows, apps, code editors, browser tabs, and documents.\n` +
          `Answer the user's specific query about the screen directly and conversationally. Do not speak actions or metadata headers.` 
      },
      { role: 'user', content: query }
    ];

    const r = await api.chatGroqVision(msgs, 'meta-llama/llama-4-scout-17b-16e-instruct', capture.base64, groqKey);
    if (r.ok) {
      return r.text.trim();
    }

    console.error('Vision API failed:', r.error);
    return `❌ Screen analysis failed: ${r.error}`;
  } catch (err) {
    return `❌ Screen analysis failed: ${err.message}`;
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// THINKING BEEP (Web Audio)
// ═══════════════════════════════════════════════════════════════════════════
let audioCtx = null;
function playBeep() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = 'sine';
    o.frequency.setValueAtTime(800, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + .08);
    o.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + .18);
    g.gain.setValueAtTime(0.12 * volume, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + .25);
    o.start(); o.stop(audioCtx.currentTime + .25);
  } catch(e){}
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTICLES
// ═══════════════════════════════════════════════════════════════════════════
function spawnParticles() {
  const emojis = ['🍕','⚡','✨','💎','🌟','🔋','💜','🛸'];
  const c = $('app');
  const r = petZone.getBoundingClientRect();
  const cx = r.left + r.width/2, cy = r.top + r.height/2;
  for (let i = 0; i < 10; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.textContent = emojis[~~(Math.random()*emojis.length)];
    const a = (Math.PI*2/10)*i + Math.random()*.5 - .25;
    const d = 40 + Math.random()*55;
    p.style.left = cx+'px'; p.style.top = cy+'px';
    p.style.setProperty('--tx', Math.cos(a)*d+'px');
    p.style.setProperty('--ty', Math.sin(a)*d+'px');
    p.style.animationDuration = (.7+Math.random()*.5)+'s';
    c.appendChild(p);
    setTimeout(() => p.remove(), 1300);
  }
}
function spawnSparkles() {
  const cols = ['#00ffff','#ff007f','#ffb700','#00ff66','#b700ff','#fff'];
  const c = $('app');
  const r = petZone.getBoundingClientRect();
  const cx = r.left + r.width/2, cy = r.top + r.height/2;
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('div');
    s.className = 'sparkle';
    const col = cols[~~(Math.random()*cols.length)];
    s.style.background = col;
    s.style.boxShadow = `0 0 6px ${col}`;
    const a = Math.random()*Math.PI*2;
    const d = 25 + Math.random()*65;
    s.style.left = cx+'px'; s.style.top = cy+'px';
    s.style.setProperty('--tx', Math.cos(a)*d+'px');
    s.style.setProperty('--ty', Math.sin(a)*d+'px');
    s.style.animationDuration = (.4+Math.random()*.4)+'s';
    c.appendChild(s);
    setTimeout(() => s.remove(), 1000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE DISPLAY
// ═══════════════════════════════════════════════════════════════════════════
function showMsg(text) {
  msgLabel.innerHTML = '🤖 Pluto';
  msgText.textContent = text;
  msgArea.classList.add('visible');
  // Scroll to bottom for long messages
  setTimeout(() => { msgArea.scrollTop = msgArea.scrollHeight; }, 50);
}

function showMsgTyping(text) {
  msgLabel.innerHTML = '💭 Pluto';
  msgText.textContent = text;
  msgArea.classList.add('visible');
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS BUBBLE
// ═══════════════════════════════════════════════════════════════════════════
function showStatus(text, cls) {
  clearTimeout(statusTimer);
  statusBub.textContent = text;
  statusBub.className = `interactive visible ${cls}`;
}
function hideStatus() {
  statusBub.classList.remove('visible');
}

// ═══════════════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════════════
function updateStats() {
  const h = ~~hunger, hp = ~~happiness, e = ~~energy;
  $('h-num').textContent  = `${h}/10`;
  $('hp-num').textContent = `${hp}/10`;
  $('e-num').textContent  = `${e}/10`;

  setBar('h-bar',  hunger);
  setBar('hp-bar', happiness);
  setBar('e-bar',  energy);
}

function setBar(id, val) {
  const bar = $(id);
  bar.style.width = `${val * 10}%`;
  bar.classList.remove('lvl-high','lvl-mid','lvl-low','bar-pulse');
  if (val >= 7)      bar.classList.add('lvl-high');
  else if (val >= 3) bar.classList.add('lvl-mid');
  else               { bar.classList.add('lvl-low','bar-pulse'); }
}

function decayStats() {
  if (isSleeping) {
    energy = Math.min(10, energy + 2);
    hunger = Math.max(1, hunger - .5);
    updateStats(); updateAnim(); return;
  }
  hunger    = Math.max(1, hunger - 1);
  energy    = Math.max(1, energy - 1);
  happiness = Math.max(1, happiness - 1);
  updateStats(); updateAnim();

  if (energy < 3 && !isSleeping)
    { showStatus("😴 Pluto is low on energy...", 'st-think'); setTimeout(hideStatus, 4000); }
  else if (hunger < 3)
    { showStatus("🍕 Pluto is hungry!", 'st-think'); setTimeout(hideStatus, 4000); }
  else if (happiness > 8) {
    playJump();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RANDOM CHATTER
// ═══════════════════════════════════════════════════════════════════════════
function randomChatter() {
  if (isListening || isSpeaking || isThinking || isSleeping) return;
  if (Math.random() > .25) return;
  const lines = [
    'Running diagnostics... all systems green! ✅',
    'Standing by, buddy. Need anything? ⚡',
    'Pluto is scanning for tasks... 🔍',
    'Ready when you are! Double-click to chat. 🎙️',
    'Monitoring... everything looks good! 🛡️',
    'Need study help? Just ask! 📚',
    'Pluto is here. Always watching, always ready. 👁️',
  ];
  const line = lines[~~(Math.random()*lines.length)];
  // Only show in the tiny status bubble, NOT the big message area
  showStatus(`🤖 ${line}`, 'st-listen');
  setTimeout(hideStatus, 4000);
}
