import Anthropic from "@anthropic-ai/sdk";
import { getApiKeys } from "./storage";
import { AiProvider } from "./types";

const MODEL = "claude-sonnet-4-6";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

async function resolveAnthropicKey(): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const stored = await getApiKeys();
  if (stored.anthropic) return stored.anthropic;
  throw new Error("ANTHROPIC_API_KEY is not set. Add it under Settings → API keys.");
}

async function resolveOpenAiKey(): Promise<string> {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const stored = await getApiKeys();
  if (stored.openai) return stored.openai;
  throw new Error("OPENAI_API_KEY is not set. Add it under Settings → API keys.");
}

const GROK_SYSTEM = `You write short, provocative reply tweets that tag @grok and ask it a single sharp question about the user's own tweet.

Goal: surface a substantive contrarian angle so Grok writes a thoughtful response and the thread gets engagement.

Hard rules:
- Start the reply with "@grok ".
- One single question. No multi-part questions.
- Total length 220 characters or less, including "@grok ".
- No emojis. No hashtags. No quotation marks around the question.
- Don't insult the original poster, and don't fabricate facts.
- Don't quote the original tweet back.
- Don't begin with filler like "Interesting take" or "Hot take".
- Output ONLY the reply text, no preamble.`;

function clampGrokReply(text: string): string {
  let out = text.trim().replace(/^["']|["']$/g, "").trim();
  if (!/^@grok\b/i.test(out)) out = `@grok ${out}`;
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > 270) out = out.slice(0, 267).trimEnd() + "...";
  return out;
}

export interface GrokQuestionInput {
  tweetText: string;
  styleHint?: string;
  provider: AiProvider;
}

async function generateGrokViaClaude(input: GrokQuestionInput): Promise<string> {
  const apiKey = await resolveAnthropicKey();
  const anthropic = new Anthropic({ apiKey });
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: [
      { type: "text", text: GROK_SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              (input.styleHint ? `Style guidance: ${input.styleHint}\n\n` : "") +
              `The user's tweet:\n"""\n${input.tweetText}\n"""\n\nWrite the @grok reply.`,
          },
        ],
      },
    ],
  });

  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

async function generateGrokViaOpenAI(input: GrokQuestionInput): Promise<string> {
  const apiKey = await resolveOpenAiKey();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.9,
      max_tokens: 200,
      messages: [
        { role: "system", content: GROK_SYSTEM },
        {
          role: "user",
          content:
            (input.styleHint ? `Style guidance: ${input.styleHint}\n\n` : "") +
            `The user's tweet:\n"""\n${input.tweetText}\n"""\n\nWrite the @grok reply.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

export async function generateGrokQuestion(input: GrokQuestionInput): Promise<string> {
  const raw =
    input.provider === "openai"
      ? await generateGrokViaOpenAI(input)
      : await generateGrokViaClaude(input);
  return clampGrokReply(raw);
}
