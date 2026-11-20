
import {
  pipeline,
  env,
  TextStreamer
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";

env.allowLocalModels = false;
env.allowRemoteModels = true;

// Conservative WASM thread setting
env.backends.onnx.wasm.numThreads = 1;

let generator = null;
let loadingPromise = null;
let busy = false;

function sendStatus(text) {
  self.postMessage({ type: "status", text });
}

async function loadModel() {
  if (generator) return generator;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    sendStatus("Loading local AI model...");

    const model = await pipeline(
      "text-generation",
      MODEL_ID,
      {
        dtype: "q4",
        progress_callback: (progress) => {
          if (progress.status === "progress") {
            self.postMessage({
              type: "progress",
              text: `Downloading model: ${Math.round(progress.progress || 0)}%`
            });
          } else if (progress.status === "downloading") {
            sendStatus("Downloading model files...");
          } else if (progress.status === "done") {
            sendStatus("Preparing model...");
          }
        }
      }
    );

    generator = model;

    sendStatus("Local AI ready");
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

  if (data.type !== "generate") return;
  if (busy) return;

  busy = true;

  const requestId = data.requestId;
  let answer = "";

  try {
    sendStatus("Preparing AI...");

    const model = await loadModel();

    sendStatus("Generating answer...");

    const streamer = new TextStreamer(model.tokenizer, {
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

    await model(data.messages, {
      max_new_tokens: 64,
      do_sample: false,
      repetition_penalty: 1.1,
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
      text: error?.message || "AI generation failed."
    });

  } finally {
    busy = false;
  }
});
