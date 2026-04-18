/**
 * LLM Message type
 */
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
