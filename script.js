
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

    worker.addEventListener("error", () => {
      setStatus("Local AI worker stopped. Please try again.");
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
    heading.textContent = "WEB SOURCES";
    sourceBox.appendChild(heading);

    sources.forEach((source, index) => {
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `${index + 1}. ${source.title}`;
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
  $("typingMessage")?.remove();
  setBusy(false);
  activeRequest = null;
}

function addAssistantReply(text, sources = []) {
  const reply = text.trim() ||
    "I couldn't generate a reply. Please try again.";

  addMessage("assistant", reply, sources);

  currentMessages.push({
    role: "assistant",
    content: reply,
    sources
  });

  persistCurrentChat();
}

function isCasualChat(text) {
  const value = text.toLowerCase().trim();

  return (
    isGreeting(value) ||
    /^(tell me a joke|make me laugh|say something funny|how are you|what's up|whats up|are you there|let's chat|lets chat|talk to me)\??$/.test(value)
  );
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
    if (isGreeting(clean)) {
      setStatus("AGM greeting engine");

      removeTyping();

      addAssistantReply(greetingReply(clean));

      setStatus("Ready when you are.");
      return;
    }

    if (needsResearch(clean) && !isCasualChat(clean)) {
      setStatus("Researching the web...");
      typingBubble.textContent =
        "Searching available web sources...";

      const results = await researchWeb(clean);

      removeTyping();

      if (!results.length) {
        addAssistantReply(
          "I couldn't retrieve reliable results for that question right now. Public search services may be unavailable or may not support this query. Please try again later."
        );

        setStatus("Research unavailable.");
        return;
      }

      const summary = results
        .map((item, index) =>
          `${index + 1}. **${item.title}**\n${item.text}`
        )
        .join("\n\n");

      const answer =
        "I found these web results:\n\n" +
        summary +
        "\n\nThis is a source-based lookup, not a fully verified report. Check the links below for details.";

      addAssistantReply(answer, results);

      setStatus(`Found ${results.length} source result(s).`);
      return;
    }

    setStatus("Starting local AI...");
    typingBubble.textContent =
      "Loading local AI if needed...";

    const requestId = makeId();

    activeRequest = {
      id: requestId,
      bubble: typingBubble,
      text: ""
    };

    const recentMessages = currentMessages
      .slice(-6)
      .map(message => ({
        role: message.role,
        content: message.content.slice(0, 500)
      }));

    getWorker().postMessage({
      type: "generate",
      requestId,
      messages: recentMessages
    });

  } catch (error) {
    console.error(error);

    removeTyping();

    addAssistantReply(
      "Something went wrong while processing that request. Please try again."
    );

    setStatus("An error occurred.");

  } finally {
    if (!activeRequest) {
      setBusy(false);
    }
  }
}

function removeTyping() {
  $("typingMessage")?.remove();
}

function onWorkerMessage(event) {
  const data = event.data;

  if (data.type === "status" || data.type === "progress") {
    setStatus(data.text);

    if (activeRequest) {
      activeRequest.bubble.textContent = data.text;
    }

    return;
  }

  if (!activeRequest || data.requestId !== activeRequest.id) {
    return;
  }

  if (data.type === "token") {
    activeRequest.text += data.text;
    activeRequest.bubble.textContent = activeRequest.text;
    scrollBottom();
  }

  if (data.type === "done") {
    const answer = data.text || activeRequest.text;

    removeTyping();
    addAssistantReply(answer);

    finishRequest();
    setStatus("Ready when you are.");
  }

  if (data.type === "error") {
    console.error("AGM local model:", data.text);

    removeTyping();

    addAssistantReply(
      "The local AI couldn't generate a reply. Your browser may have run out of memory, or the model download may have failed. Try reloading the page and sending a shorter message."
    );

    finishRequest();
    setStatus("Local AI error.");
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
