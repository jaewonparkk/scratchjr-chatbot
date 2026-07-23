"use client";

import type {
  FormEvent,
  ReactNode,
} from "react";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import styles from "./page.module.css";

type ChatSource = {
  chunkId: string;
  title: string;
  file: string;
  page: number | null;
  slide: number | null;
  section: string;
  similarity: number;
};

type ChatImage = {
  url: string;
  path: string;
  caption: string;
  sourceFile: string;
  page: number | null;
  slide: number | null;
};

type ChatMessage = {
  id: string;
  role:
    | "user"
    | "assistant";
  text: string;
  sources?: ChatSource[];
  images?: ChatImage[];
};

type ChatApiResponse = {
  answer?: string;
  reply?: string;
  grounded?: boolean;
  sources?: ChatSource[];
  images?: ChatImage[];
  error?: string;
};

function createMessageId(): string {
  return [
    Date.now(),
    Math.random()
      .toString(16)
      .slice(2),
  ].join("-");
}

function renderMessageText(
  text: string,
): ReactNode {
  const normalizedMarkdown =
    text.replace(
      /^#{1,6}\s+(.+)$/gm,
      "**$1**",
    );

  return normalizedMarkdown
    .split(
      /(\*\*[\s\S]+?\*\*)/g,
    )
    .map((part, index) => {
      if (
        part.startsWith("**") &&
        part.endsWith("**")
      ) {
        return (
          <strong key={index}>
            {part.slice(2, -2)}
          </strong>
        );
      }

      return part;
    });
}

export default function Home() {
  const [
    messages,
    setMessages,
  ] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text:
        "Hello! Ask me a question about ScratchJr, micro:bit, or robotics.",
    },
  ]);

  const [
    input,
    setInput,
  ] = useState("");

  const [
    isLoading,
    setIsLoading,
  ] = useState(false);

  const messagesEndRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const abortControllerRef =
    useRef<AbortController | null>(
      null,
    );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [
    messages,
    isLoading,
  ]);

  useEffect(
    () => () => {
      abortControllerRef.current
        ?.abort();
    },
    [],
  );

  function stopGenerating() {
    abortControllerRef.current
      ?.abort();
  }

  async function handleSubmit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const question =
      input.trim();

    if (
      !question ||
      isLoading
    ) {
      return;
    }

    const userMessage:
      ChatMessage = {
      id:
        createMessageId(),
      role: "user",
      text: question,
    };

    setMessages(
      (currentMessages) => [
        ...currentMessages,
        userMessage,
      ],
    );

    setInput("");
    setIsLoading(true);

    const controller =
      new AbortController();

    abortControllerRef.current =
      controller;

    try {
      const response =
        await fetch(
          "/api/chat",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            signal:
              controller.signal,

            body:
              JSON.stringify({
                question,
                history: messages
                  .filter(
                    (message) =>
                      message.id !==
                      "welcome",
                  )
                  .slice(-12)
                  .map((message) => ({
                    role: message.role,
                    content:
                      message.text,
                  })),
              }),
          },
        );

      const data =
        (await response.json()) as
          ChatApiResponse;

      if (!response.ok) {
        throw new Error(
          data.error ??
            "The assistant could not answer.",
        );
      }

      const answer =
        data.answer ??
        data.reply ??
        "No answer was returned.";

      const assistantMessage:
        ChatMessage = {
        id:
          createMessageId(),

        role:
          "assistant",

        text:
          answer,

        sources:
          Array.isArray(
            data.sources,
          )
            ? data.sources
            : [],

        images:
          Array.isArray(
            data.images,
          )
            ? data.images
            : [],
      };

      setMessages(
        (currentMessages) => [
          ...currentMessages,
          assistantMessage,
        ],
      );
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return;
      }

      const errorMessage =
        error instanceof Error
          ? error.message
          : "The assistant could not answer.";

      setMessages(
        (currentMessages) => [
          ...currentMessages,
          {
            id:
              createMessageId(),

            role:
              "assistant",

            text:
              errorMessage,
          },
        ],
      );
    } finally {
      if (
        abortControllerRef.current ===
        controller
      ) {
        abortControllerRef.current =
          null;

        setIsLoading(false);
      }
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.chat}>
        <header className={styles.header}>
          <h1>
            Blocks &amp; Bots Assistant
          </h1>

          <p>
            ScratchJr, micro:bit, and
            robotics help
          </p>
        </header>

        <div className={styles.messages}>
          {messages.map(
            (message) => (
              <article
                key={message.id}
                className={[
                  styles.messageRow,

                  message.role ===
                  "user"
                    ? styles.userRow
                    : styles.assistantRow,
                ].join(" ")}
              >
                <div
                  className={[
                    styles.message,

                    message.role ===
                    "user"
                      ? styles.userMessage
                      : styles.assistantMessage,
                  ].join(" ")}
                >
                  <p
                    className={
                      styles.messageText
                    }
                  >
                    {renderMessageText(
                      message.text,
                    )}
                  </p>

                  {message.images &&
                  message.images.length >
                    0 ? (
                    <div
                      className={
                        styles.imageList
                      }
                    >
                      {message.images.map(
                        (image) => (
                          <figure
                            key={
                              image.path
                            }
                            className={
                              styles.imageCard
                            }
                          >
                            <img
                              src={
                                image.url
                              }
                              alt={
                                image.caption
                              }
                              title={
                                image.caption
                              }
                              className={
                                styles.sourceImage
                              }
                            />
                          </figure>
                        ),
                      )}
                    </div>
                  ) : null}

                  {message.sources &&
                  message.sources.length >
                    0 ? (
                    <details
                      className={
                        styles.sources
                      }
                    >
                      <summary>
                        Sources
                      </summary>

                      <div
                        className={
                          styles.sourceList
                        }
                      >
                        {message.sources.map(
                          (source) => {
                            const location =
                              source.page !==
                              null
                                ? `Page ${source.page}`
                                : source.slide !==
                                    null
                                  ? `Slide ${source.slide}`
                                  : source.section;

                            return (
                              <div
                                key={[
                                  source.chunkId,
                                  source.page,
                                  source.slide,
                                ].join("-")}
                                className={
                                  styles.sourceItem
                                }
                              >
                                <strong>
                                  {
                                    source.title
                                  }
                                </strong>

                                <span>
                                  {
                                    source.file
                                  }

                                  {location
                                    ? ` — ${location}`
                                    : ""}
                                </span>
                              </div>
                            );
                          },
                        )}
                      </div>
                    </details>
                  ) : null}
                </div>
              </article>
            ),
          )}

          {isLoading ? (
            <article
              className={[
                styles.messageRow,
                styles.assistantRow,
              ].join(" ")}
            >
              <div
                className={[
                  styles.message,
                  styles.assistantMessage,
                  styles.loadingMessage,
                ].join(" ")}
              >
                Preparing your answer...
              </div>
            </article>
          ) : null}

          <div
            ref={messagesEndRef}
          />
        </div>

        <form
          className={styles.form}
          onSubmit={handleSubmit}
        >
          <input
            className={styles.input}
            value={input}
            onChange={(event) => {
              setInput(
                event.target.value,
              );
            }}
            placeholder="Ask a question..."
            disabled={isLoading}
          />

          {isLoading ? (
            <button
              className={[
                styles.button,
                styles.stopButton,
              ].join(" ")}
              type="button"
              onClick={
                stopGenerating
              }
              aria-label="Stop generating"
            >
              <span
                className={
                  styles.stopIcon
                }
                aria-hidden="true"
              />
              Stop
            </button>
          ) : (
            <button
              className={styles.button}
              type="submit"
              disabled={
                !input.trim()
              }
            >
              Send
            </button>
          )}
        </form>
      </section>
    </main>
  );
}
