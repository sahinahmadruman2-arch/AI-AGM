
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

const SYSTEM_PROMPT = `
You are AGM AI, an AI assistant created by AGM Studio.

IDENTITY:
- Your name is AGM AI.
- Never claim to be ChatGPT, Gemini, or another assistant.
- Do not invent a human identity.

BEHAVIOR:
- Be helpful, clear, accurate and honest.
- Answer in the language used by the user.
- Avoid repeating the same phrases.
- If you do not know something, say so.
- Never invent sources, facts or search results.
- Use the provided research information when available.
- Clearly explain when information may be incomplete.
- Do not claim to have browsed the internet unless research results were provided.
- Keep answers reasonably concise unless detail is requested.
`;

let chatMessages = loadMessages();
let busy = false;
let currentAssistantElement = null;
let currentAssistantText = "";
let currentSources = [];
let requestCounter = 0;
let activeRequestId = null;

const worker = new Worker(
  new URL("./ai-worker.js", import.meta.url),
  { type: "module" }
);

function setActivity(text) {
  $("activityText").textContent = text;
}

function setModelStatus(text) {
  $("modelStatus").textContent = text;
  $("sideModelStatus").textContent = text;
}

function scrollToBottom() {
  chatArea.scrollTop = chatArea.scrollHeight;
}

function createMessageElement(role, text = "") {
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

function addSources(body, sources) {
  if (!sources || !sources.length) return;

  const container = document.createElement("div");
  container.className = "sources";

  const heading = document.createElement("div");
  heading.className = "message-name";
  heading.textContent = "Research sources";
  container.appendChild(heading);

  sources.forEach((source) => {
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
  });

  body.appendChild(container);
}

function addCopyButton(body, getText) {
  const actions = document.createElement("div");
  actions.className = "message-actions";

  const copy = document.createElement("button");
  copy.textContent = "Copy answer";

  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getText());
      copy.textContent = "Copied!";
      setTimeout(() => copy.textContent = "Copy answer", 1200);
    } catch {
      copy.textContent = "Copy unavailable";
    }
  });

  actions.appendChild(copy);
  body.appendChild(actions);
}

function showWelcomeIfNeeded() {
  welcome.style.display = messagesBox.children.length ? "none" : "";
}

function renderSavedMessages() {
  messagesBox.innerHTML = "";

  for (const message of chatMessages) {
    const item = createMessageElement(message.role, message.content);

    if (message.role === "assistant") {
      addCopyButton(item.body, () => message.content);
    }
  }

  showWelcomeIfNeeded();
  scrollToBottom();
}

function detectResearchIntent(text) {
  return /\b(search the web|search online|research|latest|current|today|news|recent|2026|right now|who won|price today|weather today)\b/i.test(text);
}

function getSearchQuery(text) {
  return text
    .replace(/^(please\s+)?(search|research|find)\s+(the\s+)?(web|internet|online)?\s*(for|about)?\s*/i, "")
    .trim();
}

function setBusy(value) {
  busy = value;
  sendButton.disabled = value;
  input.disabled = value;
  sendButton.textContent = value ? "…" : "↑";
}

async function sendMessage(rawText) {
  const text = rawText.trim();

  if (!text || busy) return;

  welcome.style.display = "none";

  const userElement = createMessageElement("user", text);

  chatMessages.push({
    role: "user",
    content: text
  });

  saveMessages(chatMessages);

  input.value = "";
  input.style.height = "auto";

  setBusy(true);
  setActivity("Preparing your request...");

  const assistant = createMessageElement("assistant", "Thinking...");
  currentAssistantElement = assistant;
  currentAssistantText = "";
  currentSources = [];

  const requestId = ++requestCounter;
  activeRequestId = requestId;

  try {
    let extraContext = "";

    // Built-in tool routing
    const toolResult = await runTool(text);

    if (toolResult) {
      extraContext +=
        `\nTool result (${toolResult.type}): ${toolResult.result}\n`;

      setActivity("Using " + toolResult.type + " tool...");
    }

    // Web research routing
    if (detectResearchIntent(text)) {
      setActivity("Searching available web sources...");

      const query = getSearchQuery(text) || text;

      currentSources = await researchWeb(query);

      if (currentSources.length) {
        extraContext += "\nWeb research results:\n";

        currentSources.forEach((source, index) => {
          extraContext +=
            `\n${index + 1}. ${source.title}\n` +
            `URL: ${source.url}\n` +
            `Information: ${source.snippet}\n`;
        });

        setActivity("Research complete. Generating answer...");
      } else {
        extraContext +=
          "\nWeb research was attempted, but no usable results were returned. " +
          "Be honest that live research was unsuccessful.\n";

        setActivity("No web results found. Using local AI...");
      }
    }

    const recentMessages = chatMessages.slice(-8);

    const modelMessages = [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      ...recentMessages.slice(0, -1),
      ...(extraContext ? [{
        role: "system",
        content: "Additional information for this request:\n" + extraContext
      }] : []),
      recentMessages[recentMessages.length - 1]
    ];

    setActivity("Generating answer with local AI...");

    worker.postMessage({
      type: "generate",
      requestId,
      messages: modelMessages
    });

  } catch (error) {
    finishWithError(requestId, error.message);
  }
}

function finishWithError(requestId, message) {
  if (requestId !== activeRequestId) return;

  const errorText =
    "Sorry, something went wrong: " + message +
    "\nPlease try again.";

  currentAssistantElement.content.textContent = errorText;

  chatMessages.push({
    role: "assistant",
    content: errorText
  });

  saveMessages(chatMessages);

  addCopyButton(
    currentAssistantElement.body,
    () => errorText
  );

  setBusy(false);
  setActivity("Ready");
  activeRequestId = null;
  scrollToBottom();
}

function finishAnswer(requestId, finalText) {
  if (requestId !== activeRequestId) return;

  const answer = (finalText || currentAssistantText).trim() ||
    "I couldn't generate a response. Please try again.";

  currentAssistantElement.content.textContent = answer;

  addSources(currentAssistantElement.body, currentSources);

  addCopyButton(
    currentAssistantElement.body,
    () => answer
  );

  chatMessages.push({
    role: "assistant",
    content: answer
  });

  saveMessages(chatMessages);

  setBusy(false);
  setActivity("Ready");
  activeRequestId = null;
  scrollToBottom();
}

// Worker communication
worker.addEventListener("message", (event) => {
  const data = event.data;

  if (data.type === "status" || data.type === "progress") {
    setModelStatus(data.text);
    setActivity(data.text);
    return;
  }

  if (data.type === "ready") {
    setModelStatus("Model ready");
    setActivity("Ready");
    return;
  }

  if (data.type === "token") {
    if (data.requestId !== activeRequestId) return;

    if (!currentAssistantText) {
      currentAssistantElement.content.textContent = "";
    }

    currentAssistantText += data.text;
    currentAssistantElement.content.textContent = currentAssistantText;

    scrollToBottom();
    return;
  }

  if (data.type === "done") {
    finishAnswer(data.requestId, data.text);
    return;
  }

  if (data.type === "error") {
    if (data.requestId !== undefined) {
      finishWithError(data.requestId, data.text);
    } else {
      setModelStatus("Model error");
      setActivity(data.text);
    }
  }
});

worker.addEventListener("error", (event) => {
  if (activeRequestId !== null) {
    finishWithError(activeRequestId, event.message || "Worker crashed.");
  } else {
    setModelStatus("Worker error");
    setActivity("AI worker failed to start.");
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

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

// Suggestion cards
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
  setActivity("New conversation started");

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

// Restore previous chat
renderSavedMessages();

// Start model loading in background.
// First model download may take a while.
setModelStatus("Loading model...");
setActivity("Preparing local AI...");

worker.postMessage({ type: "load" });
