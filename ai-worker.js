
import { pipeline, env, TextStreamer } from
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

const MODEL_ID = "onnx-community/SmolLM2-135M-Instruct-ONNX";

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.backends.onnx.wasm.numThreads = 1;

let generator = null;
let loadingPromise = null;
let busy = false;

async function loadModel() {
  if (generator) return generator;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    self.postMessage({
      type: "status",
      text: "Downloading small AI model..."
    });

    const pipe = await pipeline("text-generation", MODEL_ID, {
      dtype: "q4",
      progress_callback: (progress) => {
        if (progress.status === "progress") {
          self.postMessage({
            type: "progress",
            text: `Model download: ${Math.round(progress.progress || 0)}%`
          });
        } else if (progress.status === "done") {
          self.postMessage({
            type: "status",
            text: "Preparing local AI..."
          });
        }
      }
    });

    generator = pipe;

    self.postMessage({
      type: "status",
      text: "Local AI ready."
    });

    return pipe;
  })();

  try {
    return await loadingPromise;
  } catch (error) {
    loadingPromise = null;
    generator = null;
    throw error;
  }
}

self.addEventListener("message", async (event) => {
  const data = event.data;

  if (data.type !== "generate" || busy) return;

  busy = true;
  const requestId = data.requestId;
  let answer = "";

  try {
    const pipe = await loadModel();

    const messages = [
      {
        role: "system",
        content:
          "You are AGM AI, a friendly assistant made by AGM Studio. " +
          "Be natural, polite, concise and conversational. " +
          "Do not claim to have searched the web. " +
          "Do not invent facts. If you do not know something, say so. " +
          "Use simple language and reply in the user's language when possible. " +
          "Never repeat your name unnecessarily."
      },
      ...data.messages
    ];

    const streamer = new TextStreamer(pipe.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,

      callback_function: (chunk) => {
        if (!chunk) return;

        answer += chunk;

        self.postMessage({
          type: "token",
          requestId,
          text: chunk
        });
      }
    });

    await pipe(messages, {
      max_new_tokens: 100,
      do_sample: false,
      repetition_penalty: 1.15,
      streamer
    });

    self.postMessage({
      type: "done",
      requestId,
      text: answer.trim()
    });

  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      text: error?.message || "Local AI generation failed."
    });
  } finally {
    busy = false;
  }
});
