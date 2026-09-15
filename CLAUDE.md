@AGENTS.md

# Dayboard by DD — notes for AI assistants

- Start with `docs/architecture.md`; the rules there (positional panel
  children, stores in three files, ids never move, times stored with an offset)
  are load-bearing and pinned by tests.
- Every personal fact is a setting in `data/settings.json`, read through
  `src/lib/settings.ts`. Never hardcode a location, a team, a name, a token.
- `npm test`, `npm run lint`, `npx tsc --noEmit` and `npm run validate` must
  pass before a change is done. `validate` also scans for credentials and the
  terms in `.private-terms` (gitignored); the public repo depends on it. Never
  write those terms into a tracked file, not even split into pieces.
- The board runs as scheduled tasks from a production build. After code
  changes, `npm run deploy`, not a dev server on the same port.
- Comments explain *why*. Keep that style when adding to a file.
