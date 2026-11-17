# VLM Benchmark

A workbench for benchmarking vision language models (VLMs) from different cloud providers on the same vision tasks, side by side.

## Why

Choosing a VLM for a real vision workload (OCR, document and flyer extraction, visual QA, object detection) is hard to do from leaderboards alone. Accuracy, latency, token cost and output format all vary by provider and by task. This app lets you run your own images through several models with the same prompt and compare the results directly.

## Features

- **Multi-provider**: Anthropic Claude, Google Gemini, AWS Bedrock (Claude, Amazon Nova and others) and local models through Ollama.
- **Side-by-side comparison**: run one prompt and image set against several models and compare output, latency, token usage and cost.
- **Image annotation**: draw rectangles, ellipses, arrows and freehand marks on images to point a model at a region. Annotations are saved with each message, so the history shows exactly what each model saw.
- **Skills**: reusable task definitions (system prompt, Jinja2 task template, few-shot examples, metrics). Bundled skills cover OCR, visual QA, object detection and flyer extraction, and you can create and edit your own in the UI.
- **Streaming results**: tokens stream back live over SSE. Structured JSON/CSV output is rendered as tables you can download.
- **Workspaces and history**: chats, images and results persist in Postgres and S3-compatible storage, so runs can be revisited and compared later.
- **Auth**: multi-user login with workspace invites, or a single-user mode with no login.

## Architecture

```
React + Vite + Zustand  ──fetch / SSE──▶  FastAPI
                                            ├── providers/  Claude · Gemini · Bedrock · Ollama
                                            ├── graph/      LangGraph: preprocess → prompt → invoke → metrics
                                            ├── Postgres    chats, messages, skills, metrics
                                            └── S3 / MinIO  uploaded images
```

## Quick start

**Prerequisites:** Docker with Compose, plus an API key for at least one provider.

```bash
git clone <this-repo> && cd vlm-benchmark
cp .env.example .env    # add the provider keys you want to use
make dev                # Postgres + MinIO + backend + frontend, with hot reload
```

| Service | URL |
|---|---|
| App | http://localhost:5173 |
| Backend API | http://localhost:8080 |
| MinIO console | http://localhost:9001 (`minioadmin` / `minioadmin`) |
| Postgres | `postgres://vlm:vlm@localhost:5433/vlm` |

Log in with `admin@local` / `admin`, or set `AUTH_DISABLED=true` in `.env` to skip login (local use only).

Database migrations run automatically when the backend starts.

### Provider configuration

Set whichever of these you need in `.env`. All models are listed in the picker, but a run only succeeds for providers with valid credentials.

| Provider | Variables |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY` |
| Google Gemini | `GOOGLE_API_KEY` |
| AWS Bedrock | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` |
| Ollama | `OLLAMA_BASE_URL` (default `http://localhost:11434`) |

You can also enter API keys per request in the Settings panel. Keys entered there are never saved.

### Other commands

```bash
make down          # stop the stack (keeps data)
make down-clean    # stop and wipe Postgres + MinIO volumes
make migration MSG="add foo column"   # create a new Alembic migration
make type-check    # frontend type check
```

To run services without Docker (requires your own Postgres and MinIO): `make backend` and `make frontend`. The backend needs Python 3.12+ and [uv](https://docs.astral.sh/uv/); the frontend needs Node 20+.

## Writing skills

A skill is a YAML file with a `name`, `system_prompt`, `task_template` (Jinja2), optional `few_shot_examples`, and `metrics`. See `backend/skills/` for examples. Skills created in the UI are stored in the database and versioned per run.

## Deployment

The production build is a single Docker image that serves both the API and the built frontend. See [DEPLOY.md](DEPLOY.md) for Google Cloud Run with Cloud SQL and GCS. Any host that can run a container next to Postgres and S3-compatible storage will work.

## License

[Apache 2.0](LICENSE)
