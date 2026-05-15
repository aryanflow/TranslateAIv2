# API changelog

## 0.0.1

- Langdock-backed translation and scoring (OpenAI-compatible + Gemini via Langdock Google API).
- Version and changelog exposed under `GET /version` and `GET /version/changelog`.
- `GET /version` JSON includes `commit` (`sha`, `short`, `message`) and embedded `changelog` (markdown from `apps/api/CHANGELOG.md` when present). Set `GIT_SHA`, `BUILD_TIME`, and `GIT_COMMIT_MESSAGE` in deploy (or Docker `--build-arg`) so production reflects the deployed revision.
