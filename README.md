# Blocks & Bots Assistant

A retrieval-augmented assistant for educators working with ScratchJr, micro:bit, and classroom robotics materials.

The application answers questions using indexed curriculum content, shows a relevant document image when the retrieved material supports one, and provides a Researcher workspace for managing and testing knowledge files.

<p align="center">
  <img
    src="docs/assets/visual-retrieval-demo.png"
    alt="Blocks & Bots Assistant displaying a curriculum-grounded answer and a related build image"
    width="900"
  />
</p>

<p align="center">
  <strong>Next.js 16 · React 19 · TypeScript · Gemini · Supabase · Hugging Face Transformers</strong>
</p>

## Current status

This repository is a working prototype, not a production-ready multi-user service.

- The main Assistant and the local Researcher workflow are implemented.
- The Assistant uses Google Gemini to generate responses from retrieved curriculum context.
- Embeddings are generated with the local `Supabase/gte-small` model and stored in Supabase.
- The Researcher training route runs Python and writes processed files to the server filesystem.
- Authentication, role-based access, and per-user rate limiting are not implemented yet.
- Researcher file operations require a persistent, writable server filesystem and should not be assumed to work unchanged on a serverless deployment such as Vercel.
- Uploading or training a file does not automatically commit or push files to GitHub.

## What the Assistant does

Teachers can ask questions such as:

- “How do I pair a micro:bit?”
- “Show me Step 4 of the micro:bit build.”
- “Walk me through the complete build.”
- “What about the red wire?”
- “Show me the final build image.”

Depending on the question, the server uses intent routing, exact metadata lookup, vector search, or a combination of those methods. Gemini receives the selected curriculum context and returns an educator-facing answer.

The current Assistant supports:

- Questions about indexed ScratchJr, micro:bit, and robotics materials
- Exact build-step and pairing-step routing
- Complete build and lesson walkthrough requests
- Follow-up questions that depend on recent conversation history
- Source metadata such as file, page, slide, and section when available
- Relevant images already associated with retrieved curriculum chunks
- Suppression of document images for greetings, short unclear input, and unrelated conversation
- A stop button for an in-progress Assistant request

The application does not perform open-web research or generate new instructional diagrams. Displayed instructional images come from locally prepared curriculum assets or images extracted during ingestion.

## Researcher workspace

The Researcher workspace currently has two views.

### Files

Researchers can:

- Upload PDF, DOCX, PPTX, and common image files up to 25 MB
- View or download files
- Train or retrain one file
- Cancel training for a file while keeping the original file
- Permanently delete a file and its related processed and Supabase records

Training parses the selected file with the Python ingestion code, creates chunks, generates local embeddings with `Supabase/gte-small`, and upserts those chunks into the Supabase `documents` table.

`Cancel` means untrain: indexed chunks are removed, but the original file remains. `Delete` permanently removes the original file and related application data after confirmation.

### Improve answers

Researchers can:

1. Select one trained file
2. Ask a test question using that file’s extracted content
3. Review the generated answer
4. Write the answer they want instead
5. Save the feedback and retrain that file’s retrieval data

The saved feedback keeps the tested question, the generated answer, and the teacher’s corrected answer together. Only the question and corrected answer are used as correction content for retrieval; the incorrect answer is retained as feedback metadata rather than embedded as approved knowledge.

This is retrieval correction, not fine-tuning. It adds a correction chunk and regenerates embeddings for the selected file; it does not modify Gemini’s model weights.

<p align="center">
  <img
    src="docs/assets/researcher-feedback-workflow.png"
    alt="Researcher workflow for testing and improving an answer"
    width="850"
  />
</p>

## Architecture

```text
Reviewed curriculum chunks or a Researcher upload
                     |
                     v
        Text/image extraction and chunking
                     |
                     v
       Local gte-small embedding generation
                     |
                     v
       Supabase documents table + pgvector
                     |
                     v
User question -> intent/context routing -> retrieval
                     |
                     v
       Gemini with selected curriculum context
                     |
                     v
          Answer + sources + selected images
```

The main reviewed-curriculum pipeline and the browser-triggered Researcher pipeline are related but separate:

- The reviewed pipeline uses the files under `ingestion/`, the `/review` interface, `reviewed_documents.json`, and `scripts/upload-embeddings.ts`.
- The Researcher pipeline processes one selected active file with `ingestion/researcher_ingest.py` and `scripts/train-researcher-file.ts`.

## Technology

- Next.js 16 App Router and Route Handlers
- React 19 and TypeScript
- Google Gemini through `@google/genai`
- Supabase Postgres with a `documents` table and a `match_documents` vector-search RPC
- `Supabase/gte-small` embeddings through `@huggingface/transformers`
- Python document parsing with PyMuPDF, `python-docx`, and `python-pptx`
- CSS Modules

## Local setup

### Requirements

- Node.js compatible with Next.js 16
- Python 3 with virtual-environment support
- A Supabase project configured with the expected `documents` table and `match_documents` RPC
- A Google Gemini API key

### Install JavaScript dependencies

```bash
npm install
```

### Configure environment variables

Create `.env.local` in the project root:

```dotenv
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
SUPABASE_URL=your_supabase_project_url
SUPABASE_SECRET_KEY=your_supabase_server_secret
```

`GEMINI_MODEL` is optional; the application currently defaults to `gemini-2.5-flash`.

Never expose `SUPABASE_SECRET_KEY` in client-side code or commit `.env.local` to Git.

### Install Python dependencies

The Researcher training route attempts to prepare a project `.venv` automatically. For an explicit local setup, run:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r ingestion/requirements.txt
```

### Start the application

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

The database health endpoint is available at [http://localhost:3000/api/health](http://localhost:3000/api/health).

## Main reviewed-document pipeline

The repository also contains a review-oriented ingestion workflow for preparing the main curriculum knowledge base.

Typical commands are:

```bash
python -m ingestion.run
python -m ingestion.validate
```

After review decisions have been completed and finalized, embeddings can be uploaded with:

```bash
npm run upload-embeddings
```

Be careful: `scripts/upload-embeddings.ts` clears and replaces the current contents of the Supabase `documents` table. It should only be run when the reviewed dataset is ready to become the complete knowledge base.

Researcher users do not run these commands from the browser. The Researcher `Train` button uses the separate single-file route described above.

## Project structure

```text
src/app/                         Next.js pages and route handlers
src/app/api/chat/                Main Assistant API
src/app/api/researcher/          Researcher file, chat, training, and correction APIs
src/lib/rag/                     Intent parsing, embeddings, retrieval, and generation helpers
src/lib/researcher/              Researcher manifest handling
ingestion/                       Python document parsers and review pipeline
scripts/                         Embedding and ingestion utilities
knowledge/                       Raw, processed, reviewed, and manifest data
public/generated-docs/           Prepared document-page images used by the UI
docs/assets/                     README screenshots
```

## Deployment notes

The Assistant can be deployed after its Gemini and Supabase environment variables are configured. The Researcher workspace needs additional production work because it currently:

- Writes uploaded and processed files to the application filesystem
- Creates or uses a local Python virtual environment
- Runs Python and local embedding processes from Next.js route handlers
- Can perform privileged Supabase mutations
- Has no authentication or administrator authorization

Before exposing the Researcher workspace to a team, add authentication, restrict Researcher APIs to administrators, add rate limiting and concurrency controls, and move uploaded/processed files to persistent object storage or another durable processing service.

## Verification

```bash
npx tsc --noEmit --incremental false
npx eslint src/app/page.tsx src/app/api/chat/route.ts src/app/api/researcher
```

Additional manual QA notes are available in `docs/TEST_RESULTS.md` and `docs/PROJECT_STATUS.md`.
