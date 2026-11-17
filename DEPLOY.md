# Deploying VLM Benchmark

## Architecture recap

```
Browser ──HTTP──> Cloud Run (FastAPI + React static)
                       │
                       ├── Postgres  (managed:  Cloud SQL / RDS / Supabase / Neon)
                       ├── S3 bucket (managed:  GCS / S3 / R2 / DigitalOcean Spaces)
                       └── Provider APIs (Anthropic / Google / AWS Bedrock / Ollama)
```

The same Docker image works in all environments — only env vars change.

---

## Local dev (one command)

```bash
cp .env.example .env       # fill in your provider keys
make dev                   # Postgres + MinIO + backend + frontend
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8080
- MinIO console: http://localhost:9001 (login: `minioadmin` / `minioadmin`)
- Postgres: `postgres://vlm:vlm@localhost:5433/vlm`  (host port 5433 to avoid conflicts)
- Admin user is auto-seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars
  (defaults to `admin@local` / `admin` for local dev).

Alembic migrations run automatically at backend startup. To apply them by
hand: `make migrate`.

---

## GCP Cloud Run + Cloud SQL + GCS (recommended path)

### Prerequisites

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
                       sqladmin.googleapis.com storage.googleapis.com
```

### 1. Create the Postgres instance

```bash
export PROJECT_ID=$(gcloud config get-value project)
export REGION=us-central1

gcloud sql instances create vlm-pg \
    --database-version=POSTGRES_16 \
    --tier=db-g1-small \
    --region=$REGION \
    --storage-size=10GB

gcloud sql databases create vlm --instance=vlm-pg
gcloud sql users create vlm --instance=vlm-pg --password='STRONG_PASSWORD'
```

`DATABASE_URL` for the deployed container will look like:
```
postgresql+asyncpg://vlm:STRONG_PASSWORD@/vlm?host=/cloudsql/$PROJECT_ID:$REGION:vlm-pg
```

### 2. Create the GCS bucket (S3-compatible)

```bash
gsutil mb -l $REGION gs://$PROJECT_ID-vlm-images
```

Generate an HMAC key (S3 compatibility credential):

```bash
SA="vlm-storage@$PROJECT_ID.iam.gserviceaccount.com"
gcloud iam service-accounts create vlm-storage --display-name="VLM S3 access"
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA" --role="roles/storage.objectAdmin"

gcloud storage hmac create $SA   # capture access_id + secret
```

GCS S3 endpoint: `https://storage.googleapis.com`

### 3. Store secrets

```bash
echo -n 'STRONG_PASSWORD'                  | gcloud secrets create DB_PASSWORD --data-file=-
echo -n 'GOOG1...'                         | gcloud secrets create S3_ACCESS_KEY --data-file=-
echo -n 'long-hmac-secret-here'            | gcloud secrets create S3_SECRET_KEY --data-file=-
python -c 'import secrets; print(secrets.token_urlsafe(48))' \
                                           | gcloud secrets create SESSION_SECRET --data-file=-
echo -n 'sk-ant-...'                       | gcloud secrets create ANTHROPIC_API_KEY --data-file=-
echo -n 'AIza...'                          | gcloud secrets create GOOGLE_API_KEY --data-file=-
echo -n 'ChangeMe-AdminPassword'           | gcloud secrets create ADMIN_PASSWORD --data-file=-

# Grant Cloud Run's runtime SA access to each secret
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
for S in DB_PASSWORD S3_ACCESS_KEY S3_SECRET_KEY SESSION_SECRET ANTHROPIC_API_KEY GOOGLE_API_KEY ADMIN_PASSWORD; do
  gcloud secrets add-iam-policy-binding $S \
    --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor"
done
```

### 4. Build + push

```bash
export IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/vlm-benchmark/app:latest
gcloud artifacts repositories create vlm-benchmark \
    --repository-format=docker --location=$REGION || true
gcloud auth configure-docker $REGION-docker.pkg.dev
make push
```

### 5. Deploy

```bash
gcloud run deploy vlm-benchmark \
  --image $IMAGE \
  --region $REGION \
  --port 8080 \
  --memory 2Gi --cpu 2 \
  --min-instances 0 --max-instances 5 \
  --no-allow-unauthenticated \
  --add-cloudsql-instances $PROJECT_ID:$REGION:vlm-pg \
  --set-env-vars "
      DATABASE_URL=postgresql+asyncpg://vlm@/vlm?host=/cloudsql/$PROJECT_ID:$REGION:vlm-pg,
      S3_ENDPOINT_URL=https://storage.googleapis.com,
      S3_BUCKET=$PROJECT_ID-vlm-images,
      S3_REGION=auto,
      S3_PUBLIC_ENDPOINT_URL=https://storage.googleapis.com,
      ADMIN_EMAIL=you@example.com,
      SESSION_COOKIE_NAME=vlm_session,
      SESSION_LIFETIME_HOURS=720
  " \
  --set-secrets "
      ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,
      GOOGLE_API_KEY=GOOGLE_API_KEY:latest,
      S3_ACCESS_KEY=S3_ACCESS_KEY:latest,
      S3_SECRET_KEY=S3_SECRET_KEY:latest,
      SESSION_SECRET=SESSION_SECRET:latest,
      ADMIN_PASSWORD=ADMIN_PASSWORD:latest
  "
```

The backend runs `alembic upgrade head` at startup, so the schema appears
automatically the first time a fresh DB boots.

### 6. First login

```bash
gcloud run services add-iam-policy-binding vlm-benchmark \
  --region $REGION --member="user:you@example.com" --role="roles/run.invoker"

# Tunnel locally to log in
gcloud run services proxy vlm-benchmark --region $REGION --port 8080
# Open http://localhost:8080  → log in with ADMIN_EMAIL / ADMIN_PASSWORD
```

---

## AWS (RDS + S3) — abbreviated

Use the same image. Substitute env vars:

```
DATABASE_URL=postgresql+asyncpg://vlm:STRONG@vlm-pg.xyz.us-east-1.rds.amazonaws.com:5432/vlm
S3_ENDPOINT_URL=https://s3.us-east-1.amazonaws.com
S3_PUBLIC_ENDPOINT_URL=https://s3.us-east-1.amazonaws.com
S3_BUCKET=acme-vlm-images
S3_ACCESS_KEY=AKIA...
S3_SECRET_KEY=...
```

Run on ECS, Fargate, Lightsail Containers, or any container host — no app
changes required.

---

## Adding additional users

Once an admin can log in, they can create invites:

```bash
# Log in (capture session cookie)
curl -c /tmp/cookies.txt -X POST $URL/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@example.com","password":"..."}'

# Create an invite
curl -b /tmp/cookies.txt -X POST $URL/api/auth/invite \
     -H 'Content-Type: application/json' \
     -d '{"email":"newuser@example.com","expires_in_hours":168}'
# → returns { accept_url: ".../accept-invite?token=..." }
```

Email the `accept_url` to the user. They land on the accept-invite page,
pick a password, and are signed in.

---

## Ollama sidecar (open-weight models)

Deploy Ollama as a separate container (GPU optional). In the main app set:

```
OLLAMA_BASE_URL=https://your-ollama-host:11434
```

Each request to a `provider=ollama` model is forwarded over HTTP.

---

## Database migrations in production

The backend runs `alembic upgrade head` at startup. For zero-downtime updates,
do migrations BEFORE the new image is rolled out by running migrations once
from a workstation:

```bash
DATABASE_URL=postgresql+asyncpg://... make migrate
```

Then deploy the new container with `--no-traffic`, verify, then shift traffic.
