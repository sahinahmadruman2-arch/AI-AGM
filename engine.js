
const STORAGE_KEY = "agm_ai_chats_v1";

export function getChats() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveChats(chats) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chats.slice(0, 40)));
}

export function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

export function formatAnswer(text = "") {
  let safe = escapeHTML(text);
  safe = safe.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/\*(.*?)\*/g, "<em>$1</em>");
  safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
  safe = safe.replace(/\n/g, "<br>");
  return safe;
}

export function isGreeting(text) {
  const value = text.trim().toLowerCase().replace(/[!.?,]+$/g, "");
  return /^(hi|hello|hey|heyy|yo|sup|good morning|good afternoon|good evening|assalamu alaikum|salam|thanks|thank you|who are you|what are you)$/.test(value);
}

export function greetingReply(text) {
  const value = text.trim().toLowerCase();
  if (/assalamu alaikum|salam/.test(value)) {
    return "Wa alaikum assalam! 👋 I'm AGM AI. What would you like to talk about?";
  }
  if (/thank/.test(value)) return "You're welcome! 😊 What else can I help with?";
  if (/who are you|what are you/.test(value)) {
    return "I'm AGM AI, built by AGM Studio. I can chat with you and look up information from the web.";
  }
  if (/good morning/.test(value)) return "Good morning! ☀️ What are we exploring today?";
  if (/good afternoon/.test(value)) return "Good afternoon! What can I help you with?";
  if (/good evening/.test(value)) return "Good evening! How can I help today?";
  return "Hey! 👋 I'm AGM AI. What's on your mind?";
}

function cleanText(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchJSON(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Search service unavailable");
  return response.json();
}

export async function researchWeb(query) {
  const encoded = encodeURIComponent(query);
  const results = [];

  // DuckDuckGo Instant Answer
  try {
    const data = await fetchJSON(
      `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`
    );
    if (data.AbstractText) {
      results.push({
        title: cleanText(data.Heading || "DuckDuckGo summary"),
        text: cleanText(data.AbstractText),
        url: data.AbstractURL || "https://duckduckgo.com/"
      });
    }
    for (const item of (data.RelatedTopics || [])) {
      if (item.Text && item.FirstURL) {
        results.push({
          title: cleanText(item.Text.split(" - ")[0]),
          text: cleanText(item.Text),
          url: item.FirstURL
        });
      }
      if (item.Topics) {
        for (const sub of item.Topics) {
          if (sub.Text && sub.FirstURL) {
            results.push({
              title: cleanText(sub.Text.split(" - ")[0]),
              text: cleanText(sub.Text),
              url: sub.FirstURL
            });
          }
        }
      }
      if (results.length >= 5) break;
    }
  } catch (error) {
    console.warn("DuckDuckGo lookup failed:", error);
  }

  // Wikipedia search fallback / additional source
  try {
    const data = await fetchJSON(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&format=json&origin=*`
    );
    for (const item of (data.query?.search || []).slice(0, 4)) {
      const title = item.title;
      const page = await fetchJSON(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      );
      if (page.extract) {
        results.push({
          title: page.title || title,
          text: cleanText(page.extract),
          url: page.content_urls?.desktop?.page ||
            `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`
        });
      }
    }
  } catch (error) {
    console.warn("Wikipedia lookup failed:", error);
  }

  const unique = [];
  const seen = new Set();
  for (const item of results) {
    if (!item.text || seen.has(item.url)) continue;
    seen.add(item.url);
    unique.push(item);
  }
  return unique.slice(0, 6);
}

export function needsResearch(text) {
  const value = text.toLowerCase().trim();
  if (isGreeting(value)) return false;

  // Treat factual questions, explanations, named topics and current info as research.
  return true;
}
