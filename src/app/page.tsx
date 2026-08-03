"use client";

import type {
  ChangeEvent,
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

type ResearcherFile = {
  name: string;
  size: number;
  savedAt: string;
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

  const [activeTab, setActiveTab] =
    useState<"assistant" | "researcher">(
      "assistant",
    );

  const [researcherFiles, setResearcherFiles] =
    useState<ResearcherFile[]>([]);

  const [isUploading, setIsUploading] =
    useState(false);

  const [uploadMessage, setUploadMessage] =
    useState("");

  const [uploadError, setUploadError] =
    useState("");

  const [trainingFile, setTrainingFile] =
    useState<string | null>(null);

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

  useEffect(() => {
    async function loadResearcherFiles() {
      try {
        const response = await fetch(
          "/api/researcher/files",
          { cache: "no-store" },
        );

        const data = (await response.json()) as {
          files?: ResearcherFile[];
        };

        if (
          response.ok &&
          Array.isArray(data.files)
        ) {
          setResearcherFiles(data.files);
        }
      } catch {
        // The chat remains usable if the local file list fails.
      }
    }

    void loadResearcherFiles();
  }, []);

  async function uploadResearchFile(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file || isUploading) {
      return;
    }

    setIsUploading(true);
    setUploadMessage("");
    setUploadError("");

    try {
      const formData = new FormData();
      formData.set("file", file);

      const response = await fetch(
        "/api/researcher/files",
        {
          method: "POST",
          body: formData,
        },
      );

      const data = (await response.json()) as {
        file?: ResearcherFile;
        error?: string;
      };

      if (!response.ok || !data.file) {
        throw new Error(
          data.error ??
            "Could not save the file.",
        );
      }

      setResearcherFiles((currentFiles) => [
        data.file as ResearcherFile,
        ...currentFiles,
      ]);

      setUploadMessage(
        `${data.file.name} saved. Select Train to add it to the assistant.`,
      );
    } catch (error: unknown) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "Could not save the file.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function trainResearchFile(fileName: string) {
    if (trainingFile) return;

    setTrainingFile(fileName);
    setUploadMessage("");
    setUploadError("");

    try {
      const response = await fetch("/api/researcher/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Training failed.");
      setUploadMessage(`${fileName} is now available to the assistant.`);
    } catch (error: unknown) {
      setUploadError(error instanceof Error ? error.message : "Training failed.");
    } finally {
      setTrainingFile(null);
    }
  }

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
      <div className={styles.workspace}>
        <nav
          className={styles.tabs}
          aria-label="Blocks and Bots tools"
        >
          <button
            type="button"
            className={
              activeTab === "assistant"
                ? styles.activeTab
                : styles.tab
            }
            onClick={() => {
              setActiveTab("assistant");
            }}
          >
            Assistant
          </button>

          <button
            type="button"
            className={
              activeTab === "researcher"
                ? styles.activeTab
                : styles.tab
            }
            onClick={() => {
              setActiveTab("researcher");
            }}
          >
            Researcher
          </button>
        </nav>

        {activeTab === "researcher" ? (
        <section className={styles.researcher}>
          <div>
            <span className={styles.eyebrow}>
              Knowledge workspace
            </span>

            <h2>Researcher</h2>

            <p>
              Train the assistant with a new
              classroom file.
            </p>
          </div>

          <label className={styles.uploadButton}>
            {isUploading
              ? "Saving..."
              : "Choose a file"}

            <input
              type="file"
              accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
              disabled={isUploading}
              onChange={uploadResearchFile}
            />
          </label>

          <p className={styles.fileHint}>
            PDF, DOCX, PPTX, or image · max 25 MB
          </p>

          {uploadMessage ? (
            <p className={styles.uploadSuccess}>
              {uploadMessage}
            </p>
          ) : null}

          {uploadError ? (
            <p className={styles.uploadError}>
              {uploadError}
            </p>
          ) : null}

          <div className={styles.researcherFiles}>
            <h3>Saved files</h3>

            {researcherFiles.length === 0 ? (
              <p className={styles.emptyFiles}>
                No Researcher files yet.
              </p>
            ) : (
              researcherFiles.map((file) => (
                <div
                  className={styles.researcherFile}
                  key={`${file.name}-${file.savedAt}`}
                >
                  <div className={styles.fileInfo}>
                    <strong>{file.name}</strong>
                    <span>
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.trainButton}
                    disabled={trainingFile !== null}
                    onClick={() => { void trainResearchFile(file.name); }}
                  >
                    {trainingFile === file.name ? "Training..." : "Train"}
                  </button>
                </div>
              ))
            )}
          </div>

          <div className={styles.pipelineNote}>
            <strong>No terminal needed</strong>
            <span>Select Train and the server will process and index the file automatically.</span>
          </div>
        </section>
        ) : (
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
                {message.role === "assistant" ? (
                  <img
                    src="/scratchjr-cat.png"
                    alt="ScratchJr cat"
                    className={styles.catAvatar}
                  />
                ) : null}

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
              <img
                src="/scratchjr-cat.png"
                alt=""
                aria-hidden="true"
                className={styles.catAvatar}
              />

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
        )}
      </div>
    </main>
  );
}
