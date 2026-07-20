"use client";

import { FormEvent, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function Home() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hello! Ask me a question about ScratchJr, micro:bit, or robotics.",
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedQuestion = question.trim();

    if (!trimmedQuestion || isLoading) {
      return;
    }

    const userMessage: Message = {
      role: "user",
      content: trimmedQuestion,
    };

    setMessages((currentMessages) => [
      ...currentMessages,
      userMessage,
    ]);

    setQuestion("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmedQuestion,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "The request failed.");
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: data.answer,
      };

      setMessages((currentMessages) => [
        ...currentMessages,
        assistantMessage,
      ]);
    } catch (error) {
      console.error(error);

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content:
            "Sorry, I could not process your question. Please try again.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="chat-page">
      <section className="chatbot">
        <header className="chatbot-header">
          <h1>Blocks &amp; Bots Assistant</h1>
          <p>ScratchJr, micro:bit, and robotics help</p>
        </header>

        <div className="chat-messages">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`message message-${message.role}`}
            >
              {message.content}
            </div>
          ))}

          {isLoading && (
            <div className="message message-assistant">
              Thinking...
            </div>
          )}
        </div>

        <form
          className="chat-input-form"
          onSubmit={handleSubmit}
        >
          <input
            type="text"
            placeholder="Ask a question..."
            value={question}
            onChange={(event) =>
              setQuestion(event.target.value)
            }
            disabled={isLoading}
          />

          <button
            type="submit"
            disabled={!question.trim() || isLoading}
          >
            Send
          </button>
        </form>
      </section>
    </main>
  );
}