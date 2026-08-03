# Blocks & Bots Assistant

An AI assistant for educators working with **ScratchJr, micro:bit, and classroom robotics**.

Teachers can ask questions in natural language, receive answers grounded in curriculum documents, continue with follow-up questions, and view relevant instructional images and sources.

<p align="center">
  <img src="docs/assets/assistant-home.png" alt="Blocks & Bots Assistant home screen" width="32%" />
  <img src="docs/assets/grounded-build-answer.png" alt="Grounded build answer with sources" width="32%" />
  <img src="docs/assets/visual-retrieval-demo.png" alt="Relevant instructional image retrieval" width="32%" />
</p>

<p align="center">
  <strong>Next.js · TypeScript · Gemini · Supabase · Hugging Face Transformers · RAG</strong>
</p>

## Features

### Assistant

- Answers questions using indexed curriculum content
- Understands exact build steps, pairing steps, lessons, and full walkthrough requests
- Uses recent conversation history for follow-up questions such as “What about the red one?”
- Shows source file, page, slide, and section information when available
- Displays a related curriculum image when the question and retrieved content support one
- Avoids showing document images for greetings, typos, and unrelated conversation
- Allows users to stop a response in progress

### Researcher

- Upload PDF, DOCX, PPTX, and image files
- View, download, train, retrain, untrain, or permanently delete a file
- Test one trained document through a dedicated chat
- Compare the generated response with the answer an educator wants
- Save the improved answer and regenerate retrieval embeddings

<p align="center">
  <img src="docs/assets/researcher-file-management.png" alt="Researcher file management" width="49%" />
  <img src="docs/assets/researcher-feedback-workflow.png" alt="Researcher answer improvement workflow" width="49%" />
</p>

## How it works

```text
Curriculum files
      ↓
Text and image extraction
      ↓
Chunking + metadata
      ↓
gte-small embeddings
      ↓
Supabase vector search
      ↓
Gemini with retrieved context
      ↓
Answer + sources + relevant images
```

The project uses `@huggingface/transformers` to run the `Supabase/gte-small` embedding model locally. Supabase stores and searches the document vectors, while Gemini generates the final response from the retrieved curriculum context.

Researcher corrections are **retrieval updates, not Gemini fine-tuning**. The tested question and educator-approved answer are added as correction content and embedded again. The incorrect answer is retained only as feedback metadata.

## Tech stack

- Next.js 16, React 19, and TypeScript
- Google Gemini through `@google/genai`
- Supabase Postgres and pgvector
- `@huggingface/transformers` with `Supabase/gte-small`
- Python, PyMuPDF, `python-docx`, and `python-pptx`
- CSS Modules

## Run locally

### 1. Install dependencies

```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r ingestion/requirements.txt
```

### 2. Add `.env.local`

```dotenv
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
SUPABASE_URL=your_supabase_project_url
SUPABASE_SECRET_KEY=your_supabase_server_secret
```

`GEMINI_MODEL` is optional. The Supabase project must already contain the expected `documents` table and `match_documents` vector-search function.

### 3. Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Important limitations

This is currently a working prototype.

- Authentication, administrator roles, and rate limiting have not been added yet.
- The Researcher workflow runs Python and writes files on the server, so it needs persistent storage and does not work unchanged on a typical serverless deployment.
- Training a file updates Supabase and local project data; it does not automatically commit or push changes to GitHub.
- The assistant does not search the public web. Its instructional content and displayed images come from the project’s prepared curriculum data.

## Project structure

```text
src/app/                 UI and Next.js route handlers
src/lib/rag/             Intent, retrieval, embeddings, and generation
src/lib/researcher/      Researcher manifest handling
ingestion/               Python document processing
scripts/                 Ingestion and embedding utilities
knowledge/               Raw and processed curriculum data
public/generated-docs/   Prepared instructional images
docs/assets/             README screenshots
```

## Verification

```bash
npx tsc --noEmit --incremental false
npx eslint src/app/page.tsx src/app/api/chat/route.ts src/app/api/researcher
```
