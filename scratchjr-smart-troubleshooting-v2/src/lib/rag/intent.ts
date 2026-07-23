import "server-only";

import { GoogleGenAI } from "@google/genai";

import {
  GEMINI_MODEL_NAME,
  type ChatHistoryMessage,
} from "@/lib/rag/gemini";

export type IntentTopic =
  | "microbit-build"
  | "download-instructions"
  | "pairing"
  | "lesson"
  | "virtues"
  | "scratchjr"
  | "general"
  | "unknown";

export type IntentAction =
  | "answer"
  | "exact-step"
  | "next-step"
  | "previous-step"
  | "exact-lesson"
  | "show-image"
  | "show-image-sequence"
  | "full-guide"
  | "troubleshoot"
  | "clarify";

export type ParsedIntent = {
  normalizedQuestion: string;
  topic: IntentTopic;
  action: IntentAction;
  stepNumber: number | null;
  lessonNumber: number | null;
  wantsImage: boolean;
  imageSubject: string | null;
  components: string[];
  needsClarification: boolean;
  clarificationQuestion: string | null;
  confidence: number;
};

type ParseIntentInput = {
  question: string;
  history?: ChatHistoryMessage[];
};

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "normalizedQuestion",
    "topic",
    "action",
    "stepNumber",
    "lessonNumber",
    "wantsImage",
    "imageSubject",
    "components",
    "needsClarification",
    "clarificationQuestion",
    "confidence",
  ],
  properties: {
    normalizedQuestion: {
      type: "string",
    },
    topic: {
      type: "string",
      enum: [
        "microbit-build",
        "download-instructions",
        "pairing",
        "lesson",
        "virtues",
        "scratchjr",
        "general",
        "unknown",
      ],
    },
    action: {
      type: "string",
      enum: [
        "answer",
        "exact-step",
        "next-step",
        "previous-step",
        "exact-lesson",
        "show-image",
        "show-image-sequence",
        "full-guide",
        "troubleshoot",
        "clarify",
      ],
    },
    stepNumber: {
      anyOf: [
        {
          type: "integer",
          minimum: 1,
          maximum: 99,
        },
        {
          type: "null",
        },
      ],
    },
    lessonNumber: {
      anyOf: [
        {
          type: "integer",
          minimum: 1,
          maximum: 99,
        },
        {
          type: "null",
        },
      ],
    },
    wantsImage: {
      type: "boolean",
    },
    imageSubject: {
      anyOf: [
        {
          type: "string",
        },
        {
          type: "null",
        },
      ],
    },
    components: {
      type: "array",
      items: {
        type: "string",
      },
      maxItems: 12,
    },
    needsClarification: {
      type: "boolean",
    },
    clarificationQuestion: {
      anyOf: [
        {
          type: "string",
        },
        {
          type: "null",
        },
      ],
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
  },
} as const;

let intentClient: GoogleGenAI | null =
  null;

function getIntentClient(): GoogleGenAI {
  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is missing from .env.local.",
    );
  }

  if (!intentClient) {
    intentClient =
      new GoogleGenAI({
        apiKey,
      });
  }

  return intentClient;
}

function formatHistory(
  history: ChatHistoryMessage[],
): string {
  if (history.length === 0) {
    return "No earlier conversation.";
  }

  return history
    .slice(-10)
    .map((message) => {
      const role =
        message.role === "user"
          ? "USER"
          : "ASSISTANT";

      return `${role}: ${message.content
        .trim()
        .slice(0, 2500)}`;
    })
    .join("\n\n");
}

function isIntentTopic(
  value: unknown,
): value is IntentTopic {
  return [
    "microbit-build",
    "download-instructions",
    "pairing",
    "lesson",
    "virtues",
    "scratchjr",
    "general",
    "unknown",
  ].includes(
    String(value),
  );
}

function isIntentAction(
  value: unknown,
): value is IntentAction {
  return [
    "answer",
    "exact-step",
    "next-step",
    "previous-step",
    "exact-lesson",
    "show-image",
    "show-image-sequence",
    "full-guide",
    "troubleshoot",
    "clarify",
  ].includes(
    String(value),
  );
}

function readPositiveInteger(
  value: unknown,
): number | null {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1
  ) {
    return value;
  }

  return null;
}

function validateIntent(
  value: unknown,
  originalQuestion: string,
): ParsedIntent {
  if (
    !value ||
    typeof value !== "object"
  ) {
    throw new Error(
      "Intent parser returned an invalid object.",
    );
  }

  const record =
    value as Record<
      string,
      unknown
    >;

  if (
    !isIntentTopic(
      record.topic,
    ) ||
    !isIntentAction(
      record.action,
    )
  ) {
    throw new Error(
      "Intent parser returned an unsupported topic or action.",
    );
  }

  const components =
    Array.isArray(
      record.components,
    )
      ? record.components
          .filter(
            (
              item,
            ): item is string =>
              typeof item ===
                "string" &&
              item.trim().length >
                0,
          )
          .map((item) =>
            item.trim(),
          )
          .slice(0, 12)
      : [];

  const confidence =
    typeof record.confidence ===
      "number"
      ? Math.max(
          0,
          Math.min(
            1,
            record.confidence,
          ),
        )
      : 0;

  return {
    normalizedQuestion:
      typeof record.normalizedQuestion ===
        "string" &&
      record.normalizedQuestion.trim()
        ? record.normalizedQuestion.trim()
        : originalQuestion.trim(),

    topic:
      record.topic,

    action:
      record.action,

    stepNumber:
      readPositiveInteger(
        record.stepNumber,
      ),

    lessonNumber:
      readPositiveInteger(
        record.lessonNumber,
      ),

    wantsImage:
      record.wantsImage === true,

    imageSubject:
      typeof record.imageSubject ===
        "string" &&
      record.imageSubject.trim()
        ? record.imageSubject.trim()
        : null,

    components,

    needsClarification:
      record.needsClarification ===
      true,

    clarificationQuestion:
      typeof record.clarificationQuestion ===
        "string" &&
      record.clarificationQuestion.trim()
        ? record.clarificationQuestion.trim()
        : null,

    confidence,
  };
}

function stripCodeFence(
  text: string,
): string {
  return text
    .replace(
      /^```(?:json)?\s*/i,
      "",
    )
    .replace(
      /\s*```$/,
      "",
    )
    .trim();
}

function fallbackIntent(
  question: string,
): ParsedIntent {
  const normalizedQuestion =
    question
      .trim()
      .replace(/\s+/g, " ");

  const lower =
    normalizedQuestion.toLowerCase();

  const lessonMatch =
    lower.match(
      /\blesson\s*#?\s*(\d{1,3})\b/,
    );

  const stepMatch =
    lower.match(
      /\bstep\s*#?\s*(\d{1,3})\b/,
    );

  const wantsImage =
    /\b(image|images|picture|pictures|photo|photos|visual|visuals)\b/.test(
      lower,
    );

  const lessonNumber =
    lessonMatch
      ? Number(lessonMatch[1])
      : null;

  const stepNumber =
    stepMatch
      ? Number(stepMatch[1])
      : null;

  let topic: IntentTopic =
    "unknown";

  if (lessonNumber !== null) {
    topic = "lesson";
  } else if (
    /\b(download|install|installation)\b/.test(
      lower,
    )
  ) {
    topic =
      "download-instructions";
  } else if (
    /\b(pair|pairing)\b/.test(
      lower,
    )
  ) {
    topic = "pairing";
  } else if (
    /\b(microbit|micro:bit|breadboard|alligator|motor|led|battery|plug|socket)\b/.test(
      lower,
    )
  ) {
    topic =
      "microbit-build";
  }

  let action: IntentAction =
    "answer";

  if (lessonNumber !== null) {
    action = "exact-lesson";
  } else if (
    stepNumber !== null &&
    wantsImage
  ) {
    action = "show-image";
  } else if (
    stepNumber !== null
  ) {
    action = "exact-step";
  } else if (wantsImage) {
    action = "show-image";
  }

  const ambiguousStep =
    stepNumber !== null &&
    topic === "unknown";

  return {
    normalizedQuestion,
    topic,
    action,
    stepNumber:
      Number.isInteger(stepNumber)
        ? stepNumber
        : null,
    lessonNumber:
      Number.isInteger(
        lessonNumber,
      )
        ? lessonNumber
        : null,
    wantsImage,
    imageSubject: null,
    components: [],
    needsClarification:
      ambiguousStep,
    clarificationQuestion:
      ambiguousStep
        ? "Which guide do you mean: the micro:bit building guide or the Blocks and Bots download instructions?"
        : null,
    confidence: 0,
  };
}

export async function parseUserIntent({
  question,
  history = [],
}: ParseIntentInput): Promise<ParsedIntent> {
  const client =
    getIntentClient();

  try {
    console.info(
      `[Intent] Parsing with ${GEMINI_MODEL_NAME}`,
    );

    const response =
      await client.models.generateContent({
        model:
          GEMINI_MODEL_NAME,

        contents: [
          {
            role: "user",
            parts: [
              {
                text: [
                  "RECENT CONVERSATION",
                  "===================",
                  formatHistory(history),
                  "",
                  "CURRENT USER MESSAGE",
                  "====================",
                  question,
                ].join("\n"),
              },
            ],
          },
        ],

        config: {
          temperature: 0,
          maxOutputTokens: 700,
          responseMimeType:
            "application/json",
          responseJsonSchema:
            INTENT_SCHEMA,

          systemInstruction: [
            "You are the intent parser for the Blocks and Bots Assistant.",
            "Do not answer the user. Return only the requested JSON object.",
            "",
            "Understand ordinary spelling mistakes, missing punctuation, informal language, and short follow-up messages.",
            "Silently rewrite the user's message into a clear normalizedQuestion while preserving meaning.",
            "Use the recent conversation to resolve references such as 'step 2', 'the next one', 'that image', and 'image 1'.",
            "",
            "Important rules:",
            "1. wantsImage is true only when the user explicitly asks for an image, picture, photo, diagram, visual, or asks to see what something looks like.",
            "2. Do not set wantsImage merely because the topic normally contains images.",
            "3. A numbered curriculum lesson uses action exact-lesson and lessonNumber.",
            "4. A numbered construction or download step uses action exact-step and stepNumber.",
            "5. 'Next step' uses action next-step. Resolve stepNumber from recent conversation when possible.",
            "6. 'Previous step' uses action previous-step. Resolve stepNumber from recent conversation when possible.",
            "7. A complete construction walkthrough uses action full-guide.",
            "8. A request for all step images or images through the end uses action show-image-sequence.",
            "9. A request for one specific image uses action show-image.",
            "10. A missing, incompatible, incorrect, unavailable, or non-working component uses action troubleshoot.",
            "11. Normalize component names, including plug/plug wire, socket/socket wire, plug/socket wire, alligator clip, breadboard, LED, motor, and battery.",
            "12. Do not invent a step number, lesson number, component, or guide.",
            "13. A bare numbered step with no guide and no usable conversation context requires clarification.",
            "14. A bare image number with no usable conversation context requires clarification.",
            "",
            "Examples:",
            "- 'i only hav plig plig no soket wre' means the learner has plug/plug wires but no socket/socket wire and needs troubleshooting.",
            "- 'mircobit steop 2' means micro:bit building Step 2.",
            "- 'what is lleson 29' means curriculum Lesson 29.",
            "- After discussing micro:bit building, 'image 1' means the Step 1 build image.",
            "- In a fresh conversation, 'image 1' requires clarification.",
          ].join("\n"),
        },
      });

    const rawText =
      response.text?.trim();

    if (!rawText) {
      throw new Error(
        "Intent parser returned an empty response.",
      );
    }

    const parsed =
      JSON.parse(
        stripCodeFence(
          rawText,
        ),
      ) as unknown;

    const intent =
      validateIntent(
        parsed,
        question,
      );

    console.info(
      "[Intent] Result:",
      intent,
    );

    return intent;
  } catch (error: unknown) {
    console.error(
      "[Intent] Parsing failed:",
      error,
    );

    return fallbackIntent(
      question,
    );
  }
}
