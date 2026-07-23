# ScratchJr detailed lesson bundle fix

Copy all four files into the matching paths in your project:

- `src/app/api/chat/route.ts`
- `src/lib/rag/gemini.ts`
- `src/lib/rag/intent.ts`
- `src/lib/rag/lessons.ts`

This version:

- keeps the existing intent parser and step/build routing
- moves Lesson lookup into `lessons.ts`
- combines the main lesson plan, Lesson supplements, and Journal files
- gives detailed Lesson answers by default
- gives short answers only for explicit brief/summary requests
- automatically shows only the requested Lesson's approved supplement/journal images
- prevents unrelated main-document images from appearing in exact Lesson answers

After copying:

```bash
npx tsc --noEmit
rm -rf .next
npm run dev
```

If the supplement or journal files were added after the last upload, run the ingestion/review/upload pipeline before testing.
