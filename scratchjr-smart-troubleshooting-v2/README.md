# Smart troubleshooting v2

Replace the matching files in your project with the files in this ZIP.

Included:

- `src/app/api/chat/route.ts`
- `src/lib/rag/gemini.ts`
- `src/lib/rag/intent.ts`
- `src/lib/rag/lessons.ts`

This version keeps the detailed Lesson + Supplement + Journal behavior and changes connector troubleshooting so that:

- a missing step/photo triggers a useful clarification instead of a blanket refusal;
- step-specific troubleshooting receives the exact approved step first;
- the assistant does not treat the curriculum as an exhaustive ban on practical workarounds;
- the assistant never uses male/female connector terminology;
- exact build-step images remain consistent.

Run:

```bash
unzip -o ~/Downloads/scratchjr-smart-troubleshooting-v2.zip -d .
npx tsc --noEmit
rm -rf .next
npm run dev
```

Test in a fresh chat:

```text
I only have plug/plug wires, but I need socket/socket wires. What can I do?
```

Expected: it should ask for the build step or a photo while suggesting a compatibility check. It should not end by simply telling the learner to obtain the correct wire.
