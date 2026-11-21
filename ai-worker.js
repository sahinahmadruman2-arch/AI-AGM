
import { pipeline, env, TextStreamer } from
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

const MODELS = {
  greeting: "onnx-community/SmolLM2-135M-Instruct-ONNX-MHA",
  main: "onnx-community/Qwen3-0.6B-ONNX"
};

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;

let generator = null;
let currentModel = null;
let loadingPromise = null;
let busy = false;

async function disposeCurrentModel() {
  if (!generator) return;

  const old = generator;

  generator = null;
  currentModel = null;

  try {
    await old.dispose();
  } catch (error) {
    console.warn("Model disposal:", error);
  }
}

async function loadModel(modelType) {
  const modelId = MODELS[modelType] || MODELS.main;

  if (generator && currentModel === modelId) {
    return generator;
  }

  if (loadingPromise) {
    await loadingPromise;
  }

  if (generator && currentModel !== modelId) {
    self.postMessage({
      type: "status",
      text: "Switching AI model..."
    });

    await disposeCurrentModel();
  }

  loadingPromise = (async () => {
    self.postMessage({
      type: "status",
      text: `Loading ${modelType} model...`
    });

    const progress_callback = (progress) => {
      if (progress.status === "progress") {
        self.postMessage({
          type: "progress",
          text: `Downloading model: ${Math.round(progress.progress || 0)}%`
        });
      }
    };

    let pipe;

    // Try WebGPU first, then WASM.
    if (navigator.gpu) {
      try {
        self.postMessage({
          type: "status",
          text: "Preparing WebGPU..."
        });

        pipe = await pipeline("text-generation", modelId, {
          device: "webgpu",
          dtype: "q4f16",
          progress_callback
        });
      } catch (error) {
        console.warn("WebGPU unavailable, using WASM:", error);

        pipe = null;
      }
    }

    if (!pipe) {
      self.postMessage({
        type: "status",
        text: "Preparing low-memory mode..."
      });

      pipe = await pipeline("text-generation", modelId, {
        dtype: "q4",
        progress_callback
      });
    }

    generator = pipe;
    currentModel = modelId;

    return pipe;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

self.addEventListener("message", async (event) => {
  const data = event.data;

  if (data.type !== "generate" || busy) return;

  busy = true;

  const requestId = data.requestId;
  let answer = "";

  try {
    const modelType =
      data.model === "greeting" ? "greeting" : "main";

    const pipe = await loadModel(modelType);

    const systemPrompt = modelType === "greeting"
      ? "You are AGM AI, a friendly assistant. Reply naturally to greetings and casual small talk. Use the user's language. Keep replies short, warm and natural. Never repeat your name unnecessarily."
      : "You are AGM AI, a helpful assistant. Answer accurately, naturally and clearly. Use the user's language. Keep simple answers short. For research, synthesize the supplied sources, compare claims, mention uncertainty and include source references like [1]. Never say 'I found from research'. Never invent facts or sources. Do not reveal private internal reasoning.";

    const messages = [
      {
        role: "system",
        content: systemPrompt
      },
      ...(data.messages || [])
    ];

    const maxTokens =
      data.model === "greeting" ? 45 :
      data.mode === "research" ? 260 : 150;

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
      max_new_tokens: maxTokens,
      do_sample: false,
      repetition_penalty: 1.12,
      streamer
    });

    // Remove hidden reasoning tags if a model emits them.
    answer = answer
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<\|im_start\|>.*?<\/\|im_start\|>/g, "")
      .trim();

    self.postMessage({
      type: "done",
      requestId,
      text: answer
    });

  } catch (error) {
    console.error("AGM Worker:", error);

    self.postMessage({
      type: "error",
      requestId,
      text: error?.message || "AI generation failed."
    });

  } finally {
    busy = false;
  }
});
