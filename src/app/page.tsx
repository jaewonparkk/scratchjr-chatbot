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
  id: string;
  name: string;
  size: number;
  savedAt: string;
  origin: "researcher" | "library";
  status: "saved" | "trained" | "untrained" | "existing";
};

type ResearcherMessage = {
  role: "user" | "assistant";
  text: string;
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
        "Hello! I'm the Blocks & Bots Assistant for teachers. Ask me a question about ScratchJr, micro:bit, or robotics.",
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

  const [researcherView, setResearcherView] =
    useState<"files" | "improve">("files");

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

  const [selectedResearcherFile, setSelectedResearcherFile] =
    useState("");

  const [researcherQuestion, setResearcherQuestion] =
    useState("");

  const [researcherMessages, setResearcherMessages] =
    useState<ResearcherMessage[]>([]);

  const [isCheckingFile, setIsCheckingFile] =
    useState(false);

  const [isSavingCorrection, setIsSavingCorrection] =
    useState(false);

  const [latestFeedback, setLatestFeedback] =
    useState<{ question: string; answer: string } | null>(null);

  const [desiredAnswer, setDesiredAnswer] =
    useState("");

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
      const file = researcherFiles.find((item) => item.name === fileName);
      if (!file) throw new Error("Could not find the selected file.");

      const response = await fetch("/api/researcher/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, filePath: file.id }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Training failed.");
      setUploadMessage(`${fileName} is now available to the assistant.`);
      setSelectedResearcherFile(fileName);
      setResearcherFiles((files) =>
        files.map((file) =>
          file.name === fileName
            ? { ...file, status: "trained" }
            : file,
        ),
      );
    } catch (error: unknown) {
      setUploadError(error instanceof Error ? error.message : "Training failed.");
    } finally {
      setTrainingFile(null);
    }
  }

  async function untrainResearchFile(fileName: string) {
    if (!window.confirm(
      `Cancel training for ${fileName}?\n\nThe original file will remain, but the assistant will stop using its trained chunks. You can train it again later.`,
    )) return;

    setUploadMessage("");
    setUploadError("");

    try {
      const file = researcherFiles.find((item) => item.name === fileName);
      if (!file) throw new Error("Could not find the selected file.");

      const response = await fetch("/api/researcher/untrain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, filePath: file.id }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not untrain the file.");
      setUploadMessage(`${fileName} was removed from the assistant. The original file was kept.`);
      setResearcherFiles((files) =>
        files.map((file) =>
          file.name === fileName
            ? { ...file, status: "untrained" }
            : file,
        ),
      );
    } catch (error: unknown) {
      setUploadError(error instanceof Error ? error.message : "Could not untrain the file.");
    }
  }

  async function deleteResearchFile(fileName: string) {
    const file = researcherFiles.find((item) => item.name === fileName);
    if (!file) return;

    if (!window.confirm(
      `Permanently delete ${fileName}?\n\nThis removes the original file, trained chunks, extracted content, saved corrections, and associated generated images. It will disappear from this UI and cannot be undone.`,
    )) return;

    setUploadMessage("");
    setUploadError("");

    try {
      const response = await fetch("/api/researcher/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, filePath: file.id }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not permanently delete the file.");

      setResearcherFiles((files) => files.filter((item) => item.name !== fileName));
      if (selectedResearcherFile === fileName) {
        setSelectedResearcherFile("");
        setResearcherMessages([]);
        setLatestFeedback(null);
        setDesiredAnswer("");
      }
      setUploadMessage(`${fileName} was permanently deleted.`);
    } catch (error: unknown) {
      setUploadError(error instanceof Error ? error.message : "Could not permanently delete the file.");
    }
  }

  async function saveLatestCorrection() {
    const correction = desiredAnswer.trim();
    if (
      !selectedResearcherFile ||
      !latestFeedback ||
      correction.length < 10 ||
      isSavingCorrection
    ) return;

    if (!window.confirm(
      `Save this improved answer to ${selectedResearcherFile} and retrain the assistant?\n\nThe tested question, the assistant's answer, and your corrected answer will be kept together.`,
    )) return;

    setIsSavingCorrection(true);
    setUploadMessage("");
    setUploadError("");

    try {
      const file = researcherFiles.find((item) => item.name === selectedResearcherFile);
      if (!file) throw new Error("Could not find the selected file.");

      const response = await fetch("/api/researcher/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: selectedResearcherFile,
          filePath: file.id,
          question: latestFeedback.question,
          assistantAnswer: latestFeedback.answer,
          correctedAnswer: correction,
        }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save the correction.");

      setUploadMessage(data.message ?? "Correction saved and retrained.");
      setResearcherFiles((files) =>
        files.map((file) =>
          file.name === selectedResearcherFile
            ? { ...file, status: "trained" }
            : file,
        ),
      );
      setResearcherMessages((messages) => [
        ...messages,
        { role: "assistant", text: "Your improved answer was saved and the assistant was retrained." },
      ]);
      setDesiredAnswer("");
    } catch (error: unknown) {
      setUploadError(error instanceof Error ? error.message : "Could not save the correction.");
    } finally {
      setIsSavingCorrection(false);
    }
  }

  async function checkResearchFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = researcherQuestion.trim();
    if (!question || !selectedResearcherFile || isCheckingFile) return;

    const history = researcherMessages;
    setResearcherMessages((messages) => [...messages, { role: "user", text: question }]);
    setResearcherQuestion("");
    setIsCheckingFile(true);

    try {
      const response = await fetch("/api/researcher/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: selectedResearcherFile, question, history }),
      });
      const data = (await response.json()) as { answer?: string; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error ?? "Could not check the file.");
      setResearcherMessages((messages) => [...messages, { role: "assistant", text: data.answer as string }]);
      setLatestFeedback({ question, answer: data.answer });
      setDesiredAnswer("");
    } catch (error: unknown) {
      setResearcherMessages((messages) => [...messages, {
        role: "assistant",
        text: error instanceof Error ? error.message : "Could not check the file.",
      }]);
    } finally {
      setIsCheckingFile(false);
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
              Manage classroom files and improve
              answers with teacher feedback.
            </p>
          </div>

          <div className={styles.researcherViewTabs} role="tablist" aria-label="Researcher tools">
            <button
              type="button"
              role="tab"
              aria-selected={researcherView === "files"}
              className={researcherView === "files" ? styles.activeResearcherView : undefined}
              onClick={() => { setResearcherView("files"); }}
            >
              Files
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={researcherView === "improve"}
              className={researcherView === "improve" ? styles.activeResearcherView : undefined}
              onClick={() => { setResearcherView("improve"); }}
            >
              Improve answers
            </button>
          </div>

          <div className={styles.researcherPanel} hidden={researcherView !== "files"}>

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

          <details className={styles.researcherFiles}>
            <summary>Files ({researcherFiles.length})</summary>

            <div className={styles.researcherFileList}>
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
                      {(file.size / 1024 / 1024).toFixed(1)} MB · {file.status}
                    </span>
                  </div>
                  <div className={styles.fileActions}>
                    <a
                      className={styles.fileLink}
                      href={`/api/researcher/content?path=${encodeURIComponent(file.id)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View
                    </a>
                    <a
                      className={styles.fileLink}
                      href={`/api/researcher/content?path=${encodeURIComponent(file.id)}&download=1`}
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      className={styles.trainButton}
                      disabled={trainingFile !== null}
                      onClick={() => { void trainResearchFile(file.name); }}
                    >
                      {trainingFile === file.name
                        ? "Training..."
                        : file.status === "trained"
                          ? "Retrain"
                          : "Train"}
                    </button>
                    <button
                      type="button"
                      className={styles.cancelButton}
                      disabled={trainingFile !== null}
                      onClick={() => { void untrainResearchFile(file.name); }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.deleteButton}
                      disabled={trainingFile !== null}
                      onClick={() => { void deleteResearchFile(file.name); }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
            </div>
          </details>

          <div className={styles.pipelineNote}>
            <strong>No terminal needed</strong>
            <span>Select Train and the server will process and index the file automatically.</span>
          </div>
          </div>

          <div className={styles.researcherPanel} hidden={researcherView !== "improve"}>

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

          <section className={styles.researcherChat}>
            <div className={styles.researcherChatHeader}>
              <div>
                <h3>Check the training</h3>
                <p>Ask questions using only one trained file.</p>
              </div>
              <select
                value={selectedResearcherFile}
                onChange={(event) => {
                  setSelectedResearcherFile(event.target.value);
                  setResearcherMessages([]);
                  setLatestFeedback(null);
                  setDesiredAnswer("");
                }}
              >
                <option value="">Choose a file</option>
                {researcherFiles.filter(
                  (file) => file.status === "trained" || file.status === "existing",
                ).map((file) => (
                  <option key={file.name} value={file.name}>{file.name}</option>
                ))}
              </select>
            </div>

            <div className={styles.researcherChatMessages}>
              {researcherMessages.length === 0 ? (
                <p className={styles.researcherChatEmpty}>
                  Select a trained file, then ask for a summary or walkthrough.
                </p>
              ) : researcherMessages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={message.role === "user" ? styles.researcherUserMessage : styles.researcherAssistantMessage}
                >
                  {message.text}
                </div>
              ))}
              {isCheckingFile ? <div className={styles.researcherAssistantMessage}>Checking the full file...</div> : null}
            </div>

            <form className={styles.researcherChatForm} onSubmit={checkResearchFile}>
              <input
                value={researcherQuestion}
                onChange={(event) => { setResearcherQuestion(event.target.value); }}
                placeholder="Did the training capture every step?"
                disabled={!selectedResearcherFile || isCheckingFile}
              />
              <button type="submit" disabled={!selectedResearcherFile || !researcherQuestion.trim() || isCheckingFile}>
                Check
              </button>
            </form>

          </section>

          <section className={styles.feedbackEditor}>
            <div className={styles.feedbackHeading}>
              <span className={styles.feedbackStep}>Teacher feedback</span>
              <h3>How should the assistant answer instead?</h3>
              <p>Test an answer above, then write the response you want teachers to receive.</p>
            </div>

            <label>
              Question tested
              <textarea
                value={latestFeedback?.question ?? ""}
                placeholder="Ask a question in the chat above first."
                readOnly
              />
            </label>

            <label>
              Assistant answered
              <textarea
                value={latestFeedback?.answer ?? ""}
                placeholder="The assistant's latest answer will appear here."
                readOnly
              />
            </label>

            <label>
              I want it to answer
              <textarea
                value={desiredAnswer}
                onChange={(event) => { setDesiredAnswer(event.target.value); }}
                placeholder="Write the complete, correct answer here."
                disabled={!latestFeedback || isSavingCorrection}
              />
            </label>

            <div className={styles.feedbackActions}>
              <span>This saves the feedback with the selected file and retrains its knowledge.</span>
              <button
                type="button"
                disabled={
                  !selectedResearcherFile ||
                  !latestFeedback ||
                  desiredAnswer.trim().length < 10 ||
                  isSavingCorrection
                }
                onClick={() => { void saveLatestCorrection(); }}
              >
                {isSavingCorrection ? "Saving & retraining..." : "Save improved answer & retrain"}
              </button>
            </div>
          </section>
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
