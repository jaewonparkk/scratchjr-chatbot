# Blocks & Bots AI Chatbot — Project Status

**Date:** July 21, 2026  
**Project:** `scratchjr-chatbot`  
**Purpose:** Mid-project documentation and checkpoint

---

## 1. Project Goal

Build an AI assistant for teachers, parents, facilitators, and learners using:

- ScratchJr
- Coding as Another Language: Blocks & Bots
- micro:bit
- Physical computing
- Circuitry and robotics
- Curriculum lessons
- Troubleshooting and setup instructions

The assistant should:

1. Answer only from approved curriculum materials.
2. Avoid inventing wiring, safety, lesson, or troubleshooting instructions.
3. Return source references.
4. Display relevant approved images when appropriate.
5. Understand follow-up questions within the same conversation.
6. Use exact numbered-step and lesson routing when a user asks for `Step N` or `Lesson N`.

---

## 2. Current Technology Stack

### Frontend

- Next.js 16
- React
- TypeScript
- App Router
- CSS Modules

### Backend

- Next.js Route Handlers
- Supabase Postgres
- `pgvector`
- Supabase service-role access for server-side operations

### Retrieval

- Local embeddings generated with:
  - `Supabase/gte-small`
  - 384 dimensions
  - Mean pooling
  - Normalized vectors

### Answer Generation

Current intended generation provider:

- Google Gemini
- `@google/genai`
- `gemini-2.5-flash`

Earlier experiments used Ollama, but the current direction is Gemini for:

- General grounded answers
- Exact build-step explanations
- Full build-guide explanations
- Image-aware explanations

### Document Processing

- Python ingestion pipeline
- `python-docx`
- `python-pptx`
- PyMuPDF
- Tesseract OCR
- Manual review interface

---

## 3. Current System Architecture

```text
Approved source files
        ↓
Python ingestion pipeline
        ↓
Extracted text, pages, slides, and images
        ↓
Manual review at /review
        ↓
reviewed_documents.json
        ↓
Local gte-small embeddings
        ↓
Supabase documents table
        ↓
User question
        ↓
Conversation-aware route selection
        ↓
Exact lookup or vector search
        ↓
Gemini receives approved context
        ↓
Answer + sources + approved images
```

---

## 4. Approved Source Materials

The current knowledge base includes materials such as:

- `Blocks and Bots Download Instructions.pptx`
- `BotsBuildFeb2026.pdf`
- `Building Steps .docx`
- `Lessons_01-36_REVISED.docx`
- `Microbitpairing.pdf`
- `Virtues During Collaboration.docx`
- `2026 Final_ Final Build.png`

These materials cover:

- App download instructions
- micro:bit pairing
- Bot construction
- Breadboard and circuit steps
- ScratchJr lesson plans
- Collaboration virtues
- Final build references

---

## 5. Document Ingestion Pipeline

The project now has a custom Python ingestion system.

### Main files

```text
ingestion/
├── config.py
├── models.py
├── utils.py
├── chunker.py
├── run.py
├── validate.py
├── finalize_review.py
└── parsers/
    ├── docx_parser.py
    ├── pdf_parser.py
    ├── pptx_parser.py
    └── image_parser.py
```

### Supported source types

- `.docx`
- `.pdf`
- `.pptx`
- `.png`
- `.jpg`
- `.jpeg`
- `.webp`
- `.bmp`
- `.tif`
- `.tiff`

### Processing behavior

#### DOCX

- Extracts paragraphs
- Extracts tables
- Extracts embedded images
- Preserves section information when possible

#### PDF

- Extracts native text
- Renders pages to images
- Uses OCR when native text is missing or insufficient
- Records page number
- Stores processed page-image paths

#### PPTX

- Extracts text per slide
- Stores slide number
- Extracts slide images

#### Images

- Copies the original image into the processed image directory
- Runs OCR
- Flags the image for manual review

### Generated files

```text
knowledge/processed/
├── documents.json
├── review_required.json
├── review_decisions.json
├── reviewed_documents.json
├── rejected_documents.json
├── parse_errors.json
└── images/
```

---

## 6. Validation and Manual Review

### Validation

`ingestion/validate.py` was changed from a hardcoded validator into a dynamic validator.

It now checks:

- Every raw source file is processed
- PDF page coverage
- PPTX slide coverage
- Chunk IDs
- Required fields
- Image paths
- Review requirements
- Parse errors
- Supported file types

### Manual review interface

Route:

```text
http://localhost:3000/review
```

Capabilities:

- Shows original image
- Shows extracted or OCR text
- Allows text correction
- Approve
- Reject
- Save draft
- Persists review decisions immediately

Review decisions are saved to:

```text
knowledge/processed/review_decisions.json
```

Final reviewed chunks are created with:

```bash
python -m ingestion.finalize_review
```

---

## 7. Supabase Database

### Current table

```text
public.documents
```

### Important fields

- `id`
- `chunk_id`
- `title`
- `content`
- `source_file`
- `file_type`
- `section`
- `page_number`
- `slide_number`
- `image_paths`
- `should_display_image`
- `metadata`
- `embedding`
- `created_at`

### Embedding type

```sql
extensions.vector(384)
```

### Search function

```text
public.match_documents(...)
```

It performs cosine-distance search using:

```sql
OPERATOR(extensions.<=>)
```

### Important database decision

The old `vector(1024)` schema is deprecated.

The current active schema is:

```text
vector(384)
```

The setup query containing:

```sql
drop table if exists public.documents cascade;
```

must not be rerun casually because it deletes all uploaded documents.

---

## 8. Embedding Pipeline

Embeddings are generated locally with:

```text
Supabase/gte-small
```

This avoids paid OpenAI or Voyage embedding APIs.

### Embedding flow

```text
Reviewed chunk
→ Title + section + content
→ 384-dimensional embedding
→ Supabase upload
```

### Upload script

```text
scripts/upload-embeddings.ts
```

Command:

```bash
npm run upload-embeddings
```

### Verified behavior

The database upload succeeded.

Vector search successfully retrieved:

- micro:bit pairing instructions
- relevant build pages
- Virtues Palette information

Example successful search:

```text
How do I pair the microbit?
```

Returned the correct pairing pages with similarity scores above 0.9.

---

## 9. Search API

Current route:

```text
POST /api/search
```

Request example:

```json
{
  "question": "How do I pair the microbit?",
  "matchCount": 5,
  "matchThreshold": 0.3
}
```

Response includes:

- Related chunks
- Similarity scores
- Source file
- Page or slide number
- Image paths
- Display-image flag
- Metadata

### Completed search improvements

- Duplicate content removal
- Extra candidate retrieval before deduplication
- Image-path preservation
- Lower threshold support for image retrieval

### Identified search limitation

Pure vector search is unreliable for exact numbered references.

Examples:

- `Step 1` can rank below `Step 4`
- `Lesson 29` can return Lesson 21 or Lesson 25
- A bare `Step 6` can retrieve both download and build instructions

Therefore exact numbers must bypass vector search.

---

## 10. Exact Step Routing

The project now recognizes that numbered build steps require exact lookup.

### Intended behavior

```text
microbit step 1
→ BotsBuildFeb2026 Step 1

step 2?
→ Use previous micro:bit build context
→ BotsBuildFeb2026 Step 2

show me the next one
→ Use previous referenced step
→ Return Step 3
```

### Why exact routing is necessary

Dense embeddings understand semantic similarity, but they do not reliably enforce ordinal identity.

Exact routing should use:

- Extracted step number
- Current conversation topic
- Previous referenced step
- Direct Supabase filtering

---

## 11. Exact Lesson Routing

Lesson-number questions must also bypass vector search.

### Intended behavior

```text
What is Lesson 29?
→ Directly retrieve Lesson 29 chunks
→ Send only Lesson 29 to Gemini
```

This prevents:

```text
Lesson 29
→ Lesson 21 and Lesson 25
```

### Required routing rule

A question matching:

```text
lesson + number
```

should query:

```text
Lessons_01-36_REVISED.docx
```

and verify the exact lesson number after retrieval.

### Typo normalization

The route should normalize common typos such as:

```text
llesson 1
→ lesson 1

steop
→ step
```

---

## 12. Conversation Memory

Earlier versions sent only the current question to the API.

That caused follow-ups to lose context.

### Current intended behavior

The frontend sends recent conversation history:

```json
{
  "question": "step 2?",
  "history": [
    {
      "role": "user",
      "content": "microbit step 1?"
    },
    {
      "role": "assistant",
      "content": "Step 1..."
    }
  ]
}
```

The backend should detect conversation topics:

- `microbit-build`
- `download-instructions`
- `pairing`
- `lesson`

It should also resolve:

- `next step`
- `previous step`
- `this step`
- `same image`
- `step 2?`

### Correct ambiguity behavior

With no previous context:

```text
What's Step 6?
```

The chatbot should ask:

```text
Which guide do you mean: the micro:bit building guide or the Blocks and Bots download instructions?
```

It should not guess.

---

## 13. Gemini Integration

Current intended SDK:

```text
@google/genai
```

Current intended model:

```text
gemini-2.5-flash
```

### Gemini responsibilities

Gemini should be used for:

- General grounded explanations
- Specific build-step explanations
- Full build-guide explanations
- Understanding approved build images
- Using recent conversation context

Gemini should not be used for:

- Simply returning an approved image
- Routing or clarification
- Exact database lookup
- Returning an existing source file

### Grounding rule

Gemini receives only approved retrieved context.

It must not invent:

- Wiring instructions
- Pin numbers
- Component names
- Wire colors
- Safety rules
- Lesson instructions
- Troubleshooting instructions

### Verification logging

Server logs should show:

```text
[Gemini] Calling model: gemini-2.5-flash
[Gemini] Response received: ...
```

API responses should include:

```json
{
  "generation": {
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "grounded": true
  }
}
```

---

## 14. Image Handling

### Image-serving route

```text
GET /api/source-image?path=...
```

The route:

- Serves approved processed images
- Restricts file access to `knowledge/processed/images`
- Prevents arbitrary file access
- Returns the correct MIME type

### Image display rules

Images should appear only when:

1. The user explicitly asks for an image
2. The user asks for a specific build step
3. The user asks for the full visual build sequence
4. The image is required to explain a physical construction step

Images should not appear for unrelated text questions.

Example:

```text
What is Lesson 1?
```

should not return:

```text
How to Pair Microbit
```

### Known image issue

Some DOCX chunks contain many image paths in one chunk.

The route currently uses one primary image per result to avoid returning every embedded image from an entire document.

### Virtues Palette

The Virtues Palette became searchable after adding a descriptive text label explaining that it is the approved reference image for ten collaboration virtues.

### Final Build Image

The final build image also required a human-written description because text embeddings cannot understand image meaning from pixels alone.

---

## 15. Frontend

Current main UI:

```text
src/app/page.tsx
src/app/page.module.css
```

### Features

- Chat message history
- User and assistant message styles
- Loading state
- Sources dropdown
- Approved image display
- Automatic scrolling
- Generation-provider badge

### Loading message

Current preferred loading message:

```text
Preparing your answer...
```

### Source duplication issue

Previously, the same title appeared under the image and again inside Sources.

The visible image caption was removed while remaining in `alt` and `title`.

---

## 16. Important Product Decisions

1. Python handles ingestion, OCR, validation, and review finalization.
2. TypeScript handles embeddings upload, search, chat routing, Supabase access, and frontend.
3. Embeddings are generated locally to avoid paid embedding APIs.
4. Gemini is used for grounded answer generation and image understanding.
5. Exact `Step N` and `Lesson N` requests bypass vector search.
6. Images are displayed intentionally, not automatically.
7. The assistant should clarify ambiguous requests rather than guess.
8. Approved source grounding is more important than producing an answer every time.

---

## 17. What Has Been Verified

### Verified successfully

- Supabase database connection
- `vector(384)` schema
- Local embedding generation
- Document upload
- Vector search
- micro:bit pairing retrieval
- Duplicate search-result removal
- Image-path storage
- Source image serving
- Virtues Palette retrieval
- Manual review persistence
- Dynamic ingestion validation
- Exact build pages exist in the database
- Frontend can render approved images
- Sources can be displayed

### Partially verified

- Exact build-step routing
- Full Step 1–10 sequence
- Gemini image explanations
- Multi-turn context routing
- Exact lesson routing
- Image-sequence requests
- Gemini provider badge

These features need a clean end-to-end test after the latest route changes.

---

## 18. Current Known Issues

### 1. Exact lesson routing needs final validation

Test:

```text
What is Lesson 1?
What is Lesson 29?
What is llesson 1?
```

Expected:

- Only the exact requested lesson
- No unrelated micro:bit source
- No unrelated image

### 2. Step follow-up context needs final validation

Test in one conversation:

```text
microbit step 1?
step 2?
show me the next one
```

Expected:

```text
Step 1
Step 2
Step 3
```

### 3. Ambiguous step questions

Test in a fresh session:

```text
What's Step 6?
```

Expected:

```text
Which guide do you mean?
```

### 4. Full build explanations

The assistant must explain each step rather than copying OCR strings.

### 5. Full image sequence

Test:

```text
I need images from step 1 to the end.
```

Expected:

- Step 1 through Step 10 images
- Correct order
- No claim that images are missing

### 6. Gemini confirmation

Verify:

- Terminal shows Gemini call logs
- API response includes `generation.provider = "gemini"`
- UI displays model badge

### 7. Source relevance

Sources should only come from chunks actually used in the answer.

---

## 19. Recommended Next Steps

### Priority 1 — Freeze and test the current architecture

Do not keep adding features until the latest route is tested systematically.

### Priority 2 — Create automated route tests

At minimum, test:

```text
microbit step 1
step 2
next step
what is lesson 29
show virtues palette
show final build
download instructions step 6
what's step 6
```

### Priority 3 — Add structured metadata during ingestion

Store metadata such as:

```json
{
  "document_type": "build-guide",
  "guide": "microbit-build",
  "step_number": 1,
  "lesson_number": null,
  "is_primary_image": true
}
```

This will remove fragile string matching.

### Priority 4 — Improve chunking

Each build step should include:

- Step title
- Human-reviewed description
- Associated image
- Step number
- Parts used
- Safety note
- Previous-step dependency

### Priority 5 — Save approved explanations

For physical build instructions, Gemini-generated explanations should be reviewed once and stored as approved content.

### Priority 6 — Add chat-session persistence

Later options:

- `sessionStorage`
- `localStorage`
- Supabase conversations table

### Priority 7 — Deployment image storage

For deployment, move local images to:

- Supabase Storage
- Private bucket
- Signed URLs

---

## 20. Proposed Test Matrix

| Test | Expected route | Expected result |
|---|---|---|
| `How do I pair the microbit?` | Vector search | Pairing pages |
| `microbit step 1` | Exact build step | Build Step 1 |
| `step 2?` after Step 1 | Conversation-aware exact step | Build Step 2 |
| `show me the next one` | Previous step + 1 | Build Step 3 |
| `What is Lesson 29?` | Exact lesson lookup | Lesson 29 only |
| `What is llesson 1?` | Typo normalization + exact lesson | Lesson 1 only |
| `Show me the virtues palette` | Image search | Virtues Palette |
| `Show me the final build` | Image search | Final Build image |
| `I need images from step 1 to the end` | Exact build-image sequence | Step 1–10 images |
| `What's Step 6?` in fresh chat | Clarification | Ask which guide |
| `What's Step 6?` after download discussion | Conversation-aware download step | Download Step 6 |
| `What's Step 6?` after build discussion | Conversation-aware build step | Build Step 6 |

---

## 21. Commands Reference

### Activate Python environment

```bash
source .venv/bin/activate
```

### Run ingestion

```bash
python -m ingestion.run
```

### Validate ingestion

```bash
python -m ingestion.validate
```

### Finalize review

```bash
python -m ingestion.finalize_review
```

### Upload embeddings

```bash
npm run upload-embeddings
```

### Run development server

```bash
npm run dev
```

### Clear Next.js cache

```bash
rm -rf .next
npm run dev
```

### Type check

```bash
npx tsc --noEmit
```

---

## 22. Current Checkpoint

The project is no longer a basic chatbot UI.

It now includes:

- A real document-ingestion system
- OCR and image extraction
- Manual human review
- Validated approved content
- Local embeddings
- A vector database
- Semantic search
- Source attribution
- Image retrieval
- Exact-step routing
- Planned exact-lesson routing
- Conversation-history handling
- Gemini text and image generation
- Grounding and hallucination controls

The central remaining challenge is:

> Can the system reliably select the correct approved material for the exact user intent, especially across numbered steps, lessons, images, and follow-up questions?

That should be the focus of the next development phase.
