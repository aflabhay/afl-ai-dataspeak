# 🤖 Claude-Powered BigQuery & Fabric Conversational Analytics

A full-stack application that lets users query **Google BigQuery** and **Microsoft Fabric (SQL Server)** using natural language — powered by **Anthropic Claude**.

No SQL knowledge required. Just ask questions, get answers.

---

## 📐 Architecture Overview

```
User (Browser)
     │
     ▼
┌─────────────────────────────────────────────────────┐
│                  Next.js Frontend                   │
│         (Chat UI + Results Visualization)           │
└─────────────────────┬───────────────────────────────┘
                      │ REST API
                      ▼
┌─────────────────────────────────────────────────────┐
│                 Express.js Backend                  │
│                                                     │
│  ┌──────────────┐      ┌──────────────────────────┐ │
│  │  Claude API  │      │   Query Orchestrator     │ │
│  │  (NL → SQL) │◄────►│  (Route BQ vs Fabric)    │ │
│  └──────────────┘      └──────────┬───────────────┘ │
│                                   │                 │
│              ┌────────────────────┴──────────────┐  │
│              ▼                                   ▼  │
│  ┌───────────────────────┐   ┌───────────────────┐  │
│  │  BigQuery Client      │   │  Fabric/SQL Client │  │
│  │  (google-cloud/bq)   │   │  (mssql)           │  │
│  └───────────────────────┘   └───────────────────┘  │
└─────────────────────────────────────────────────────┘
                      │
          ┌───────────┴────────────┐
          ▼                        ▼
┌──────────────────┐    ┌──────────────────────┐
│   Google BigQuery│    │  Microsoft Fabric     │
│   (GCP Project)  │    │  Data Warehouse       │
└──────────────────┘    └──────────────────────┘
```

---

## 🗂️ Project Structure

```
claude-bigquery-app/
│
├── 📁 src/                          # Backend source code
│   ├── 📁 api/                      # Express routes
│   │   ├── chat.routes.js           # /api/chat endpoints
│   │   ├── schema.routes.js         # /api/schema endpoints
│   │   └── health.routes.js         # /api/health endpoint
│   │
│   ├── 📁 claude/                   # Claude AI integration
│   │   ├── claude.client.js         # Anthropic SDK wrapper
│   │   ├── prompt.builder.js        # System prompt construction
│   │   └── sql.extractor.js         # Extract SQL from Claude response
│   │
│   ├── 📁 bigquery/                 # BigQuery integration
│   │   ├── bigquery.client.js       # BigQuery SDK wrapper
│   │   ├── schema.fetcher.js        # Fetch table schemas
│   │   └── query.runner.js          # Execute & return results
│   │
│   ├── 📁 fabric/                   # Microsoft Fabric integration
│   │   ├── fabric.client.js         # mssql connection wrapper
│   │   ├── schema.fetcher.js        # Fetch Fabric schemas
│   │   └── query.runner.js          # Execute & return results
│   │
│   └── 📁 utils/                    # Shared utilities
│       ├── logger.js                # Winston logger
│       ├── error.handler.js         # Global error handling
│       └── cost.estimator.js        # BigQuery cost estimation
│
├── 📁 frontend/                     # Next.js frontend
│   ├── 📁 components/
│   │   ├── ChatWindow.jsx           # Main chat interface
│   │   ├── MessageBubble.jsx        # Individual message
│   │   ├── ResultsTable.jsx         # Query results display
│   │   ├── SourceSelector.jsx       # BQ vs Fabric toggle
│   │   └── SqlPreview.jsx           # Generated SQL preview
│   │
│   ├── 📁 pages/
│   │   ├── index.jsx                # Main app page
│   │   └── api/proxy.js             # API proxy route
│   │
│   └── 📁 styles/
│       └── globals.css              # Global styles
│
├── 📁 config/                       # Configuration files
│   ├── default.js                   # Default config
│   └── schema.config.js             # Table/dataset config
│
├── 📁 tests/                        # Test suites
│   ├── 📁 unit/
│   │   ├── claude.test.js
│   │   ├── bigquery.test.js
│   │   └── sql.extractor.test.js
│   └── 📁 integration/
│       └── api.test.js
│
├── 📁 .github/
│   └── 📁 workflows/
│       ├── ci.yml                   # CI pipeline
│       └── cd.yml                   # CD pipeline (deploy)
│
├── 📁 docs/
│   ├── SETUP.md                     # Detailed setup guide
│   ├── API.md                       # API documentation
│   └── CONTRIBUTING.md              # Contribution guide
│
├── 📁 scripts/
│   ├── setup.sh                     # One-click local setup
│   └── test.sh                      # Run all tests
│
├── .env.example                     # Environment variables template
├── .gitignore
├── package.json                     # Backend dependencies
├── server.js                        # Express entry point
└── docker-compose.yml               # Local dev with Docker
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Google Cloud account with BigQuery access
- Anthropic API key
- (Optional) Microsoft Fabric SQL endpoint

### 1. Clone & Install
```bash
git clone https://github.com/YOUR_ORG/claude-bigquery-app.git
cd claude-bigquery-app
npm install
cd frontend && npm install && cd ..
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Run Locally
```bash
# Option A: Direct
npm run dev

# Option B: Docker
docker-compose up
```

### 4. Open App
```
http://localhost:3000
```

---

## 🔄 How It Works — Step by Step

```
1. User types:  "Show me top 10 NNNOW conversations by resolution time this week"
       │
       ▼
2. Frontend sends POST /api/chat
   { question: "...", source: "bigquery", dataset: "DCOE_Production" }
       │
       ▼
3. Backend fetches schema for relevant tables from BigQuery
       │
       ▼
4. Claude receives:
   - System prompt (with schema context)
   - User question
   → Returns: SQL query + explanation
       │
       ▼
5. Cost estimator checks GB scanned (must be < 5GB)
       │
       ▼
6. BigQuery / Fabric executes the SQL
       │
       ▼
7. Results returned to frontend as JSON
       │
       ▼
8. Frontend renders table + SQL preview
```

---

## 🌍 Environment Variables

| Variable | Description | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | ✅ |
| `GCP_PROJECT_ID` | GCP project ID | ✅ (BigQuery) |
| `GCP_DATASET` | Default BigQuery dataset | ✅ (BigQuery) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to GCP service account JSON | ✅ (BigQuery) |
| `FABRIC_SERVER` | Fabric SQL endpoint | ✅ (Fabric) |
| `FABRIC_DATABASE` | Fabric database name | ✅ (Fabric) |
| `FABRIC_CLIENT_ID` | Azure AD app client ID | ✅ (Fabric) |
| `FABRIC_CLIENT_SECRET` | Azure AD app secret | ✅ (Fabric) |
| `FABRIC_TENANT_ID` | Azure tenant ID | ✅ (Fabric) |
| `PORT` | Backend port (default: 4000) | ❌ |
| `MAX_BQ_SCAN_GB` | Max BigQuery scan limit (default: 5) | ❌ |

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat` | Send a natural language question |
| `GET` | `/api/schema/:source` | Get available tables/schemas |
| `GET` | `/api/health` | Health check |

See [docs/API.md](docs/API.md) for full API documentation.

---

## 🚢 CI/CD Pipeline

```
Push to feature/* branch
        │
        ▼
   GitHub Actions CI
   ├── Lint (ESLint)
   ├── Unit Tests (Jest)
   ├── Integration Tests
   └── Build Check
        │
        ▼ (merge to main)
   GitHub Actions CD
   ├── Build Docker image
   ├── Push to Container Registry
   └── Deploy to Cloud Run / Azure
```

---

## 🛡️ Security

- API keys stored in environment variables, never in code
- BigQuery queries are read-only (SELECT only)
- Cost guard: queries scanning > 5GB are blocked
- SQL injection prevention via parameterized queries
- Rate limiting on all API endpoints

---

## 📄 License

MIT
