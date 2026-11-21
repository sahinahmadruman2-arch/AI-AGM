
import {
  getChats,
  saveChats,
  makeId,
  formatAnswer,
  isGreeting,
  greetingReply,
  needsResearch,
  researchWeb
} from "./engine.js";

const $ = (id) => document.getElementById(id);

const form = $("chatForm");
const input = $("messageInput");
const messagesBox = $("messages");
const welcome = $("welcome");
const statusLine = $("statusLine");
const sendButton = $("sendButton");
const historyList = $("historyList");

let chats = getChats();
let currentChatId = null;
let currentMessages = [];
let isBusy = false;
let worker = null;
let activeRequest = null;

function getWorker() {
  if (!worker) {
    worker = new Worker("./ai-worker.js", {
      type: "module"
    });

    worker.addEventListener("message", onWorkerMessage);

    worker.addEventListener("error", (error) => {
      console.error(error);
      setStatus("AI worker stopped.");
      finishRequest();
    });
  }

  return worker;
}

function setStatus(text) {
  statusLine.textContent = text;
}

function setBusy(value) {
  isBusy = value;
  sendButton.disabled = value;
  input.disabled = value;
  sendButton.textContent = value ? "…" : "↑";
}

function scrollBottom() {
  const area = $("chatArea");
  area.scrollTop = area.scrollHeight;
}

function showWelcome(show) {
  welcome.style.display = show ? "block" : "none";
}

function addMessage(role, text, sources = []) {
  showWelcome(false);

  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;

  if (role === "assistant") {
    const icon = document.createElement("div");
    icon.className = "message-icon";
    icon.textContent = "A";
    wrapper.appendChild(icon);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = formatAnswer(text);

  if (sources.length) {
    const sourceBox = document.createElement("div");
    sourceBox.className = "source-list";

    const heading = document.createElement("strong");
    heading.textContent = "SOURCES";
    sourceBox.appendChild(heading);

    sources.forEach((source, index) => {
      if (!source.url) return;

      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `${index + 1}. ${source.title || "Source"}`;

      sourceBox.appendChild(link);
    });

    bubble.appendChild(sourceBox);
  }

  wrapper.appendChild(bubble);
  messagesBox.appendChild(wrapper);

  scrollBottom();

  return bubble;
}

function addTyping() {
  const wrapper = document.createElement("div");
  wrapper.className = "message assistant";
  wrapper.id = "typingMessage";

  const icon = document.createElement("div");
  icon.className = "message-icon";
  icon.textContent = "A";

  const bubble = document.createElement("div");
  bubble.className = "bubble typing";
  bubble.textContent = "Thinking...";

  wrapper.append(icon, bubble);
  messagesBox.appendChild(wrapper);

  scrollBottom();

  return bubble;
}

function removeTyping() {
  $("typingMessage")?.remove();
}

function updateHistory() {
  historyList.innerHTML = "";

  [...chats].reverse().forEach(chat => {
    const button = document.createElement("button");
    button.className = "history-item";
    button.textContent = chat.title || "New chat";

    button.addEventListener("click", () => {
      openChat(chat.id);
    });

    historyList.appendChild(button);
  });
}

function persistCurrentChat() {
  if (!currentChatId || !currentMessages.length) return;

  const existingIndex = chats.findIndex(
    chat => chat.id === currentChatId
  );

  const chat = {
    id: currentChatId,
    title:
      currentMessages.find(m => m.role === "user")
        ?.content?.slice(0, 42) || "New chat",
    messages: currentMessages,
    updatedAt: Date.now()
  };

  if (existingIndex >= 0) {
    chats[existingIndex] = chat;
  } else {
    chats.push(chat);
  }

  chats.sort((a, b) => b.updatedAt - a.updatedAt);
  chats = chats.slice(0, 40);

  saveChats(chats);
  updateHistory();
}

function openChat(id) {
  const chat = chats.find(item => item.id === id);
  if (!chat) return;

  currentChatId = chat.id;
  currentMessages = [...chat.messages];

  messagesBox.innerHTML = "";
  showWelcome(false);

  currentMessages.forEach(message => {
    addMessage(
      message.role,
      message.content,
      message.sources || []
    );
  });

  $("sidebar").classList.remove("open");
}

function newChat() {
  currentChatId = makeId();
  currentMessages = [];

  messagesBox.innerHTML = "";
  showWelcome(true);

  setStatus("Ready when you are.");
  $("sidebar").classList.remove("open");
}

function finishRequest() {
  removeTyping();
  setBusy(false);
  activeRequest = null;
}

function addAssistantReply(text, sources = [], mode = "normal") {
  const reply = text.trim() ||
    "I couldn't generate a reply. Please try again.";

  addMessage("assistant", reply, sources);

  currentMessages.push({
    role: "assistant",
    content: reply,
    sources,
    mode
  });

  persistCurrentChat();
}

function isCasualChat(text) {
  const value = text.toLowerCase().trim();

  return (
    isGreeting(value) ||
    /^(how are you|how r u|what's up|whats up|are you there|let's chat|lets chat|talk to me|tell me a joke|make me laugh|say something funny|thanks|thank you)[.!? ]*$/.test(value)
  );
}

function isDeepResearch(text) {
  const value = text.toLowerCase();

  return /deep research|research deeply|in detail|detailed explanation|explain deeply|full explanation|comprehensive|compare in detail|how does .* work|how .* works|why does .* happen|complete guide|step by step/i.test(value);
}

function buildResearchPrompt(question, results, deep) {
  const sourceText = results.slice(0, deep ? 7 : 4)
    .map((item, index) => {
      return (
        `[${index + 1}] ${item.title || "Untitled"}\n` +
        `URL: ${item.url || "Unavailable"}\n` +
        `${String(item.text || "").slice(0, deep ? 850 : 500)}`
      );
    })
    .join("\n\n");

  return {
    role: "user",
    content:
      `Question: ${question}\n\n` +
      `Research mode: ${deep ? "DEEP" : "QUICK"}\n\n` +
      `Available web sources:\n${sourceText}\n\n` +
      `Write the answer directly. ` +
      `For a simple question, answer briefly. ` +
      `For deep research, explain the topic in sections, compare ` +
      `the available evidence, and mention what is uncertain. ` +
      `Use [1], [2] etc. to refer to the supplied sources. ` +
      `Do not claim to have checked anything that is not in these sources.`
  };
}

function startModel(model, messages, mode, sources = []) {
  const requestId = makeId();

  activeRequest = {
    id: requestId,
    text: "",
    sources,
    mode
  };

  getWorker().postMessage({
    type: "generate",
    requestId,
    model,
    mode,
    messages
  });
}

async function handleMessage(text) {
  if (isBusy) return;

  const clean = text.trim();
  if (!clean) return;

  if (!currentChatId) {
    currentChatId = makeId();
  }

  setBusy(true);

  addMessage("user", clean);

  currentMessages.push({
    role: "user",
    content: clean
  });

  persistCurrentChat();

  const typingBubble = addTyping();

  try {
    // 1. GREETING MODEL
    if (isCasualChat(clean)) {
      setStatus("Greeting AI loading...");
      typingBubble.textContent = "Preparing a quick reply...";

      const recentMessages = currentMessages
        .filter(m => !m.mode)
        .slice(-4)
        .map(m => ({
          role: m.role,
          content: m.content.slice(0, 250)
        }));

      startModel("greeting", recentMessages, "greeting");
      return;
    }

    // 2. WEB RESEARCH
    if (needsResearch(clean)) {
      const deep = isDeepResearch(clean);

      setStatus(deep ? "Deep research..." : "Searching the web...");
      typingBubble.textContent = deep
        ? "Reading available sources..."
        : "Searching for the exact question...";

      const results = await researchWeb(clean);

      if (!results || !results.length) {
        removeTyping();

        addAssistantReply(
          "I couldn't access useful web sources right now. Please try again shortly.",
          [],
          "research"
        );

        setStatus("Search unavailable.");
        setBusy(false);
        return;
      }

      const researchMessage = buildResearchPrompt(
        clean,
        results,
        deep
      );

      setStatus("Analysing web sources...");
      typingBubble.textContent = "Analysing the information...";

      startModel(
        "main",
        [researchMessage],
        "research",
        results
      );

      return;
    }

    // 3. MAIN QWEN MODEL
    setStatus("Starting Qwen AI...");
    typingBubble.textContent = "Loading main AI if needed...";

    const recentMessages = currentMessages
      .filter(m => !m.mode)
      .slice(-8)
      .map(message => ({
        role: message.role,
        content: message.content.slice(0, 700)
      }));

    startModel("main", recentMessages, "normal");

  } catch (error) {
    console.error(error);

    removeTyping();

    addAssistantReply(
      "Something went wrong. Please try again."
    );

    setStatus("An error occurred.");
    setBusy(false);
  }
}

function onWorkerMessage(event) {
  const data = event.data;

  if (data.type === "status" || data.type === "progress") {
    setStatus(data.text);

    if (activeRequest) {
      const bubble = $("typingMessage")?.querySelector(".bubble");

      if (bubble) {
        bubble.textContent = data.text;
      }
    }

    return;
  }

  if (!activeRequest || data.requestId !== activeRequest.id) {
    return;
  }

  if (data.type === "token") {
    activeRequest.text += data.text;

    const bubble = $("typingMessage")?.querySelector(".bubble");

    if (bubble) {
      bubble.classList.remove("typing");
      bubble.textContent = activeRequest.text;
    }

    scrollBottom();
  }

  if (data.type === "done") {
    let answer = (data.text || activeRequest.text).trim();

    answer = answer
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim();

    const sources = activeRequest.sources || [];
    const mode = activeRequest.mode || "normal";

    removeTyping();

    if (!answer && mode === "greeting") {
      answer = greetingReply("hello");
    }

    addAssistantReply(answer, sources, mode);

    finishRequest();
    setStatus("Ready when you are.");
  }

  if (data.type === "error") {
    console.error("AGM model:", data.text);

    const wasGreeting = activeRequest.mode === "greeting";

    removeTyping();

    if (wasGreeting) {
      addAssistantReply(greetingReply("hello"));
    } else {
      addAssistantReply(
        "The AI couldn't generate a reply. Your browser may have run out of memory. Reload the page and try a shorter question."
      );
    }

    finishRequest();
    setStatus("AI error.");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = input.value;

  input.value = "";
  input.style.height = "auto";

  handleMessage(text);
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height =
    `${Math.min(input.scrollHeight, 130)}px`;
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

$("newChat").addEventListener("click", newChat);

$("clearHistory").addEventListener("click", () => {
  if (!confirm("Delete all saved AGM AI chats from this browser?")) {
    return;
  }

  chats = [];
  saveChats(chats);
  updateHistory();
  newChat();
});

$("menuButton").addEventListener("click", () => {
  $("sidebar").classList.toggle("open");
});

$("themeButton").addEventListener("click", () => {
  document.body.classList.toggle("light");

  localStorage.setItem(
    "agm_ai_theme",
    document.body.classList.contains("light")
      ? "light"
      : "dark"
  );
});

document.querySelectorAll(".suggestion").forEach(button => {
  button.addEventListener("click", () => {
    handleMessage(button.dataset.prompt || "");
  });
});

if (localStorage.getItem("agm_ai_theme") === "light") {
  document.body.classList.add("light");
}

updateHistory();
newChat();
