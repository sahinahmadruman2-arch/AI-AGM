
/* =================================
   AGM AI — CORE ENGINE
   Version 1.0
================================= */

const $ = (id) => document.getElementById(id);

const promptInput = $("prompt");
const messages = $("messages");
const welcome = $("welcome");
const historyBox = $("history");
const chatArea = $("chatArea");
const sidebar = $("sidebar");
const overlay = $("overlay");

let chats = JSON.parse(localStorage.getItem("agm_chats") || "[]");
let currentChat = null;

// SAVE DATA

function saveChats() {
  localStorage.setItem("agm_chats", JSON.stringify(chats));
}

// CREATE CHAT

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

// GET CURRENT CHAT

function getCurrentChat() {
  return chats.find(chat => chat.id === currentChat);
}

// RENDER HISTORY

function renderHistory() {
  historyBox.innerHTML = "";

  chats.forEach(chat => {
    const item = document.createElement("div");

    item.className = "history-item" +
      (chat.id === currentChat ? " active" : "");

    item.textContent = chat.title;

    item.addEventListener("click", () => {
      currentChat = chat.id;
      renderHistory();
      renderMessages();
      closeSidebar();
    });

    historyBox.appendChild(item);
  });
}

// RENDER MESSAGES

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

// SCROLL

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatArea.scrollTo({
      top: chatArea.scrollHeight,
      behavior: "smooth"
    });
  });
}

// SEND MESSAGE

function sendMessage(text) {
  text = text.trim();

  if (!text) return;

  if (!currentChat) {
    createChat();
  }

  const chat = getCurrentChat();

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
}

// NEW CHAT BUTTON

$("newChat").addEventListener("click", createChat);

// SEND BUTTON

$("sendBtn").addEventListener("click", () => {
  sendMessage(promptInput.value);
});

// ENTER TO SEND

promptInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage(promptInput.value);
  }
});

// AUTO TEXTAREA HEIGHT

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

  const light = document.body.classList.contains("light");

  localStorage.setItem(
    "agm_theme",
    light ? "light" : "dark"
  );

  $("themeBtn").textContent = light ? "☾" : "☼";
});

// STARTUP

if (chats.length > 0) {
  currentChat = chats[0].id;
} else {
  currentChat = null;
}

renderHistory();
renderMessages();

console.log("AGM AI v1.0 initialized.");
