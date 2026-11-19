
const MEMORY_KEY = "agm_ai_messages_v1";

export function loadMessages() {
  try {
    return JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveMessages(messages) {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(messages.slice(-40)));
  } catch (error) {
    console.warn("Could not save chat:", error);
  }
}

export function clearMemory() {
  localStorage.removeItem(MEMORY_KEY);
}

/* Safe calculator: supports basic arithmetic without eval(). */
function calculate(expression) {
  const input = expression.replace(/\s+/g, "");

  if (!/^[0-9+\-*/().%]+$/.test(input)) {
    throw new Error("Unsupported calculation.");
  }

  let position = 0;

  function parseExpression() {
    let value = parseTerm();

    while (input[position] === "+" || input[position] === "-") {
      const operator = input[position++];
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }

    return value;
  }

  function parseTerm() {
    let value = parseFactor();

    while (
      input[position] === "*" ||
      input[position] === "/" ||
      input[position] === "%"
    ) {
      const operator = input[position++];
      const right = parseFactor();

      if ((operator === "/" || operator === "%") && right === 0) {
        throw new Error("Cannot divide by zero.");
      }

      if (operator === "*") value *= right;
      if (operator === "/") value /= right;
      if (operator === "%") value %= right;
    }

    return value;
  }

  function parseFactor() {
    if (input[position] === "+") {
      position++;
      return parseFactor();
    }

    if (input[position] === "-") {
      position++;
      return -parseFactor();
    }

    if (input[position] === "(") {
      position++;
      const value = parseExpression();

      if (input[position] !== ")") {
        throw new Error("Missing closing bracket.");
      }

      position++;
      return value;
    }

    const start = position;

    while (/[0-9.]/.test(input[position] || "")) position++;

    if (start === position) throw new Error("Invalid number.");

    const number = Number(input.slice(start, position));

    if (!Number.isFinite(number)) throw new Error("Invalid number.");

    return number;
  }

  const result = parseExpression();

  if (position !== input.length || !Number.isFinite(result)) {
    throw new Error("Invalid expression.");
  }

  return result;
}

export async function runTool(message) {
  const text = message.trim();

  const mathMatch = text.match(
    /(?:calculate|compute|what is|solve)\s+(.+?)\??$/i
  );

  if (mathMatch && /^[0-9+\-*/().%\s]+$/.test(mathMatch[1])) {
    try {
      return {
        type: "calculator",
        result: `${mathMatch[1]} = ${calculate(mathMatch[1])}`
      };
    } catch (error) {
      return { type: "calculator", result: error.message };
    }
  }

  const plainMath = text.match(/^([0-9+\-*/().%\s]+)\s*=?\s*\??$/);

  if (plainMath) {
    try {
      return {
        type: "calculator",
        result: `${plainMath[1].trim()} = ${calculate(plainMath[1])}`
      };
    } catch (error) {
      return { type: "calculator", result: error.message };
    }
  }

  if (/\b(current time|what time|date today|today's date|current date)\b/i.test(text)) {
    return {
      type: "datetime",
      result: new Date().toLocaleString()
    };
  }

  const conversion = text.match(
    /(\d+(?:\.\d+)?)\s*(km|kilometers?)\s+(?:to|in)\s+(m|meters?)\b/i
  );

  if (conversion) {
    const value = Number(conversion[1]) * 1000;
    return {
      type: "converter",
      result: `${conversion[1]} km = ${value} meters`
    };
  }

  return null;
}

/* Web research using public endpoints. */
export async function researchWeb(query) {
  const cleanQuery = query.trim();

  if (!cleanQuery) return [];

  const results = [];
  const seen = new Set();

  function addResult(item) {
    if (!item.title || !item.url || !item.snippet) return;

    if (seen.has(item.url)) return;

    seen.add(item.url);
    results.push(item);
  }

  // DuckDuckGo Instant Answer API
  try {
    const url =
      "https://api.duckduckgo.com/?q=" +
      encodeURIComponent(cleanQuery) +
      "&format=json&no_html=1&skip_disambig=1";

    const response = await fetch(url);

    if (response.ok) {
      const data = await response.json();

      if (data.AbstractText && data.AbstractURL) {
        addResult({
          title: data.Heading || cleanQuery,
          url: data.AbstractURL,
          snippet: data.AbstractText
        });
      }

      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics) {
          if (topic.Text && topic.FirstURL) {
            addResult({
              title: topic.Text.slice(0, 90),
              url: topic.FirstURL,
              snippet: topic.Text
            });
          }

          if (results.length >= 4) break;
        }
      }
    }
  } catch (error) {
    console.warn("DuckDuckGo search unavailable:", error);
  }

  // Wikipedia search fallback / additional results
  try {
    const url =
      "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
      encodeURIComponent(cleanQuery) +
      "&format=json&origin=*&srlimit=5";

    const response = await fetch(url);

    if (response.ok) {
      const data = await response.json();
      const pages = data.query?.search || [];

      for (const page of pages) {
        const title = page.title;

        addResult({
          title,
          url: "https://en.wikipedia.org/wiki/" +
            encodeURIComponent(title.replace(/ /g, "_")),
          snippet: page.snippet
            .replace(/<[^>]*>/g, "")
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
        });
      }
    }
  } catch (error) {
    console.warn("Wikipedia search unavailable:", error);
  }

  return results.slice(0, 6);
}
