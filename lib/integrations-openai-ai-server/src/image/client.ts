import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";

let cached: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (cached) return cached;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseURL) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }
  if (!apiKey) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }
  cached = new OpenAI({ apiKey, baseURL });
  return cached;
}

export async function generateImageBuffer(
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" | "1536x1024" = "1024x1024"
): Promise<Buffer> {
  const openai = getOpenAI();
  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size,
  });
  const first = response.data?.[0];
  const base64 = first?.b64_json;
  if (!base64) {
    throw new Error("OpenAI image response missing b64_json");
  }
  return Buffer.from(base64, "base64");
}

export async function editImages(
  imageFiles: string[],
  prompt: string,
  outputPath?: string
): Promise<Buffer> {
  const openai = getOpenAI();
  const images = await Promise.all(
    imageFiles.map((file) =>
      toFile(fs.createReadStream(file), file, {
        type: "image/png",
      })
    )
  );

  const response = await openai.images.edit({
    model: "gpt-image-1",
    image: images,
    prompt,
  });

  const first = response.data?.[0];
  const imageBase64 = first?.b64_json;
  if (!imageBase64) {
    throw new Error("OpenAI image edit response missing b64_json");
  }
  const imageBytes = Buffer.from(imageBase64, "base64");

  if (outputPath) {
    fs.writeFileSync(outputPath, imageBytes);
  }

  return imageBytes;
}
