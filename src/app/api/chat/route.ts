import { NextResponse } from "next/server";

type ChatRequest = {
  message?: string;
};

function createTemporaryAnswer(message: string): string {
  const question = message.toLowerCase();

  if (
    question.includes("micro:bit") ||
    question.includes("microbit")
  ) {
    return (
      "For micro:bit questions, I will eventually search the " +
      "approved Blocks & Bots setup and troubleshooting documents. " +
      "The RAG system has not been connected yet."
    );
  }

  if (
    question.includes("robot") ||
    question.includes("motor")
  ) {
    return (
      "To troubleshoot the robot, first describe what you expected " +
      "to happen, what happened instead, and whether the micro:bit " +
      "and motors are receiving power."
    );
  }

  if (
    question.includes("scratchjr") ||
    question.includes("block")
  ) {
    return (
      "I can help explain ScratchJr blocks and projects. " +
      "Verified block documentation will be connected through RAG."
    );
  }

  return (
    "The chat interface and backend API are working. " +
    "Next, we will connect documentation retrieval and an AI model."
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json(
        {
          error: "A message is required.",
        },
        {
          status: 400,
        },
      );
    }

    return NextResponse.json({
      answer: createTemporaryAnswer(message),
    });
  } catch (error) {
    console.error("Chat API error:", error);

    return NextResponse.json(
      {
        error: "The server could not process the request.",
      },
      {
        status: 500,
      },
    );
  }
}