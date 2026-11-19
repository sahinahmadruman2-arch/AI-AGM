
import {
  pipeline,
  env,
  TextStreamer
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";

env.allowLocalModels = false;
env.allowRemoteModels = true;

let generator = null;
let loadingPromise = null;
let busy = false;

async function loadModel() {
  if (generator) return generator;

  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    postMessage({
      type: "status",
      text: "Downloading and loading local AI model..."
    });

    generator = await pipeline("text-generation", MODEL_ID, {
      dtype: "q4",
      progress_callback: (progress) => {
        if (progress.status === "progress") {
          const percent = Math.round(progress.progress || 0);

          postMessage({
            type: "progress",
            text: `Loading model: ${percent}%`
          });
        } else if (progress.status === "downloading") {
          postMessage({
            type: "progress",
            text: "Downloading model files..."
          });
        } else if (progress.status === "done") {
          postMessage({
            type: "progress",
            text: "Model file ready..."
          });
        }
      }
    });

    postMessage({
      type: "ready",
      text: "Local AI ready"
    });

    return generator;
  })();

  try {
    return await loadingPromise;
  } catch (error) {
    generator = null;
    loadingPromise = null;
    throw error;
  }
}

self.addEventListener("message", async (event) => {
  const data = event.data;

  if (data.type === "load") {
    try {
      await loadModel();
    } catch (error) {
      postMessage({
        type: "error",
        text: "Model loading failed: " + error.message
      });
    }
    return;
  }

  if (data.type !== "generate" || busy) return;

  busy = true;

  const requestId = data.requestId;
  let streamedText = "";

  try {
    const model = await loadModel();

    const messages = data.messages;

    const streamer = new TextStreamer(model.tokenizer, {
      skip_prompt: true,
      callback_function: (chunk) => {
        if (!chunk) return;

        streamedText += chunk;

        postMessage({
          type: "token",
          requestId,
          text: chunk
        });
      }
    });

    await model(messages, {
      max_new_tokens: 160,
      temperature: 0.7,
      do_sample: true,
      repetition_penalty: 1.1,
      streamer
    });

    postMessage({
      type: "done",
      requestId,
      text: streamedText.trim()
    });

  } catch (error) {
    postMessage({
      type: "error",
      requestId,
      text: error.message || "Unknown AI error"
    });
  } finally {
    busy = false;
  }
});
