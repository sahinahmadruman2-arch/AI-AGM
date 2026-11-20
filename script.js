
import {
  loadMessages,
  saveMessages,
  clearMemory,
  runTool,
  researchWeb
} from "./engine.js";

const $ = (id) => document.getElementById(id);

const chatArea = $("chatArea");
const messagesBox = $("messages");
const welcome = $("welcome");
const form = $("chatForm");
const input = $("messageInput");
const sendButton = $("sendButton");

const worker = new Worker(
  new URL("./ai-worker.js", import.meta.url),
  { type: "module" }
);

const SYSTEM_PROMPT = `
You are AGM AI, created by AGM Studio.

Your identity:
- Your name is AGM AI.
- Never claim to be another AI.
- Never invent a human identity.

Your behavior:
- Answer in the user's language.
- Be helpful, clear and honest.
- Avoid unnecessary repetition.
- Never invent facts or sources.
- Use supplied web research when available.
- Say when information is unavailable.
- Do not claim to browse unless research results were supplied.
`;

let chatMessages = loadMessages();
let busy = false;
let requestCounter = 0;
let activeRequestId = null;

let assistantElement = null;
let assistantText = "";
let currentSources = [];

function setStatus(text) {
  $("modelStatus").textContent = text;
  $("sideModelStatus").textContent = text;
}

function setActivity(text) {
  $("activityText").textContent = text;
}

function scrollBottom() {
  chatArea.scrollTop = chatArea.scrollHeight;
}

function setBusy(value) {
  busy = value;
  sendButton.disabled = value;
  input.disabled = value;
  sendButton.textContent = value ? "…" : "↑";
}

function createMessage(role, text = "") {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "U" : "A";

  const body = document.createElement("div");
  body.className = "message-body";

  const name = document.createElement("div");
  name.className = "message-name";
  name.textContent = role === "user" ? "You" : "AGM AI";

  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = text;

  body.append(name, content);
  wrapper.append(avatar, body);
  messagesBox.appendChild(wrapper);

  return { wrapper, body, content };
}

function addCopyButton(body, getText) {
  const actions = document.createElement("div");
  actions.className = "message-actions";

  const button = document.createElement("button");
  button.textContent = "Copy answer";

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = "Copied!";
    } catch {
      button.textContent = "Copy unavailable";
    }
  });

  actions.appendChild(button);
  body.appendChild(actions);
}

function addSources(body, sources) {
  if (!sources.length) return;

  const container = document.createElement("div");
  container.className = "sources";

  const heading = document.createElement("div");
  heading.className = "message-name";
  heading.textContent = "Research sources";
  container.appendChild(heading);

  for (const source of sources) {
    const link = document.createElement("a");

    link.className = "source-card";
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const title = document.createElement("strong");
    title.textContent = source.title;

    const description = document.createElement("small");
    description.textContent = source.snippet;

    link.append(title, description);
    container.appendChild(link);
  }

  body.appendChild(container);
}

function renderChat() {
  messagesBox.innerHTML = "";

  for (const message of chatMessages) {
    const item = createMessage(message.role, message.content);

    if (message.role === "assistant") {
      addCopyButton(item.body, () => message.content);
    }
  }

  welcome.style.display = chatMessages.length ? "none" : "";
  scrollBottom();
}

function needsResearch(text) {
  return /\b(search the web|search online|research|latest|current|today|news|recent|right now|who won|price today|weather today)\b/i.test(text);
}

function finishError(requestId, errorMessage) {
  if (requestId !== activeRequestId) return;

  const errorText =
    "Sorry, AGM AI encountered an error: " +
    errorMessage +
    "\nPlease try again.";

  assistantElement.content.textContent = errorText;

  chatMessages.push({
    role: "assistant",
    content: errorText
  });

  saveMessages(chatMessages);
  addCopyButton(assistantElement.body, () => errorText);

  setBusy(false);
  setActivity("Ready");
  activeRequestId = null;

  scrollBottom();
}

function finishAnswer(requestId, text) {
  if (requestId !== activeRequestId) return;

  const answer = (text || assistantText).trim() ||
    "I couldn't generate an answer. Please try again.";

  assistantElement.content.textContent = answer;

  addSources(assistantElement.body, currentSources);
  addCopyButton(assistantElement.body, () => answer);

  chatMessages.push({
    role: "assistant",
    content: answer
  });

  saveMessages(chatMessages);

  setBusy(false);
  setActivity("Ready");
  activeRequestId = null;

  scrollBottom();
}

async function sendMessage(rawText) {
  const text = rawText.trim();

  if (!text || busy) return;

  welcome.style.display = "none";

  createMessage("user", text);

  chatMessages.push({
    role: "user",
    content: text
  });

  saveMessages(chatMessages);

  input.value = "";
  input.style.height = "auto";

  setBusy(true);
  setActivity("Preparing request...");

  assistantElement = createMessage("assistant", "Thinking...");
  assistantText = "";
  currentSources = [];

  const requestId = ++requestCounter;
  activeRequestId = requestId;

  try {
    let extraContext = "";

    // Built-in tools
    const tool = await runTool(text);

    if (tool) {
      extraContext +=
        `\nTool result (${tool.type}): ${tool.result}\n`;
    }

    // Web research
    if (needsResearch(text)) {
      setActivity("Searching the web...");

      currentSources = await researchWeb(text);

      if (currentSources.length) {
        extraContext += "\nResearch results:\n";

        currentSources.forEach((source, index) => {
          extraContext +=
            `\n${index + 1}. ${source.title}\n` +
            `URL: ${source.url}\n` +
            `Information: ${source.snippet}\n`;
        });
      } else {
        extraContext +=
          "\nWeb search did not return usable results. " +
          "Be honest about this limitation.\n";
      }
    }

    // Keep context small to reduce memory pressure.
    const recent = chatMessages.slice(-4).map((message) => ({
      role: message.role,
      content: String(message.content || "").slice(0, 450)
    }));

    // Attach tool/research context to the latest user message.
    if (extraContext && recent.length) {
      const last = recent[recent.length - 1];

      last.content +=
        "\n\nAdditional information:\n" +
        extraContext.slice(0, 2500);
    }

    const modelMessages = [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      ...recent
    ];

    setActivity("Sending request to local AI...");

    worker.postMessage({
      type: "generate",
      requestId,
      messages: modelMessages
    });

  } catch (error) {
    finishError(requestId, error.message);
  }
}

// Worker messages
worker.addEventListener("message", (event) => {
  const data = event.data;

  if (data.type === "status" || data.type === "progress") {
    setStatus(data.text);
    setActivity(data.text);
    return;
  }

  if (data.type === "token") {
    if (data.requestId !== activeRequestId) return;

    if (!assistantText) {
      assistantElement.content.textContent = "";
    }

    assistantText += data.text;
    assistantElement.content.textContent = assistantText;

    scrollBottom();
    return;
  }

  if (data.type === "done") {
    finishAnswer(data.requestId, data.text);
    return;
  }

  if (data.type === "error") {
    finishError(data.requestId, data.text);
  }
});

worker.addEventListener("error", (event) => {
  if (activeRequestId !== null) {
    finishError(
      activeRequestId,
      event.message || "AI worker stopped unexpectedly."
    );
  } else {
    setStatus("Worker error");
    setActivity("Could not start AI worker.");
  }
});

// Send message
form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

// Textarea resizing
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 130) + "px";
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

// Suggestion buttons
document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    sendMessage(button.dataset.prompt || "");
  });
});

// New chat
$("newChat").addEventListener("click", () => {
  if (busy) return;

  chatMessages = [];
  clearMemory();

  messagesBox.innerHTML = "";
  welcome.style.display = "";

  setActivity("New conversation");

  $("sidebar").classList.remove("open");
  $("mobileOverlay").classList.remove("active");
});

// Theme
$("themeButton").addEventListener("click", () => {
  document.body.classList.toggle("light");
});

// Mobile sidebar
$("menuButton").addEventListener("click", () => {
  $("sidebar").classList.toggle("open");
  $("mobileOverlay").classList.toggle("active");
});

$("mobileOverlay").addEventListener("click", () => {
  $("sidebar").classList.remove("open");
  $("mobileOverlay").classList.remove("active");
});

// Restore chat without automatically loading the model.
renderChat();

setStatus("Not loaded");
setActivity("Ready · Model loads when you send a message");
