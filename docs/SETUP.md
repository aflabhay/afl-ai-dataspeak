# Setup Guide

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 18+ | https://nodejs.org |
| Git | any | https://git-scm.com |
| gcloud CLI | any | https://cloud.google.com/sdk |
| Docker | any (optional) | https://docker.com |

---

## 1. Clone the Repo

```bash
git clone https://github.com/YOUR_ORG/claude-bigquery-app.git
cd claude-bigquery-app
```

---

## 2. Install Dependencies

```bash
# Backend
npm install

# Frontend
cd frontend && npm install && cd ..
```

---

## 3. Get Your OpenAI API Key

1. Go to https://platform.openai.com/api-keys
2. Click **Create new secret key**
3. Copy the key (starts with `sk-...`)
4. Add to your `.env`: `OPENAI_API_KEY=sk-...`

**Model used:** `gpt-4o-mini` — chosen for lowest cost while maintaining accuracy.

Cost reference:
- Input:  $0.15 per 1M tokens
- Output: $0.60 per 1M tokens
- Typical query: ~500 tokens input + ~200 tokens output = **~$0.0002 per question**

---

## 4. Set Up BigQuery Access

### Option A: Service Account (Recommended for Production)

```bash
# Create service account
gcloud iam service-accounts create bigquery-chat \
  --display-name="BigQuery Chat App"

# Grant BigQuery permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:bigquery-chat@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:bigquery-chat@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"

# Download key
gcloud iam service-accounts keys create ./bq-service-account.json \
  --iam-account=bigquery-chat@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

Add to `.env`:
```
GOOGLE_APPLICATION_CREDENTIALS=./bq-service-account.json
```

### Option B: Your Own Google Account (Development Only)

```bash
gcloud auth application-default login
```

---

## 5. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values. Minimum required:
```
AI_PROVIDER=openai
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...
GCP_PROJECT_ID=your-project-id
GCP_DATASET=DCOE_Production
GOOGLE_APPLICATION_CREDENTIALS=./bq-service-account.json
```

---

## 6. Run the App

```bash
npm run dev
```

Open http://localhost:3000 and start asking questions!

---

## 7. Deploy to Production

See the CI/CD section in the main README and `.github/workflows/cd.yml`.

Required GitHub Secrets to set in your repo settings:
- `GCP_PROJECT_ID`
- `GCP_SA_KEY` (base64-encoded service account JSON)
- `OPENAI_API_KEY`
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
