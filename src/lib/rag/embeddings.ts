import { pipeline } from "@huggingface/transformers";

const MODEL_NAME = "Supabase/gte-small";
const EMBEDDING_DIMENSIONS = 384;

type NumericValue = number | bigint;

type FeatureExtractionResult = {
  data: ArrayLike<NumericValue>;
};

type FeatureExtractor = (
  input: string,
  options: {
    pooling: "mean";
    normalize: true;
  },
) => Promise<FeatureExtractionResult>;

let extractorPromise:
  | Promise<FeatureExtractor>
  | null = null;

async function loadExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = pipeline(
      "feature-extraction",
      MODEL_NAME,
      {
        dtype: "fp32",
      },
    ) as unknown as Promise<FeatureExtractor>;
  }

  return extractorPromise;
}

export async function createQueryEmbedding(
  question: string,
): Promise<number[]> {
  const normalizedQuestion =
    question.trim();

  if (!normalizedQuestion) {
    throw new Error(
      "Question cannot be empty.",
    );
  }

  const extractor =
    await loadExtractor();

  const result = await extractor(
    normalizedQuestion,
    {
      pooling: "mean",
      normalize: true,
    },
  );

  const embedding = Array.from(
    result.data,
    (value) => Number(value),
  );

  if (
    embedding.length !==
    EMBEDDING_DIMENSIONS
  ) {
    throw new Error(
      `Expected ${EMBEDDING_DIMENSIONS} dimensions, ` +
        `but received ${embedding.length}.`,
    );
  }

  if (
    embedding.some(
      (value) =>
        !Number.isFinite(value),
    )
  ) {
    throw new Error(
      "Query embedding contains an invalid number.",
    );
  }

  return embedding;
}