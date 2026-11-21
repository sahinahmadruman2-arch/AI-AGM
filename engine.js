
const STORAGE_KEY = "agm_ai_chats_v1";

export function getChats() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveChats(chats) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(chats.slice(0, 40))
    );
  } catch (error) {
    console.warn("Chat storage unavailable:", error);
  }
}

export function makeId() {
  return Date.now().toString(36) +
    Math.random().toString(36).slice(2, 7);
}

export function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
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
  const value = text.trim().toLowerCase()
    .replace(/[!.?,]+$/g, "");

  return /^(hi|hello|hey|heyy|yo|sup|good morning|good afternoon|good evening|assalamu alaikum|salam|thanks|thank you|who are you|what are you|how are you|how r u|what's up|whats up)$/.test(value);
}

export function greetingReply(text) {
  const value = text.trim().toLowerCase();

  if (/assalamu alaikum|salam/.test(value)) {
    return "Wa alaikum assalam! 👋 How can I help you today?";
  }

  if (/thank/.test(value)) {
    return "You're welcome! 😊";
  }

  if (/who are you|what are you/.test(value)) {
    return "I'm AGM AI, built by AGM Studio. What can I help you with?";
  }

  if (/good morning/.test(value)) {
    return "Good morning! ☀️";
  }

  if (/good afternoon/.test(value)) {
    return "Good afternoon!";
  }

  if (/good evening/.test(value)) {
    return "Good evening!";
  }

  if (/how are you|how r u/.test(value)) {
    return "I'm doing great! How are you?";
  }

  return "Hey! 👋 What's on your mind?";
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJSON(url, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function makeSource(title, text, url) {
  return {
    title: cleanText(title),
    text: cleanText(text),
    url
  };
}

// WEATHER

function isWeatherQuery(query) {
  return /\b(weather|temperature|forecast|rain|raining|wind speed|humidity)\b/i.test(query);
}

function getWeatherLocation(query) {
  let value = query.trim();

  // Examples: weather in Sylhet, temperature at Dhaka
  const match = value.match(
    /\b(?:in|for|at|near)\s+([a-zA-Z][a-zA-Z\s-]{1,45})/i
  );

  if (match) {
    value = match[1];
  } else {
    // Examples: Sylhet weather, Dhaka temperature
    value = value
      .replace(/\b(current|today|tomorrow|now|live|forecast|weather|temperature|rain|raining|humidity|wind speed|what is|what's|the|in|for|at|near|please)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  value = value.replace(/[?.!,]+$/g, "").trim();

  if (!value || !/[a-zA-Z]/.test(value)) {
    return null;
  }

  return value.slice(0, 45);
}

function weatherDescription(code) {
  const descriptions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    80: "Rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    95: "Thunderstorm"
  };

  return descriptions[code] || "Unknown conditions";
}

async function researchWeather(query) {
  const location = getWeatherLocation(query);

  if (!location) {
    return [{
      kind: "location_required",
      title: "Weather location needed",
      text: "The user asked for weather but did not provide a city. Ask which city they mean.",
      url: "https://open-meteo.com/"
    }];
  }

  const geoURL =
    "https://geocoding-api.open-meteo.com/v1/search?" +
    `name=${encodeURIComponent(location)}` +
    "&count=1&language=en&format=json";

  const geo = await fetchJSON(geoURL);
  const place = geo.results?.[0];

  if (!place) {
    return [{
      kind: "weather_not_found",
      title: "Location not found",
      text: `No matching weather location was found for ${location}. Ask the user to check the city name.`,
      url: "https://open-meteo.com/"
    }];
  }

  const weatherURL =
    "https://api.open-meteo.com/v1/forecast?" +
    `latitude=${place.latitude}` +
    `&longitude=${place.longitude}` +
    "&current=temperature_2m,relative_humidity_2m," +
    "apparent_temperature,precipitation,weather_code,wind_speed_10m" +
    "&timezone=auto";

  const data = await fetchJSON(weatherURL);
  const current = data.current;

  if (!current) return [];

  const report = [
    `Location: ${place.name}, ${place.country}`,
    `Temperature: ${current.temperature_2m}°C`,
    `Feels like: ${current.apparent_temperature}°C`,
    `Conditions: ${weatherDescription(current.weather_code)}`,
    `Humidity: ${current.relative_humidity_2m}%`,
    `Wind speed: ${current.wind_speed_10m} km/h`,
    `Precipitation: ${current.precipitation} mm`,
    `Observation time: ${current.time} (${data.timezone})`
  ].join("\n");

  return [
    makeSource(
      `Current weather in ${place.name}`,
      report,
      "https://open-meteo.com/"
    )
  ];
}

// DUCKDUCKGO INSTANT ANSWERS

async function searchDuckDuckGo(query) {
  const url =
    "https://api.duckduckgo.com/?" +
    `q=${encodeURIComponent(query)}` +
    "&format=json&no_html=1&skip_disambig=1";

  const data = await fetchJSON(url);
  const results = [];

  if (data.AbstractText) {
    results.push(
      makeSource(
        data.Heading || "Overview",
        data.AbstractText,
        data.AbstractURL || "https://duckduckgo.com/"
      )
    );
  }

  function collect(items) {
    for (const item of items || []) {
      if (item.Text && item.FirstURL) {
        results.push(
          makeSource(
            item.Text.split(" - ")[0],
            item.Text,
            item.FirstURL
          )
        );
      }

      if (item.Topics) {
        collect(item.Topics);
      }
    }
  }

  collect(data.RelatedTopics);

  return results;
}

// WIKIPEDIA

async function searchWikipedia(query, limit = 3) {
  const url =
    "https://en.wikipedia.org/w/api.php?" +
    "action=query&list=search" +
    `&srsearch=${encodeURIComponent(query)}` +
    `&srlimit=${limit}&format=json&origin=*`;

  const data = await fetchJSON(url);
  const pages = data.query?.search || [];

  const summaries = await Promise.all(
    pages.map(async item => {
      const pageURL =
        "https://en.wikipedia.org/api/rest_v1/page/summary/" +
        encodeURIComponent(item.title);

      try {
        const page = await fetchJSON(pageURL);

        const text = page.extract || item.snippet || "";

        if (!text) return null;

        return makeSource(
          page.title || item.title,
          text,
          page.content_urls?.desktop?.page ||
            `https://en.wikipedia.org/wiki/${encodeURIComponent(
              item.title.replace(/ /g, "_")
            )}`
        );
      } catch {
        // Keep the actual Wikipedia search snippet if summary fails.
        if (item.snippet) {
          return makeSource(
            item.title,
            item.snippet,
            `https://en.wikipedia.org/wiki/${encodeURIComponent(
              item.title.replace(/ /g, "_")
            )}`
          );
        }

        return null;
      }
    })
  );

  return summaries.filter(Boolean);
}

// REMOVE DUPLICATES

function uniqueSources(results, limit) {
  const seen = new Set();
  const unique = [];

  for (const item of results) {
    if (!item?.text || !item?.url) continue;

    const key = item.url.split("#")[0];

    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(item);

    if (unique.length >= limit) break;
  }

  return unique;
}

// MAIN RESEARCH

export async function researchWeb(query, mode = "quick") {
  const deep = mode === "deep";

  if (isWeatherQuery(query)) {
    try {
      return await researchWeather(query);
    } catch (error) {
      console.warn("Weather search failed:", error);
      return [];
    }
  }

  const wikiTask = searchWikipedia(
    query,
    deep ? 5 : 3
  ).catch(error => {
    console.warn("Wikipedia search failed:", error);
    return [];
  });

  const ddgTask = searchDuckDuckGo(query)
    .catch(error => {
      console.warn("DuckDuckGo search failed:", error);
      return [];
    });

  const [wikiResults, ddgResults] = await Promise.all([
    wikiTask,
    ddgTask
  ]);

  // Prefer direct instant answers, then Wikipedia.
  return uniqueSources(
    [...ddgResults, ...wikiResults],
    deep ? 7 : 4
  );
}

// RESEARCH ROUTING

export function needsResearch(text) {
  const value = text.toLowerCase().trim();

  if (isGreeting(value)) return false;

  // Deep research questions
  if (
    /\b(deep research|research deeply|in detail|detailed explanation|comprehensive|full guide|latest research|compare in detail|explain deeply|how does .+ work|how .+ works|why does .+ happen|step by step)\b/i.test(value)
  ) {
    return true;
  }

  // Current information
  if (
    /\b(weather|temperature|forecast|rain|raining|right now|currently|today|latest|current|live|breaking news|stock price|exchange rate|news today)\b/i.test(value)
  ) {
    return true;
  }

  // Direct factual questions
  if (
    /^(what is|what are|who is|who are|where is|where are|when is|when was|who was|why is|why are|how does|how do|how is|how are|define|search for|find|look up|tell me about|explain)\b/i.test(value)
  ) {
    return true;
  }

  // Specific factual questions
  if (
    /\b(population of|capital of|president of|price of|release date|version of|history of|meaning of|who created|who invented|who founded|when did|how many)\b/i.test(value)
  ) {
    return true;
  }

  return false;
}
