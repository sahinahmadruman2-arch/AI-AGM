
/* ==========================================
   AGM AI — LOCAL INTELLIGENCE ENGINE
   Version 1.2
   Transformers.js + Qwen2.5
   CPU / WASM
========================================== */

import {
  pipeline,
  env
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

// ==========================================
// CONFIGURATION
// ==========================================

const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";

const SYSTEM_PROMPT = `
You are AGM AI, an intelligent and friendly AI assistant.

IDENTITY:
- Your name is AGM AI.
- You were created as part of AGM Studio.
- Never call yourself Alex Chen, ChatGPT, or another assistant.
- If someone asks your name, say AGM AI.

BEHAVIOR:
- Answer the actual question directly.
- Be helpful, clear, accurate and conversational.
- Never repeat your introduction unnecessarily.
- Do not invent facts.
- If you do not know something, admit it.
- Avoid repeating the same sentences.
- Keep simple answers short.
- Explain complicated topics step by step.
- Follow the language used by the user.
- You can communicate in English and Bangla.
- Do not claim to have internet access or tools you do not have.

You are AGM AI. Stay consistent with this identity.
`;

// ==========================================
// TRANSFORMERS CONFIGURATION
// ==========================================

env.allowLocalModels = false;
env.allowRemoteModels = true;

// ==========================================
// ELEMENTS
// ==========================================

const $ = id => document.getElementById(id);

const promptInput = $("prompt");
const messages = $("messages");
const welcome = $("welcome");
const historyBox = $("history");
const chatArea = $("chatArea");
const sidebar = $("sidebar");
const overlay = $("overlay");
const sendBtn = $("sendBtn");
const modelLabel = document.querySelector(".model-label");

// ==========================================
// STATE
// ==========================================

let chats = [];

try {
  chats = JSON.parse(
    localStorage.getItem("agm_chats") || "[]"
  );

  if (!Array.isArray(chats)) chats = [];
} catch {
  chats = [];
}

let currentChat = null;
let ai = null;
let loadingModel = null;
let busy = false;

// ==========================================
// STATUS
// ==========================================

function setStatus(status) {
  if (modelLabel) {
    modelLabel.textContent = "✦ " + status;
  }
}

// ==========================================
// STORAGE
// ==========================================

function saveChats() {
  try {
    localStorage.setItem(
      "agm_chats",
      JSON.stringify(chats)
    );
  } catch (error) {
    console.warn("Storage error:", error);
    setStatus("Storage limit reached");
  }
}

// ==========================================
// LOAD AI MODEL
// ==========================================

async function loadAI() {

  if (ai) return ai;

  if (loadingModel) return loadingModel;

  loadingModel = (async () => {

    try {

      setStatus("Preparing local AI...");

      const generator = await pipeline(
        "text-generation",
        MODEL_ID,
        {
          dtype: "q4",

          progress_callback: progress => {

            if (progress.status === "initiate") {
              setStatus("Starting download...");
            }

            if (progress.status === "progress") {

              const percent = Math.round(
                progress.progress || 0
              );

              setStatus(
                "Downloading " + percent + "%"
              );
            }

            if (progress.status === "done") {
              setStatus("Loading model...");
            }

          }
        }
      );

      ai = generator;

      setStatus("AGM AI Ready");

      return generator;

    } catch (error) {

      console.error("AI loading error:", error);

      loadingModel = null;

      setStatus("Model loading failed");

      throw error;
    }

  })();

  return loadingModel;
}

// ==========================================
// CHAT MANAGEMENT
// ==========================================

function createChat() {

  const chat = {
    id: Date.now().toString(),
    title: "New Chat",
    messages: [],
    updated: Date.now()
  };

  chats.unshift(chat);

  currentChat = chat.id;

  saveChats();
  renderHistory();
  renderMessages();
  closeSidebar();

  promptInput.focus();
}

function getCurrentChat() {

  return chats.find(
    chat => chat.id === currentChat
  );
}

// ==========================================
// CHAT HISTORY
// ==========================================

function renderHistory() {

  historyBox.innerHTML = "";

  chats.forEach(chat => {

    const item = document.createElement("div");

    item.className =
      "history-item" +
      (chat.id === currentChat ? " active" : "");

    item.textContent = chat.title;

    item.addEventListener("click", () => {

      if (busy) return;

      currentChat = chat.id;

      renderHistory();
      renderMessages();

      closeSidebar();

    });

    historyBox.appendChild(item);

  });
}

// ==========================================
// MESSAGE DISPLAY
// ==========================================

function addMessage(role, text) {

  const wrapper = document.createElement("div");

  wrapper.className = "message " + role;

  const label = document.createElement("div");

  label.className = "message-label";

  label.textContent =
    role === "user" ? "YOU" : "AGM AI";

  const content = document.createElement("div");

  content.className = "message-content";

  content.textContent = text;

  wrapper.append(label, content);

  messages.appendChild(wrapper);

  scrollToBottom();

  return content;
}

function renderMessages() {

  messages.innerHTML = "";

  const chat = getCurrentChat();

  if (!chat || !chat.messages.length) {

    welcome.style.display = "block";

    return;
  }

  welcome.style.display = "none";

  chat.messages.forEach(message => {

    addMessage(
      message.role,
      message.text
    );

  });

  scrollToBottom();
}

// ==========================================
// SCROLL
// ==========================================

function scrollToBottom() {

  requestAnimationFrame(() => {

    chatArea.scrollTo({
      top: chatArea.scrollHeight,
      behavior: "smooth"
    });

  });
}

// ==========================================
// CHAT CONTEXT
// ==========================================

function buildMessages(chat) {

  const recentMessages = chat.messages
    .slice(-8)
    .map(message => ({

      role: message.role,

      content: message.text.slice(0, 1500)

    }));

  return [

    {
      role: "system",
      content: SYSTEM_PROMPT
    },

    ...recentMessages

  ];
}

// ==========================================
// AI RESPONSE
// ==========================================

async function generateAnswer(chat) {

  const generator = await loadAI();

  setStatus("Thinking...");

  const conversation = buildMessages(chat);

  const result = await generator(
    conversation,
    {
      max_new_tokens: 180,
      do_sample: true,
      temperature: 0.7,
      top_p: 0.85,
      repetition_penalty: 1.15
    }
  );

  let generated = result?.[0]?.generated_text;

  let answer = "";

  // Chat output can be an array of messages.

  if (Array.isArray(generated)) {

    const lastMessage = generated
      .filter(item => item.role === "assistant")
      .pop();

    answer = lastMessage?.content || "";

  } else if (typeof generated === "string") {

    answer = generated;

  }

  answer = answer.trim();

  // Remove accidental special tokens.

  answer = answer
    .replace(/<\|im_end\|>/g, "")
    .replace(/<\|endoftext\|>/g, "")
    .trim();

  if (!answer) {

    throw new Error("Empty AI response");

  }

  return answer;
}

// ==========================================
// SEND MESSAGE
// ==========================================

async function sendMessage(text) {

  text = text.trim();

  if (!text || busy) return;

  if (!currentChat) {
    createChat();
  }

  const chat = getCurrentChat();

  if (!chat) return;

  busy = true;

  sendBtn.disabled = true;

  welcome.style.display = "none";

  // Save user message.

  chat.messages.push({

    role: "user",
    text: text

  });

  if (chat.messages.length === 1) {

    chat.title = text.length > 28
      ? text.slice(0, 28) + "..."
      : text;

  }

  chat.updated = Date.now();

  saveChats();

  renderHistory();

  renderMessages();

  promptInput.value = "";

  promptInput.style.height = "auto";

  // Show loading indicator.

  const loadingMessage = addMessage(
    "assistant",
    "Thinking..."
  );

  try {

    const answer = await generateAnswer(chat);

    chat.messages.push({

      role: "assistant",
      text: answer

    });

    chat.updated = Date.now();

    saveChats();

    if (currentChat === chat.id) {

      renderMessages();

    }

    setStatus("AGM AI Ready");

  } catch (error) {

    console.error("Generation error:", error);

    loadingMessage.textContent =
      "I couldn't generate a response. Please try again.";

    setStatus("AI Error");

  } finally {

    busy = false;

    sendBtn.disabled = false;

    promptInput.focus();

  }
}

// ==========================================
// NEW CHAT
// ==========================================

$("newChat").addEventListener(
  "click",
  () => {

    if (!busy) createChat();

  }
);

// ==========================================
// SEND BUTTON
// ==========================================

sendBtn.addEventListener(
  "click",
  () => {

    sendMessage(promptInput.value);

  }
);

// ==========================================
// ENTER TO SEND
// ==========================================

promptInput.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {

      event.preventDefault();

      sendMessage(promptInput.value);

    }

  }
);

// ==========================================
// TEXTAREA AUTO HEIGHT
// ==========================================

promptInput.addEventListener(
  "input",
  () => {

    promptInput.style.height = "auto";

    promptInput.style.height =
      Math.min(promptInput.scrollHeight, 140) + "px";

  }
);

// ==========================================
// SUGGESTED PROMPTS
// ==========================================

document.querySelectorAll(
  ".suggestions button"
).forEach(button => {

  button.addEventListener(
    "click",
    () => {

      sendMessage(button.dataset.prompt);

    }
  );

});

// ==========================================
// SIDEBAR
// ==========================================

function openSidebar() {

  sidebar.classList.add("open");

  overlay.classList.add("show");

}

function closeSidebar() {

  sidebar.classList.remove("open");

  overlay.classList.remove("show");

}

$("menuBtn").addEventListener(
  "click",
  openSidebar
);

$("closeSidebar").addEventListener(
  "click",
  closeSidebar
);

overlay.addEventListener(
  "click",
  closeSidebar
);

// ==========================================
// THEME
// ==========================================

const savedTheme =
  localStorage.getItem("agm_theme");

if (savedTheme === "light") {

  document.body.classList.add("light");

  $("themeBtn").textContent = "☾";

}

$("themeBtn").addEventListener(
  "click",
  () => {

    document.body.classList.toggle("light");

    const light =
      document.body.classList.contains("light");

    localStorage.setItem(
      "agm_theme",
      light ? "light" : "dark"
    );

    $("themeBtn").textContent =
      light ? "☾" : "☼";

  }
);

// ==========================================
// STARTUP
// ==========================================

if (chats.length > 0) {

  currentChat = chats[0].id;

}

renderHistory();

renderMessages();

setStatus("Qwen AI · Not loaded");

console.log(
  "AGM AI v1.2 initialized successfully."
);
