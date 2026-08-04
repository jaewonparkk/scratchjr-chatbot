"use client";

import type {
  ChangeEvent,
  DragEvent,
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

type PracticeMessage = ResearcherMessage & {
  improvable?: boolean;
};

function createMessageId(): string {
  return [
    Date.now(),
    Math.random()
      .toString(16)
      .slice(2),
  ].join("-");
}

function normalizeLearnedQuestion(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findLearnedCorrection(
  question: string,
  corrections: Record<string, string>,
): string | undefined {
  return corrections[normalizeLearnedQuestion(question)];
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
    useState<"assistant" | "researcher" | "practice">(
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

  const [improveQuestion, setImproveQuestion] =
    useState("");

  const [improveMessages, setImproveMessages] =
    useState<ResearcherMessage[]>([]);

  const [isTestingImprovement, setIsTestingImprovement] =
    useState(false);

  const [latestFeedback, setLatestFeedback] =
    useState<{ question: string; answer: string } | null>(null);

  const [desiredAnswer, setDesiredAnswer] =
    useState("");

  const [proposedAnswer, setProposedAnswer] =
    useState("");

  const [isPreviewingImprovement, setIsPreviewingImprovement] =
    useState(false);

  const [awaitingImprovementConfirmation, setAwaitingImprovementConfirmation] =
    useState(false);

  const [learnedCorrections, setLearnedCorrections] =
    useState<Record<string, string>>({});

  const [practiceMessages, setPracticeMessages] =
    useState<PracticeMessage[]>([
      {
        role: "assistant",
        text: "Welcome to Researcher 2. Add a file with the + button, train it, and ask me to check what the assistant learned.",
      },
    ]);

  const [practiceInput, setPracticeInput] =
    useState("");

  const [practiceSelectedFile, setPracticeSelectedFile] =
    useState("");

  const [practiceMenuOpen, setPracticeMenuOpen] =
    useState(false);

  const [practiceFilesOpen, setPracticeFilesOpen] =
    useState(false);

  const [isPracticeBusy, setIsPracticeBusy] =
    useState(false);

  const [isPracticeGenerating, setIsPracticeGenerating] =
    useState(false);

  const [isPracticeDragging, setIsPracticeDragging] =
    useState(false);

  const [practicePendingImprovement, setPracticePendingImprovement] =
    useState<{
      question: string;
      originalAnswer: string;
      correctedAnswer: string;
      feedback: string;
    } | null>(null);

  const [practiceAwaitingConfirmation, setPracticeAwaitingConfirmation] =
    useState(false);

  const [practiceImprovementsOpen, setPracticeImprovementsOpen] =
    useState(false);

  const [practiceImprovementTarget, setPracticeImprovementTarget] =
    useState<{ question: string; answer: string } | null>(null);

  const [practiceFeedbackInput, setPracticeFeedbackInput] =
    useState("");

  const messagesEndRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const abortControllerRef =
    useRef<AbortController | null>(
      null,
    );

  const practiceAbortControllerRef =
    useRef<AbortController | null>(
      null,
    );

  const practiceSaveInFlightRef =
    useRef(false);

  const practiceFileInputRef =
    useRef<HTMLInputElement | null>(null);

  const improveHistoryReadyRef =
    useRef(false);

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
      practiceAbortControllerRef.current
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

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("blocks-bots-improve-chat");
      if (saved) setImproveMessages(JSON.parse(saved) as ResearcherMessage[]);
    } catch {
      // Begin a new conversation if saved chat history is unavailable.
    }
  }, []);

  useEffect(() => {
    if (!improveHistoryReadyRef.current) {
      improveHistoryReadyRef.current = true;
      return;
    }
    try {
      window.localStorage.setItem(
        "blocks-bots-improve-chat",
        JSON.stringify(improveMessages.slice(-100)),
      );
    } catch {
      // Keep the conversation in memory for this session.
    }
  }, [improveMessages]);

  useEffect(() => {
    async function loadTeacherCorrections() {
      let browserCorrections: Record<string, string> = {};
      try {
        const saved = window.localStorage.getItem("blocks-bots-teacher-corrections");
        if (saved) browserCorrections = JSON.parse(saved) as Record<string, string>;
      } catch {
        // Continue with the server copy.
      }

      try {
        const response = await fetch("/api/researcher/corrections", { cache: "no-store" });
        const data = (await response.json()) as { corrections?: Record<string, string> };
        if (!response.ok || !data.corrections) throw new Error("Could not load saved improvements.");
        setLearnedCorrections(data.corrections);
        window.localStorage.setItem(
          "blocks-bots-teacher-corrections",
          JSON.stringify(data.corrections),
        );
      } catch {
        setLearnedCorrections(browserCorrections);
      }
    }

    void loadTeacherCorrections();
  }, []);

  useEffect(() => {
    const firstAvailableFile = researcherFiles.find(
      (file) => file.status === "trained" || file.status === "existing",
    ) ?? researcherFiles[0];
    if (!firstAvailableFile) return;

    if (!selectedResearcherFile) {
      setSelectedResearcherFile(firstAvailableFile.name);
    }
  }, [researcherFiles, selectedResearcherFile]);

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
      `Remove ${fileName} from the assistant's trained knowledge?\n\nThe original file will remain and can be trained again later.`,
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

  async function previewImprovement(instruction = desiredAnswer) {
    const feedbackInstruction = instruction.trim();
    if (!feedbackInstruction || isPreviewingImprovement) return;

    setIsPreviewingImprovement(true);
    setUploadMessage("");
    setUploadError("");
    try {
      const response = await fetch("/api/researcher/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "preview",
          question: latestFeedback?.question,
          assistantAnswer: latestFeedback?.answer,
          feedbackInstruction,
          history: improveMessages,
        }),
      });
      const data = (await response.json()) as {
        question?: string;
        assistantAnswer?: string;
        correctedAnswer?: string;
        error?: string;
      };
      if (!response.ok || !data.question || !data.assistantAnswer || !data.correctedAnswer) {
        throw new Error(data.error ?? "Could not update the answer.");
      }
      setLatestFeedback({ question: data.question, answer: data.assistantAnswer });
      setProposedAnswer(data.correctedAnswer);
    } catch (error: unknown) {
      setUploadError(error instanceof Error ? error.message : "Could not update the answer.");
    } finally {
      setIsPreviewingImprovement(false);
    }
  }

  function applyProposedAnswer(answer: string) {
    if (!latestFeedback) return;
    setLatestFeedback({ ...latestFeedback, answer });
    setImproveMessages((messages) => {
      const updated = [...messages];
      for (let index = updated.length - 1; index >= 0; index -= 1) {
        if (updated[index].role === "assistant") {
          updated[index] = { role: "assistant", text: answer };
          break;
        }
      }
      return updated;
    });
  }

  async function saveProposedImprovement() {
    if (!latestFeedback || !proposedAnswer || isSavingCorrection) return;
    setIsSavingCorrection(true);
    setUploadMessage("");
    setUploadError("");
    try {
      const response = await fetch("/api/researcher/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "save",
          question: latestFeedback.question,
          assistantAnswer: latestFeedback.answer,
          correctedAnswer: proposedAnswer,
          feedbackInstruction: desiredAnswer,
        }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save the improvement.");

      applyProposedAnswer(proposedAnswer);
      const key = normalizeLearnedQuestion(latestFeedback.question);
      const nextCorrections = { ...learnedCorrections, [key]: proposedAnswer };
      setLearnedCorrections(nextCorrections);
      window.localStorage.setItem("blocks-bots-teacher-corrections", JSON.stringify(nextCorrections));
      setUploadMessage(data.message ?? "Improvement saved for future responses.");
      setDesiredAnswer("");
      setProposedAnswer("");
    } catch (error: unknown) {
      setUploadError(error instanceof Error ? error.message : "Could not save the improvement.");
    } finally {
      setIsSavingCorrection(false);
    }
  }

  function keepProposedForChat() {
    if (!proposedAnswer) return;
    applyProposedAnswer(proposedAnswer);
    setUploadMessage("Answer updated for this chat only. Future responses were not retrained.");
    setDesiredAnswer("");
    setProposedAnswer("");
  }

  function selectAnswerForImprovement(index: number) {
    const answer = improveMessages[index];
    if (!answer || answer.role !== "assistant") return;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = improveMessages[cursor];
      if (previous.role === "user") {
        setLatestFeedback({ question: previous.text, answer: answer.text });
        setDesiredAnswer("");
        setProposedAnswer("");
        return;
      }
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
    } catch (error: unknown) {
      setResearcherMessages((messages) => [...messages, {
        role: "assistant",
        text: error instanceof Error ? error.message : "Could not check the file.",
      }]);
    } finally {
      setIsCheckingFile(false);
    }
  }

  async function testImprovedAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = improveQuestion.trim();
    if (!question || isTestingImprovement) return;

    if (awaitingImprovementConfirmation) {
      setImproveQuestion("");
      setImproveMessages((messages) => [...messages, { role: "user", text: question }]);
      if (/^(?:yes|y|응|네|좋아|그래)[!?.\s]*$/i.test(question)) {
        setAwaitingImprovementConfirmation(false);
        await saveProposedImprovement();
        setImproveMessages((messages) => [
          ...messages,
          { role: "assistant", text: "Done. This version will be used in future responses." },
        ]);
      } else {
        setAwaitingImprovementConfirmation(false);
        setImproveMessages((messages) => [
          ...messages,
          { role: "assistant", text: "Okay, I didn’t save it. You can request another version or keep editing." },
        ]);
      }
      return;
    }

    if (proposedAnswer && /(?:좋아|이걸로|이\s*답변|go with|use this|looks good|perfect)/i.test(question)) {
      setImproveQuestion("");
      setAwaitingImprovementConfirmation(true);
      setImproveMessages((messages) => [
        ...messages,
        { role: "user", text: question },
        { role: "assistant", text: "Use this version in future responses? Yes or No?" },
      ]);
      return;
    }

    if (proposedAnswer && /(?:more answers?|another (?:answer|version)|다른 답변|다시)/i.test(question)) {
      setImproveQuestion("");
      await previewImprovement(`${desiredAnswer}\nGive a meaningfully different alternative from this version: ${proposedAnswer}`);
      return;
    }

    const feedbackIntent = /(?:last\s+time\s+you\s+answered|i\s+(?:do\s+not|don['’]t)\s+like\s+(?:this|that)\s+answer|change\s+(?:this|that|the)\s+answer|i\s+want\s+you\s+to|(?:please\s+)?(?:make|include|add|remove|shorten|rewrite)\b|say\s+["“'])/i.test(question);
    if (feedbackIntent) {
      const replacement = question.match(
        /(?:change\s+(?:this|that|the)\s+answer\s+to|answer\s+(?:to|should\s+be))\s*[:\-]?\s*([\s\S]+)/i,
      )?.[1]?.trim();
      setImproveQuestion("");
      const instruction = replacement ?? question;
      setDesiredAnswer(instruction);
      await previewImprovement(instruction);
      return;
    }

    const learnedAnswer = findLearnedCorrection(question, learnedCorrections);
    if (learnedAnswer) {
      setImproveMessages((messages) => [
        ...messages,
        { role: "user", text: question },
        { role: "assistant", text: learnedAnswer },
      ]);
      setImproveQuestion("");
      setLatestFeedback({ question, answer: learnedAnswer });
      return;
    }

    const history = improveMessages;
    setImproveMessages((messages) => [...messages, { role: "user", text: question }]);
    setImproveQuestion("");
    setIsTestingImprovement(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const data = (await response.json()) as { answer?: string; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error ?? "Could not test the answer.");
      setImproveMessages((messages) => [...messages, { role: "assistant", text: data.answer as string }]);
      setLatestFeedback({ question, answer: data.answer });
      setDesiredAnswer("");
    } catch (error: unknown) {
      setImproveMessages((messages) => [...messages, {
        role: "assistant",
        text: error instanceof Error ? error.message : "Could not test the answer.",
      }]);
    } finally {
      setIsTestingImprovement(false);
    }
  }

  function stopGenerating() {
    abortControllerRef.current
      ?.abort();
  }

  function stopPracticeGenerating() {
    practiceAbortControllerRef.current
      ?.abort();
  }

  function addPracticeMessage(
    role: ResearcherMessage["role"],
    text: string,
    improvable = false,
  ) {
    setPracticeMessages((current) => [...current, { role, text, improvable }]);
  }

  function showPracticeFiles() {
    setPracticeMenuOpen(false);
    setPracticeFilesOpen(true);
    if (researcherFiles.length === 0) {
      addPracticeMessage("assistant", "No files yet. Use + → Upload a file to add your first document.");
    }
  }

  async function trainPracticeFile(file: ResearcherFile) {
    if (isPracticeBusy) return;
    setPracticeSelectedFile(file.name);
    setIsPracticeBusy(true);
    try {
      const response = await fetch("/api/researcher/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, filePath: file.id }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Training failed.");
      setResearcherFiles((files) => files.map((item) =>
        item.name === file.name ? { ...item, status: "trained" } : item,
      ));
      addPracticeMessage("assistant", `${file.name} is trained and selected. Ask me any question about it.`);
    } catch (error: unknown) {
      addPracticeMessage("assistant", error instanceof Error ? error.message : "Training failed.");
    } finally {
      setIsPracticeBusy(false);
    }
  }

  async function cancelPracticeTraining(file: ResearcherFile) {
    if (isPracticeBusy || !window.confirm(`Remove ${file.name} from trained knowledge? The original file will be kept.`)) return;
    setIsPracticeBusy(true);
    try {
      const response = await fetch("/api/researcher/untrain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, filePath: file.id }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not cancel training.");
      setResearcherFiles((files) => files.map((item) =>
        item.name === file.name ? { ...item, status: "untrained" } : item,
      ));
      addPracticeMessage("assistant", `Training was removed from ${file.name}. The original file was kept.`);
    } catch (error: unknown) {
      addPracticeMessage("assistant", error instanceof Error ? error.message : "Could not cancel training.");
    } finally {
      setIsPracticeBusy(false);
    }
  }

  async function deletePracticeFile(file: ResearcherFile) {
    if (isPracticeBusy || !window.confirm(`Permanently delete ${file.name}? This cannot be undone.`)) return;
    setIsPracticeBusy(true);
    try {
      const response = await fetch("/api/researcher/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, filePath: file.id }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not delete the file.");
      setResearcherFiles((files) => files.filter((item) => item.name !== file.name));
      if (practiceSelectedFile === file.name) setPracticeSelectedFile("");
      addPracticeMessage("assistant", `${file.name} was permanently deleted.`);
    } catch (error: unknown) {
      addPracticeMessage("assistant", error instanceof Error ? error.message : "Could not delete the file.");
    } finally {
      setIsPracticeBusy(false);
    }
  }

  async function uploadPracticeSelectedFile(file: File) {
    if (!file || isPracticeBusy) return;

    setPracticeMenuOpen(false);
    setIsPracticeBusy(true);
    addPracticeMessage("user", `Add ${file.name}`);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/researcher/files", { method: "POST", body: formData });
      const data = (await response.json()) as { file?: ResearcherFile; error?: string };
      if (!response.ok || !data.file) throw new Error(data.error ?? "Could not upload the file.");
      const uploaded = data.file;
      setResearcherFiles((current) => [uploaded, ...current]);
      setPracticeSelectedFile(uploaded.name);
      setPracticeFilesOpen(true);
      addPracticeMessage(
        "assistant",
        `${uploaded.name} is attached and selected. Use the Train file button in My files when you’re ready.`,
      );
    } catch (error: unknown) {
      addPracticeMessage("assistant", error instanceof Error ? error.message : "Could not upload the file.");
    } finally {
      setIsPracticeBusy(false);
    }
  }

  async function uploadPracticeFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await uploadPracticeSelectedFile(file);
  }

  function handlePracticeDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsPracticeDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void uploadPracticeSelectedFile(file);
  }

  function findPracticeFile(command: string): ResearcherFile | undefined {
    const number = command.match(/\b(\d{1,3})\b/)?.[1];
    if (number) return researcherFiles[Number(number) - 1];
    const named = researcherFiles.find((file) =>
      command.toLocaleLowerCase().includes(file.name.toLocaleLowerCase()),
    );
    return named ?? researcherFiles.find((file) => file.name === practiceSelectedFile);
  }

  function selectPracticeAnswerForImprovement(index: number) {
    const answer = practiceMessages[index];
    if (!answer || answer.role !== "assistant" || !answer.improvable) return;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = practiceMessages[cursor];
      if (previous.role === "user") {
        setPracticeImprovementTarget({ question: previous.text, answer: answer.text });
        setPracticeFeedbackInput("");
        setPracticePendingImprovement(null);
        setPracticeAwaitingConfirmation(false);
        return;
      }
    }
  }

  async function openPracticeImprovements() {
    setPracticeMenuOpen(false);
    setPracticeImprovementsOpen(true);
    try {
      const response = await fetch("/api/researcher/corrections", { cache: "no-store" });
      const data = (await response.json()) as { corrections?: Record<string, string> };
      if (!response.ok || !data.corrections) return;
      setLearnedCorrections(data.corrections);
      window.localStorage.setItem(
        "blocks-bots-teacher-corrections",
        JSON.stringify(data.corrections),
      );
    } catch {
      // Keep the locally cached list available if the refresh is temporarily unavailable.
    }
  }

  async function previewPracticeImprovement(
    question: string,
    originalAnswer: string,
    feedback: string,
  ) {
    const controller = new AbortController();
    practiceAbortControllerRef.current = controller;
    setIsPracticeBusy(true);
    setIsPracticeGenerating(true);
    try {
      const response = await fetch("/api/researcher/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          mode: "preview",
          question,
          assistantAnswer: originalAnswer,
          feedbackInstruction: feedback,
        }),
      });
      const data = (await response.json()) as { correctedAnswer?: string; error?: string };
      if (!response.ok || !data.correctedAnswer) throw new Error(data.error ?? "Could not improve the answer.");
      setPracticePendingImprovement({ question, originalAnswer, correctedAnswer: data.correctedAnswer, feedback });
      setPracticeAwaitingConfirmation(false);
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      addPracticeMessage("assistant", error instanceof Error ? error.message : "Could not improve the answer.");
    } finally {
      if (practiceAbortControllerRef.current === controller) {
        practiceAbortControllerRef.current = null;
        setIsPracticeGenerating(false);
        setIsPracticeBusy(false);
      }
    }
  }

  async function detectPracticeFeedback(feedback: string): Promise<boolean> {
    const controller = new AbortController();
    practiceAbortControllerRef.current = controller;
    setIsPracticeBusy(true);
    setIsPracticeGenerating(true);
    try {
      const response = await fetch("/api/researcher/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          mode: "detect",
          feedbackInstruction: feedback,
          history: [...practiceMessages, { role: "user", text: feedback }],
        }),
      });
      const data = (await response.json()) as {
        isFeedback?: boolean;
        question?: string;
        assistantAnswer?: string;
        correctedAnswer?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Could not understand that message.");
      if (!data.isFeedback) return false;
      if (!data.question || !data.assistantAnswer || !data.correctedAnswer) {
        throw new Error("I understood this as feedback, but couldn't identify the answer to change.");
      }
      setPracticeImprovementTarget({ question: data.question, answer: data.assistantAnswer });
      setPracticeFeedbackInput(feedback);
      setPracticePendingImprovement({
        question: data.question,
        originalAnswer: data.assistantAnswer,
        correctedAnswer: data.correctedAnswer,
        feedback,
      });
      setPracticeAwaitingConfirmation(false);
      return true;
    } catch (error: unknown) {
      if (controller.signal.aborted) return true;
      addPracticeMessage(
        "assistant",
        error instanceof Error ? error.message : "Could not understand that message.",
      );
      return true;
    } finally {
      if (practiceAbortControllerRef.current === controller) {
        practiceAbortControllerRef.current = null;
        setIsPracticeGenerating(false);
        setIsPracticeBusy(false);
      }
    }
  }

  async function savePracticeImprovement() {
    if (!practicePendingImprovement || isPracticeBusy || practiceSaveInFlightRef.current) return;
    practiceSaveInFlightRef.current = true;
    setIsPracticeBusy(true);
    try {
      const response = await fetch("/api/researcher/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "save",
          question: practicePendingImprovement.question,
          assistantAnswer: practicePendingImprovement.originalAnswer,
          correctedAnswer: practicePendingImprovement.correctedAnswer,
          feedbackInstruction: practicePendingImprovement.feedback,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save the improvement.");
      const key = normalizeLearnedQuestion(practicePendingImprovement.question);
      const nextCorrections = { ...learnedCorrections, [key]: practicePendingImprovement.correctedAnswer };
      setLearnedCorrections(nextCorrections);
      window.localStorage.setItem("blocks-bots-teacher-corrections", JSON.stringify(nextCorrections));
      addPracticeMessage("assistant", "Improvement saved. This version will be used in future responses.");
      setPracticePendingImprovement(null);
      setPracticeImprovementTarget(null);
      setPracticeFeedbackInput("");
      setPracticeAwaitingConfirmation(false);
    } catch (error: unknown) {
      addPracticeMessage("assistant", error instanceof Error ? error.message : "Could not save the improvement.");
    } finally {
      practiceSaveInFlightRef.current = false;
      setIsPracticeBusy(false);
    }
  }

  async function undoSavedPracticeImprovement(question: string) {
    if (!question || isPracticeBusy) return;
    setIsPracticeBusy(true);
    try {
      const response = await fetch("/api/researcher/corrections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not undo the saved improvement.");

      const key = normalizeLearnedQuestion(question);
      const nextCorrections = { ...learnedCorrections };
      delete nextCorrections[key];
      setLearnedCorrections(nextCorrections);
      window.localStorage.setItem("blocks-bots-teacher-corrections", JSON.stringify(nextCorrections));
      addPracticeMessage("assistant", data.message ?? "Saved improvement undone.");
    } catch (error: unknown) {
      addPracticeMessage(
        "assistant",
        error instanceof Error ? error.message : "Could not undo the saved improvement.",
      );
    } finally {
      setIsPracticeBusy(false);
    }
  }

  function keepPracticeImprovementForChat() {
    if (!practicePendingImprovement) return;
    addPracticeMessage("assistant", practicePendingImprovement.correctedAnswer, true);
    addPracticeMessage("assistant", "Kept for this chat only. Future responses were not retrained.");
    setPracticePendingImprovement(null);
    setPracticeImprovementTarget(null);
    setPracticeFeedbackInput("");
    setPracticeAwaitingConfirmation(false);
  }

  async function submitPracticeMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command = practiceInput.trim();
    if (!command || isPracticeBusy) return;
    setPracticeInput("");
    addPracticeMessage("user", command);

    if (practiceAwaitingConfirmation && practicePendingImprovement) {
      if (/^(?:yes|y|응|네|좋아|그래)[!?.\s]*$/i.test(command)) {
        setPracticeAwaitingConfirmation(false);
        await savePracticeImprovement();
      } else {
        setPracticeAwaitingConfirmation(false);
        addPracticeMessage("assistant", "Okay, I didn’t save it. You can generate another version or keep editing.");
      }
      return;
    }

    if (practicePendingImprovement && /(?:좋아|이걸로|go with|use this|looks good|perfect)/i.test(command)) {
      setPracticeAwaitingConfirmation(true);
      return;
    }

    if (practicePendingImprovement && /(?:more answers?|another (?:answer|version)|다른 답변|다시)/i.test(command)) {
      await previewPracticeImprovement(
        practicePendingImprovement.question,
        practicePendingImprovement.originalAnswer,
        `${practicePendingImprovement.feedback}\nGive a meaningfully different alternative from this version: ${practicePendingImprovement.correctedAnswer}`,
      );
      return;
    }

    if (/^save improvement$/i.test(command) && practicePendingImprovement) {
      await savePracticeImprovement();
      return;
    }

    if (/^keep (?:only )?for (?:this )?chat$/i.test(command) && practicePendingImprovement) {
      keepPracticeImprovementForChat();
      return;
    }

    if (/^improve (?:this |the |last )?answer[.!?\s]*$/i.test(command)) {
      for (let index = practiceMessages.length - 1; index >= 0; index -= 1) {
        if (practiceMessages[index].role === "assistant" && practiceMessages[index].improvable) {
          selectPracticeAnswerForImprovement(index);
          return;
        }
      }
      addPracticeMessage("assistant", "Tell me which earlier answer you want changed, or quote a few words from it.");
      return;
    }

    if (await detectPracticeFeedback(command)) {
      return;
    }

    if (/^(?:show|list|view)?\s*(?:my\s+)?files?\b/i.test(command)) {
      showPracticeFiles();
      return;
    }

    const targetFile = findPracticeFile(command);
    if (/\bselect\b/i.test(command)) {
      if (!targetFile) {
        addPracticeMessage("assistant", "I couldn't identify that file. Say “show files” to see the numbered list.");
      } else {
        setPracticeSelectedFile(targetFile.name);
        addPracticeMessage("assistant", `${targetFile.name} is now selected.`);
      }
      return;
    }

    if (/\b(?:train|retrain|process|index)\b/i.test(command)) {
      if (!targetFile) {
        addPracticeMessage("assistant", "Choose a file first. Use + to upload one or say “show files.”");
        return;
      }
      setIsPracticeBusy(true);
      try {
        const response = await fetch("/api/researcher/train", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: targetFile.name, filePath: targetFile.id }),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Training failed.");
        setPracticeSelectedFile(targetFile.name);
        setResearcherFiles((files) => files.map((file) =>
          file.name === targetFile.name ? { ...file, status: "trained" } : file,
        ));
        addPracticeMessage("assistant", `${targetFile.name} is trained. Ask me any question about that file.`);
      } catch (error: unknown) {
        addPracticeMessage("assistant", error instanceof Error ? error.message : "Training failed.");
      } finally {
        setIsPracticeBusy(false);
      }
      return;
    }

    const learnedPracticeAnswer = findLearnedCorrection(command, learnedCorrections);
    if (learnedPracticeAnswer) {
      addPracticeMessage("assistant", learnedPracticeAnswer, true);
      return;
    }

    const controller = new AbortController();
    practiceAbortControllerRef.current = controller;
    setIsPracticeBusy(true);
    setIsPracticeGenerating(true);
    try {
      const wantsFileOnly = /^(?:check|ask)\s+(?:this|selected)\s+file\s*[:\-]?/i.test(command);
      if (wantsFileOnly && (!targetFile || (targetFile.status !== "trained" && targetFile.status !== "existing"))) {
        throw new Error("Select a trained file from + → My files, or use its Train button first.");
      }
      const question = command.replace(/^(?:check|ask)\s+(?:this|selected)\s+file\s*[:\-]?\s*/i, "");
      const response = await fetch(wantsFileOnly ? "/api/researcher/chat" : "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(wantsFileOnly ? {
          fileName: targetFile?.name,
          question,
          history: practiceMessages,
        } : {
          question: command,
          history: practiceMessages,
        }),
      });
      const data = (await response.json()) as { answer?: string; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error ?? "The assistant could not answer.");
      addPracticeMessage("assistant", data.answer, true);
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      addPracticeMessage("assistant", error instanceof Error ? error.message : "The assistant could not answer.");
    } finally {
      if (practiceAbortControllerRef.current === controller) {
        practiceAbortControllerRef.current = null;
        setIsPracticeGenerating(false);
        setIsPracticeBusy(false);
      }
    }
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

    const learnedAnswer = findLearnedCorrection(question, learnedCorrections);
    if (learnedAnswer) {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: createMessageId(),
          role: "assistant",
          text: learnedAnswer,
        },
      ]);
      return;
    }

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

          <button
            type="button"
            className={
              activeTab === "practice"
                ? styles.activeTab
                : styles.tab
            }
            onClick={() => {
              setActiveTab("practice");
            }}
          >
            Researcher 2
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
              Files &amp; Training
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={researcherView === "improve"}
              className={researcherView === "improve" ? styles.activeResearcherView : undefined}
              onClick={() => { setResearcherView("improve"); }}
            >
              Improve Answer
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
                      View file
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
                          ? "Retrain file"
                          : "Train file"}
                    </button>
                    <button
                      type="button"
                      className={styles.cancelButton}
                      disabled={trainingFile !== null}
                      onClick={() => { void untrainResearchFile(file.name); }}
                    >
                      Remove training
                    </button>
                    <button
                      type="button"
                      className={styles.deleteButton}
                      disabled={trainingFile !== null}
                      onClick={() => { void deleteResearchFile(file.name); }}
                    >
                      Delete file
                    </button>
                  </div>
                </div>
              ))
            )}
            </div>
          </details>

          <div className={styles.pipelineNote}>
            <strong>No terminal needed</strong>
            <span>Select Train file and the server will process and index it automatically.</span>
          </div>
          </div>

          <div className={styles.researcherPanel} hidden={researcherView !== "files"}>

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

          <section className={`${styles.researcherChat} ${styles.improveChat}`}>
            <div className={styles.researcherChatHeader}>
              <div>
                <span className={styles.chatStatus}>Improve Answer</span>
                <h3>Chat with the assistant</h3>
                <p>Ask a question, then tell the same chatbot what you want changed.</p>
              </div>
            </div>

            <div className={styles.researcherChatMessages}>
              {improveMessages.length === 0 ? (
                <div className={styles.researcherAssistantMessage}>
                  Ask me any question teachers might ask. If you dislike my answer, use the feedback box below or simply say “change this answer to…”
                </div>
              ) : improveMessages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={styles.improveMessageGroup}>
                  <div
                    className={message.role === "user" ? styles.researcherUserMessage : styles.researcherAssistantMessage}
                  >
                    {message.text}
                  </div>
                  {message.role === "assistant" && index > 0 ? (
                    <button
                      type="button"
                      className={styles.improveAnswerButton}
                      onClick={() => { selectAnswerForImprovement(index); }}
                    >
                      Improve answer
                    </button>
                  ) : null}
                </div>
              ))}
              {isTestingImprovement ? <div className={styles.researcherAssistantMessage}>Thinking...</div> : null}
            </div>

            <form className={styles.researcherChatForm} onSubmit={testImprovedAnswer}>
              <input
                value={improveQuestion}
                onChange={(event) => { setImproveQuestion(event.target.value); }}
                placeholder="Message the trained assistant..."
                disabled={isTestingImprovement}
              />
              <button type="submit" disabled={!improveQuestion.trim() || isTestingImprovement}>
                Test
              </button>
            </form>
          </section>

          <section className={styles.feedbackEditor}>
            <div className={styles.feedbackHeading}>
              <span className={styles.feedbackStep}>Teacher feedback</span>
              <h3>What would you like to improve?</h3>
              <p>You can refer to any earlier answer naturally—no need to ask the question again first.</p>
            </div>

            <div className={styles.feedbackConversation}>
              {latestFeedback ? (
                <>
                  <div className={styles.feedbackQuestion}>
                    <span>You asked</span>
                    {latestFeedback.question}
                  </div>
                  <div className={styles.researcherAssistantMessage}>
                    {latestFeedback.answer}
                  </div>
                </>
              ) : (
                <div className={styles.researcherAssistantMessage}>
                  Tell me what I said before and what you want changed. For example: “Last time you explained pairing, the answer was too technical. Make it teacher-friendly.”
                </div>
              )}
            </div>

            <label>
              Your feedback
              <textarea
                value={desiredAnswer}
                onChange={(event) => { setDesiredAnswer(event.target.value); }}
                placeholder={latestFeedback
                  ? "Make it shorter, friendlier, or correct a step..."
                  : "Last time you answered about... Make it shorter, friendlier, or correct a step..."}
                disabled={isPreviewingImprovement || isSavingCorrection}
              />
            </label>

            {!proposedAnswer ? (
            <div className={styles.feedbackActions}>
              <button
                type="button"
                disabled={!desiredAnswer.trim() || isPreviewingImprovement}
                onClick={() => { void previewImprovement(); }}
              >
                {isPreviewingImprovement ? "Updating..." : "Update answer"}
              </button>
              <button
                type="button"
                className={styles.secondaryFeedbackButton}
                onClick={() => {
                  setLatestFeedback(null);
                  setDesiredAnswer("");
                  setProposedAnswer("");
                }}
              >
                Cancel
              </button>
            </div>
            ) : (
              <div className={styles.proposedImprovement}>
                <div className={styles.researcherAssistantMessage}>{proposedAnswer}</div>
                <strong>{awaitingImprovementConfirmation
                  ? "You like this version. Save it for future responses?"
                  : "Answer updated. Use this version in future responses?"}</strong>
                <div className={styles.proposedImprovementActions}>
                  {awaitingImprovementConfirmation ? (
                    <>
                      <button
                        type="button"
                        disabled={isSavingCorrection}
                        onClick={() => {
                          setAwaitingImprovementConfirmation(false);
                          void saveProposedImprovement();
                        }}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryFeedbackButton}
                        onClick={() => { setAwaitingImprovementConfirmation(false); }}
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <>
                  <button
                    type="button"
                    disabled={isSavingCorrection}
                    onClick={() => { void saveProposedImprovement(); }}
                  >
                    {isSavingCorrection ? "Saving..." : "Save improvement"}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryFeedbackButton}
                    disabled={isSavingCorrection}
                    onClick={keepProposedForChat}
                  >
                    Keep only for this chat
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryFeedbackButton}
                    disabled={isPreviewingImprovement || isSavingCorrection}
                    onClick={() => {
                      void previewImprovement(`${desiredAnswer}\nGive a meaningfully different alternative from this version: ${proposedAnswer}`);
                    }}
                  >
                    {isPreviewingImprovement ? "Generating..." : "More answers"}
                  </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
          </div>
        </section>
        ) : activeTab === "practice" ? (
        <section
          className={styles.practiceChat}
          onDragEnter={(event) => {
            event.preventDefault();
            if (event.dataTransfer.types.includes("Files")) setIsPracticeDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIsPracticeDragging(false);
            }
          }}
          onDrop={handlePracticeDrop}
        >
          <header className={styles.practiceHeader}>
            <div>
              <span className={styles.eyebrow}>Chat-based workspace</span>
              <h2>Researcher 2</h2>
              <p>Upload, train, and check classroom files without leaving the conversation.</p>
            </div>
            {practiceSelectedFile ? (
              <span className={styles.practiceFileBadge}>{practiceSelectedFile}</span>
            ) : null}
          </header>

          {isPracticeDragging ? (
            <div className={styles.practiceDropOverlay}>
              <div>
                <strong>Drop your file here</strong>
                <span>PDF, DOCX, PPTX, or image · max 25 MB</span>
              </div>
            </div>
          ) : null}

          <div className={styles.practiceMessages}>
            {practiceImprovementsOpen ? (
              <div className={styles.practiceImprovementsPanel}>
                <div className={styles.practiceImprovementsHeader}>
                  <div>
                    <strong>Saved improved answers</strong>
                    <span>These answers are used in future responses.</span>
                  </div>
                  <button type="button" onClick={() => { setPracticeImprovementsOpen(false); }}>Close</button>
                </div>
                {Object.keys(learnedCorrections).length === 0 ? (
                  <p>No improved answers have been saved yet.</p>
                ) : (
                  <div className={styles.practiceImprovementList}>
                    {Object.entries(learnedCorrections).map(([question, answer]) => (
                      <article key={question} className={styles.practiceSavedImprovement}>
                        <div>
                          <span>Question</span>
                          <strong>{question}</strong>
                        </div>
                        <div>
                          <span>Improved answer</span>
                          <p>{answer}</p>
                        </div>
                        <button
                          type="button"
                          disabled={isPracticeBusy}
                          onClick={() => { void undoSavedPracticeImprovement(question); }}
                        >
                          Undo improvement
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
            {practiceMessages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={styles.practiceMessageGroup}>
                <div className={message.role === "user" ? styles.practiceUserMessage : styles.practiceAssistantMessage}>
                  {message.text}
                </div>
                {message.role === "assistant" && message.improvable ? (
                  <button
                    type="button"
                    className={styles.improveAnswerButton}
                    onClick={() => { selectPracticeAnswerForImprovement(index); }}
                  >
                    Improve answer
                  </button>
                ) : null}
              </div>
            ))}
            {practiceImprovementTarget && !practicePendingImprovement ? (
              <div className={styles.practiceImprovementCard}>
                <span className={styles.feedbackStep}>Improve selected answer</span>
                <div className={styles.practiceAssistantMessage}>{practiceImprovementTarget.answer}</div>
                <label>
                  How should this answer change?
                  <textarea
                    value={practiceFeedbackInput}
                    onChange={(event) => { setPracticeFeedbackInput(event.target.value); }}
                    placeholder="Make it shorter, friendlier, or correct a step..."
                    disabled={isPracticeBusy}
                  />
                </label>
                <div className={styles.practiceImprovementActions}>
                  <button
                    type="button"
                    disabled={!practiceFeedbackInput.trim() || isPracticeBusy}
                    onClick={() => {
                      void previewPracticeImprovement(
                        practiceImprovementTarget.question,
                        practiceImprovementTarget.answer,
                        practiceFeedbackInput,
                      );
                    }}
                  >
                    Update answer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPracticeImprovementTarget(null);
                      setPracticeFeedbackInput("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {practicePendingImprovement ? (
              <div className={styles.practiceImprovementCard}>
                <div className={styles.practiceAssistantMessage}>
                  {practicePendingImprovement.correctedAnswer}
                </div>
                <strong>{practiceAwaitingConfirmation
                  ? "You like this version. Save it for future responses?"
                  : "Answer updated. Use this version in future responses?"}</strong>
                <div className={styles.practiceImprovementActions}>
                  {practiceAwaitingConfirmation ? (
                    <>
                      <button type="button" onClick={() => { void savePracticeImprovement(); }}>Yes</button>
                      <button type="button" onClick={() => { setPracticeAwaitingConfirmation(false); }}>No</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => { void savePracticeImprovement(); }}>Save improvement</button>
                      <button type="button" onClick={keepPracticeImprovementForChat}>Keep only for this chat</button>
                      <button
                        type="button"
                        onClick={() => {
                          void previewPracticeImprovement(
                            practicePendingImprovement.question,
                            practicePendingImprovement.originalAnswer,
                            `${practicePendingImprovement.feedback}\nGive a meaningfully different alternative from this version: ${practicePendingImprovement.correctedAnswer}`,
                          );
                        }}
                      >
                        More answers
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : null}
            {practiceFilesOpen ? (
              <div className={styles.practiceFilePicker}>
                <div className={styles.practiceFilePickerHeader}>
                  <strong>Choose a file</strong>
                  <button type="button" onClick={() => { setPracticeFilesOpen(false); }}>Close</button>
                </div>
                {researcherFiles.length === 0 ? (
                  <p>No files yet. Use + → Upload a file.</p>
                ) : (
                  <div className={styles.practiceFileCards}>
                    {researcherFiles.map((file) => (
                      <div
                        className={file.name === practiceSelectedFile ? styles.selectedPracticeFileCard : styles.practiceFileCard}
                        key={`${file.name}-${file.savedAt}`}
                      >
                        <button
                          type="button"
                          className={styles.practiceFileSelect}
                          onClick={() => {
                            if (file.name === practiceSelectedFile) {
                              setPracticeSelectedFile("");
                              addPracticeMessage("assistant", `${file.name} is no longer selected.`);
                            } else {
                              setPracticeSelectedFile(file.name);
                              addPracticeMessage("assistant", `${file.name} is selected.`);
                            }
                          }}
                        >
                          <strong>{file.name}</strong>
                          <span>{(file.size / 1024 / 1024).toFixed(1)} MB · {file.status}</span>
                        </button>
                        <div className={styles.practiceFileCardActions}>
                          <button
                            type="button"
                            className={styles.practiceSelectButton}
                            onClick={() => {
                              if (file.name === practiceSelectedFile) {
                                setPracticeSelectedFile("");
                                addPracticeMessage("assistant", `${file.name} is no longer selected.`);
                              } else {
                                setPracticeSelectedFile(file.name);
                                addPracticeMessage("assistant", `${file.name} is selected.`);
                              }
                            }}
                          >
                            {file.name === practiceSelectedFile ? "Deselect" : "Select file"}
                          </button>
                          <a
                            href={`/api/researcher/content?path=${encodeURIComponent(file.id)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View file
                          </a>
                          <a href={`/api/researcher/content?path=${encodeURIComponent(file.id)}&download=1`}>
                            Download
                          </a>
                          <button
                            type="button"
                            disabled={isPracticeBusy}
                            onClick={() => { void trainPracticeFile(file); }}
                          >
                            {file.status === "trained" ? "Retrain file" : "Train file"}
                          </button>
                          <button
                            type="button"
                            className={styles.practiceCancelButton}
                            disabled={isPracticeBusy}
                            onClick={() => { void cancelPracticeTraining(file); }}
                          >
                            Remove training
                          </button>
                          <button
                            type="button"
                            className={styles.practiceDeleteButton}
                            disabled={isPracticeBusy}
                            onClick={() => { void deletePracticeFile(file); }}
                          >
                            Delete file
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
            {isPracticeBusy ? (
              <div className={styles.practiceAssistantMessage}>Working on that...</div>
            ) : null}
          </div>

          <form className={styles.practiceComposer} onSubmit={submitPracticeMessage}>
            <div className={styles.practiceAddWrap}>
              <button
                type="button"
                className={styles.practiceAddButton}
                aria-label="Add Researcher tool"
                aria-expanded={practiceMenuOpen}
                onClick={() => { setPracticeMenuOpen((open) => !open); }}
              >
                +
              </button>
              {practiceMenuOpen ? (
                <div className={styles.practiceAddMenu}>
                  <span>Add</span>
                  <button type="button" onClick={() => { practiceFileInputRef.current?.click(); }}>
                    <strong>⌕</strong>
                    <span><b>Upload a file</b><small>PDF, DOCX, PPTX, or image</small></span>
                  </button>
                  <button type="button" onClick={showPracticeFiles}>
                    <strong>▤</strong>
                    <span><b>My files</b><small>View, select, and train files</small></span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void openPracticeImprovements();
                    }}
                  >
                    <strong>✓</strong>
                    <span>
                      <b>See improved answers</b>
                      <small>View or undo saved answers ({Object.keys(learnedCorrections).length})</small>
                    </span>
                  </button>
                </div>
              ) : null}
              <input
                ref={practiceFileInputRef}
                type="file"
                accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
                className={styles.practiceHiddenInput}
                onChange={uploadPracticeFile}
              />
            </div>
            <input
              value={practiceInput}
              onChange={(event) => { setPracticeInput(event.target.value); }}
              placeholder={practiceSelectedFile ? `Ask about ${practiceSelectedFile}...` : "Ask Researcher 2 or add a file..."}
              disabled={isPracticeBusy}
            />
            {isPracticeGenerating ? (
              <button
                type="button"
                className={styles.practiceStopButton}
                onClick={stopPracticeGenerating}
                aria-label="Stop generating"
              >
                <span className={styles.practiceStopIcon} aria-hidden="true" />
                Stop
              </button>
            ) : (
              <button type="submit" disabled={!practiceInput.trim() || isPracticeBusy}>Send</button>
            )}
          </form>
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
