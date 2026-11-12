
/* ======================================
   AGM AI — LOCAL AI ENGINE
   Transformers.js + CPU/WASM
   Version 1.1
====================================== */

import {
  pipeline,
  env
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

// CONFIGURATION

const MODEL_ID =
  "onnx-community/SmolLM2-135M-Instruct-ONNX-MHA";

env.allowLocalModels = false;
env.allowRemoteModels = true;

// ELEMENTS

const $ = id => document.getElementById(id);

const promptInput = $("prompt");
const messages = $("messages");
const welcome = $("welcome");
const historyBox = $("history");
const chatArea = $("chatArea");
const sidebar = $("sidebar");
const overlay = $("overlay");
const modelLabel = document.querySelector(".model-label");

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

// STATUS

function setStatus(text) {
  modelLabel.textContent = "✦ " + text;
}

// SAVE

function saveChats() {
  try {
    localStorage.setItem(
      "agm_chats",
      JSON.stringify(chats)
    );
  } catch (error) {
    console.warn("Chat storage unavailable:", error);
  }
}

// MODEL LOADING

async function loadAI() {
  if (ai) return ai;

  if (loadingModel) return loadingModel;

  loadingModel = (async () => {
    try {
      setStatus("Downloading AI model...");

      const model = await pipeline(
        "text-generation",
        MODEL_ID,
        {
          dtype: "q4",
          progress_callback: progress => {
            if (progress.status === "progress") {
              const percent = Math.round(
                progress.progress || 0
              );

              setStatus("Downloading " + percent + "%");
            } else if (progress.status === "initiate") {
              setStatus("Preparing model...");
            } else if (progress.status === "done") {
              setStatus("Preparing AI...");
            }
          }
        }
      );

      ai = model;
      setStatus("AGM AI Ready");

      return ai;

    } catch (error) {
      console.error("Model loading failed:", error);
      setStatus("Model loading failed");
      loadingModel = null;
      throw error;
    }
  })();

  return loadingModel;
}

// CHAT MANAGEMENT

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
  return chats.find(chat => chat.id === currentChat);
}

// HISTORY

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

// MESSAGES

function renderMessages() {
  messages.innerHTML = "";

  const chat = getCurrentChat();

  if (!chat || chat.messages.length === 0) {
    welcome.style.display = "block";
    return;
  }

  welcome.style.display = "none";

  chat.messages.forEach(message => {
    const wrapper = document.createElement("div");

    wrapper.className = "message " + message.role;

    const label = document.createElement("div");
    label.className = "message-label";

    label.textContent =
      message.role === "user" ? "YOU" : "AGM AI";

    const content = document.createElement("div");
    content.className = "message-content";

    content.textContent = message.text;

    wrapper.append(label, content);
    messages.appendChild(wrapper);
  });

  scrollToBottom();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatArea.scrollTo({
      top: chatArea.scrollHeight,
      behavior: "smooth"
    });
  });
}

// BUILD MODEL PROMPT

function buildPrompt(chat) {
  const recent = chat.messages.slice(-8);

  let prompt =
    "<|im_start|>system\n" +
    "You are AGM AI, a helpful and friendly AI assistant. " +
    "Answer clearly and honestly. Keep answers useful and concise. " +
    "<|im_end|>\n";

  recent.forEach(message => {
    const role =
      message.role === "user" ? "user" : "assistant";

    prompt +=
      "<|im_start|>" + role + "\n" +
      message.text.slice(0, 1200) +
      "<|im_end|>\n";
  });

  prompt += "<|im_start|>assistant\n";

  return prompt;
}

// GENERATE RESPONSE

async function generateAnswer(chat) {
  const model = await loadAI();

  setStatus("Thinking...");

  const result = await model(
    buildPrompt(chat),
    {
      max_new_tokens: 100,
      temperature: 0.7,
      do_sample: true,
      top_p: 0.9,
      repetition_penalty: 1.1,
      return_full_text: false
    }
  );

  let answer = result[0]?.generated_text ?? "";

  if (typeof answer !== "string") {
    answer = String(answer);
  }

  answer = answer
    .replace(/<\|im_end\|>[\s\S]*/g, "")
    .replace(/<\|im_start\|>[\s\S]*/g, "")
    .trim();

  return answer || "I couldn't generate a response. Please try again.";
}

// SEND MESSAGE

async function sendMessage(text) {
  text = text.trim();

  if (!text || busy) return;

  if (!currentChat) createChat();

  const chat = getCurrentChat();

  if (!chat) return;

  busy = true;
  $("sendBtn").disabled = true;

  chat.messages.push({
    role: "user",
    text
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
    console.error(error);

    chat.messages.push({
      role: "assistant",
      text:
        "Sorry! I couldn't load or run my local AI model. " +
        "Please check your internet connection, available memory, " +
        "and try again."
    });

    saveChats();

    if (currentChat === chat.id) {
      renderMessages();
    }

    setStatus("AI Error");
  } finally {
    busy = false;
    $("sendBtn").disabled = false;
  }
}

// NEW CHAT

$("newChat").addEventListener("click", () => {
  if (!busy) createChat();
});

// SEND BUTTON

$("sendBtn").addEventListener("click", () => {
  sendMessage(promptInput.value);
});

// ENTER TO SEND

promptInput.addEventListener("keydown", event => {
  if (
    event.key === "Enter" &&
    !event.shiftKey
  ) {
    event.preventDefault();
    sendMessage(promptInput.value);
  }
});

// AUTO TEXTAREA

promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";

  promptInput.style.height =
    Math.min(promptInput.scrollHeight, 140) + "px";
});

// SUGGESTIONS

document.querySelectorAll(".suggestions button")
  .forEach(button => {
    button.addEventListener("click", () => {
      sendMessage(button.dataset.prompt);
    });
  });

// SIDEBAR

function openSidebar() {
  sidebar.classList.add("open");
  overlay.classList.add("show");
}

function closeSidebar() {
  sidebar.classList.remove("open");
  overlay.classList.remove("show");
}

$("menuBtn").addEventListener("click", openSidebar);
$("closeSidebar").addEventListener("click", closeSidebar);
overlay.addEventListener("click", closeSidebar);

// THEME

const savedTheme = localStorage.getItem("agm_theme");

if (savedTheme === "light") {
  document.body.classList.add("light");
  $("themeBtn").textContent = "☾";
}

$("themeBtn").addEventListener("click", () => {
  document.body.classList.toggle("light");

  const light =
    document.body.classList.contains("light");

  localStorage.setItem(
    "agm_theme",
    light ? "light" : "dark"
  );

  $("themeBtn").textContent =
    light ? "☾" : "☼";
});

// STARTUP

if (chats.length > 0) {
  currentChat = chats[0].id;
}

renderHistory();
renderMessages();

setStatus("Local AI · Not loaded");

console.log("AGM AI local engine initialized.");
