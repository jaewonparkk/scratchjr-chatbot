"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import styles from "./review.module.css";

type DecisionValue =
  | "pending"
  | "approved"
  | "rejected";

type ReviewDecision = {
  chunkId: string;
  decision: DecisionValue;
  editedContent: string;
  notes: string;
  reviewedAt: string;
};

type ReviewItem = {
  id: string;
  title: string;
  content: string;
  source_file: string;
  file_type: string;
  section: string;
  chunk_index: number;
  page_number: number | null;
  slide_number: number | null;
  image_paths: string[];
  ocr_applied: boolean;
  requires_visual_review: boolean;
  should_display_image: boolean;
  status: string;
  metadata: Record<string, unknown>;
  decision: ReviewDecision | null;
};

type ReviewResponse = {
  items: ReviewItem[];
  summary: {
    total: number;
    approved: number;
    rejected: number;
    pending: number;
  };
};

function getLocationLabel(
  item: ReviewItem,
): string {
  if (item.page_number !== null) {
    return `Page ${item.page_number}`;
  }

  if (item.slide_number !== null) {
    return `Slide ${item.slide_number}`;
  }

  return "Document";
}

function getFileName(
  sourceFile: string,
): string {
  return (
    sourceFile.split("/").pop() ??
    sourceFile
  );
}

export default function ReviewPage() {
  const [items, setItems] = useState<
    ReviewItem[]
  >([]);

  const [currentIndex, setCurrentIndex] =
    useState(0);

  const [
    editedContent,
    setEditedContent,
  ] = useState("");

  const [notes, setNotes] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  const currentItem =
    items[currentIndex] ?? null;

  const summary = useMemo(() => {
    const approved = items.filter(
      (item) =>
        item.decision?.decision ===
        "approved",
    ).length;

    const rejected = items.filter(
      (item) =>
        item.decision?.decision ===
        "rejected",
    ).length;

    return {
      total: items.length,
      approved,
      rejected,
      pending:
        items.length -
        approved -
        rejected,
    };
  }, [items]);

  useEffect(() => {
    async function loadReviewItems() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(
          "/api/review",
          {
            cache: "no-store",
          },
        );

        const data =
          (await response.json()) as
            | ReviewResponse
            | { error?: string };

        if (!response.ok) {
          throw new Error(
            "error" in data &&
              data.error
              ? data.error
              : "Could not load review items.",
          );
        }

        const reviewData =
          data as ReviewResponse;

        setItems(reviewData.items);
      } catch (loadError: unknown) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load review items.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadReviewItems();
  }, []);

  useEffect(() => {
    if (!currentItem) {
      setEditedContent("");
      setNotes("");
      return;
    }

    setEditedContent(
      currentItem.decision
        ?.editedContent ||
        currentItem.content,
    );

    setNotes(
      currentItem.decision?.notes ??
        "",
    );

    setError("");
    setMessage("");
  }, [currentItem?.id]);

  async function saveDecision(
    decision: DecisionValue,
    moveToNext: boolean,
  ) {
    if (!currentItem) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        "/api/review",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            chunkId: currentItem.id,
            decision,
            editedContent,
            notes,
          }),
        },
      );

      const data = (await response.json()) as {
        success?: boolean;
        decision?: ReviewDecision;
        error?: string;
      };

      if (!response.ok || !data.decision) {
        throw new Error(
          data.error ??
            "Could not save the review.",
        );
      }

      setItems((previousItems) =>
        previousItems.map((item) =>
          item.id === currentItem.id
            ? {
                ...item,
                decision:
                  data.decision ?? null,
              }
            : item,
        ),
      );

      if (decision === "approved") {
        setMessage("Approved and saved.");
      } else if (
        decision === "rejected"
      ) {
        setMessage("Rejected and saved.");
      } else {
        setMessage("Draft saved.");
      }

      if (
        moveToNext &&
        currentIndex <
          items.length - 1
      ) {
        setCurrentIndex(
          (previousIndex) =>
            previousIndex + 1,
        );
      }
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the review.",
      );
    } finally {
      setSaving(false);
    }
  }

  function goPrevious() {
    setCurrentIndex(
      (previousIndex) =>
        Math.max(
          previousIndex - 1,
          0,
        ),
    );
  }

  function goNext() {
    setCurrentIndex(
      (previousIndex) =>
        Math.min(
          previousIndex + 1,
          items.length - 1,
        ),
    );
  }

  if (loading) {
    return (
      <main className={styles.centered}>
        <p>Loading review items...</p>
      </main>
    );
  }

  if (error && items.length === 0) {
    return (
      <main className={styles.centered}>
        <p className={styles.error}>
          {error}
        </p>
      </main>
    );
  }

  if (!currentItem) {
    return (
      <main className={styles.centered}>
        <p>
          No review items were found.
        </p>
      </main>
    );
  }

  const currentDecision =
    currentItem.decision?.decision ??
    "pending";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Document Review</h1>

          <p>
            Compare the extracted text
            with the original image.
          </p>
        </div>

        <div
          className={styles.summary}
        >
          <span>
            {currentIndex + 1} /{" "}
            {summary.total}
          </span>

          <span>
            Approved:{" "}
            {summary.approved}
          </span>

          <span>
            Rejected:{" "}
            {summary.rejected}
          </span>

          <span>
            Pending: {summary.pending}
          </span>
        </div>
      </header>

      <section
        className={styles.documentInfo}
      >
        <div>
          <strong>
            {getFileName(
              currentItem.source_file,
            )}
          </strong>

          <span>
            {getLocationLabel(
              currentItem,
            )}
          </span>
        </div>

        <span
          className={`${styles.status} ${
            styles[currentDecision]
          }`}
        >
          {currentDecision}
        </span>
      </section>

      <section className={styles.content}>
        <div className={styles.imagePanel}>
          <h2>Original image</h2>

          {currentItem.image_paths
            .length > 0 ? (
            <div
              className={
                styles.imageList
              }
            >
              {currentItem.image_paths.map(
                (
                  imagePath,
                  imageIndex,
                ) => {
                  const imageUrl =
                    `/api/review/image?path=${encodeURIComponent(
                      imagePath,
                    )}`;

                  return (
                    <figure
                      key={imagePath}
                      className={
                        styles.figure
                      }
                    >
                      <a
                        href={imageUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          src={imageUrl}
                          alt={`Source image ${
                            imageIndex + 1
                          }`}
                          className={
                            styles.image
                          }
                        />
                      </a>

                      <figcaption>
                        Image{" "}
                        {imageIndex + 1}
                      </figcaption>
                    </figure>
                  );
                },
              )}
            </div>
          ) : (
            <p>No image attached.</p>
          )}
        </div>

        <div className={styles.textPanel}>
          <div
            className={
              styles.textHeader
            }
          >
            <h2>
              Extracted text
            </h2>

            {currentItem.ocr_applied && (
              <span
                className={
                  styles.ocrBadge
                }
              >
                OCR
              </span>
            )}
          </div>

          <label
            className={styles.label}
            htmlFor="review-content"
          >
            Correct any OCR mistakes.
          </label>

          <textarea
            id="review-content"
            className={styles.textarea}
            value={editedContent}
            onChange={(event) =>
              setEditedContent(
                event.target.value,
              )
            }
            spellCheck
          />

          <label
            className={styles.label}
            htmlFor="review-notes"
          >
            Review notes
          </label>

          <textarea
            id="review-notes"
            className={
              styles.notesTextarea
            }
            value={notes}
            onChange={(event) =>
              setNotes(
                event.target.value,
              )
            }
            placeholder="Optional: note unclear arrows, duplicated pages, or safety concerns."
          />

          <div className={styles.metadata}>
            <p>
              <strong>Title:</strong>{" "}
              {currentItem.title}
            </p>

            <p>
              <strong>Section:</strong>{" "}
              {currentItem.section}
            </p>

            <p>
              <strong>Type:</strong>{" "}
              {currentItem.file_type}
            </p>
          </div>
        </div>
      </section>

      {error && (
        <p className={styles.error}>
          {error}
        </p>
      )}

      {message && (
        <p className={styles.message}>
          {message}
        </p>
      )}

      <footer className={styles.actions}>
        <div>
          <button
            type="button"
            className={
              styles.secondaryButton
            }
            onClick={goPrevious}
            disabled={
              currentIndex === 0 ||
              saving
            }
          >
            Previous
          </button>

          <button
            type="button"
            className={
              styles.secondaryButton
            }
            onClick={goNext}
            disabled={
              currentIndex ===
                items.length - 1 ||
              saving
            }
          >
            Next
          </button>
        </div>

        <div>
          <button
            type="button"
            className={
              styles.secondaryButton
            }
            disabled={saving}
            onClick={() =>
              void saveDecision(
                "pending",
                false,
              )
            }
          >
            Save draft
          </button>

          <button
            type="button"
            className={
              styles.rejectButton
            }
            disabled={saving}
            onClick={() =>
              void saveDecision(
                "rejected",
                true,
              )
            }
          >
            Reject
          </button>

          <button
            type="button"
            className={
              styles.approveButton
            }
            disabled={
              saving ||
              !editedContent.trim()
            }
            onClick={() =>
              void saveDecision(
                "approved",
                true,
              )
            }
          >
            {saving
              ? "Saving..."
              : "Approve & next"}
          </button>
        </div>
      </footer>
    </main>
  );
}