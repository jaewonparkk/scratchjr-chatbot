# Flexible troubleshooting + consistent step images

Replace the included files in the project.

Changes:
- Exact micro:bit/download step questions always show their approved step image when available.
- Troubleshooting uses a dedicated Gemini prompt that can make clearly labeled, reversible, low-risk practical suggestions instead of stopping at "no approved substitute."
- Exact curriculum wiring facts remain grounded in approved materials.
- Existing detailed lesson, supplement, and journal behavior is preserved.

Run:

```bash
npx tsc --noEmit
rm -rf .next
npm run dev
```
