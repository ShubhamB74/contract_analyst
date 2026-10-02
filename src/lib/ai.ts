import OpenAI from "openai";
import { config } from "./config";

export function getClient() {
  if (!config.ai.apiKey) {
    throw new Error("AI_API_KEY is not set. Copy .env.example to .env and fill it in.");
  }
  return new OpenAI({ apiKey: config.ai.apiKey, baseURL: config.ai.baseURL });
}
