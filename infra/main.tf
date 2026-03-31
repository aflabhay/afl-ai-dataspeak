# ─────────────────────────────────────────────────────────────────────────────
# infra/main.tf
# AIDA — Google Cloud Run infrastructure
#
# Resources provisioned:
#   1. Artifact Registry   — Docker image repository
#   2. Service Accounts    — Cloud Run runtime SA + GitHub Actions CI/CD SA
#   3. IAM bindings        — BigQuery, Secret Manager, Artifact Registry access
#   4. Secret Manager      — All sensitive env vars
#   5. Cloud Run (backend) — Express API
#   6. Cloud Run (frontend)— Next.js app
# ─────────────────────────────────────────────────────────────────────────────

locals {
  backend_service  = "${var.app_name}-backend"
  frontend_service = "${var.app_name}-frontend"
  registry_id      = "${var.app_name}-registry"
  image_base       = "${var.region}-docker.pkg.dev/${var.project_id}/${local.registry_id}"
}

# ── Enable required APIs ──────────────────────────────────────────────────────

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "bigquery.googleapis.com",
    "bigquerystorage.googleapis.com",
    "iam.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

# ── Terraform state bucket IAM ───────────────────────────────────────────────
# Grant the deploying service account full object access on the state bucket
# so Terraform can read, write and delete state locks.

resource "google_storage_bucket_iam_member" "tf_state_sa" {
  bucket = "arvind-brands-poc-tf-state"
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${var.gcp_sa_email}"
}

# ── Artifact Registry ─────────────────────────────────────────────────────────

resource "google_artifact_registry_repository" "images" {
  repository_id = local.registry_id
  location      = var.region
  format        = "DOCKER"
  description   = "AIDA Docker images"

  depends_on = [google_project_service.apis]
}

# ── Service Account: Cloud Run runtime ────────────────────────────────────────
# This SA is attached to both Cloud Run services.
# It gets BigQuery and Secret Manager access — no JSON key needed.

resource "google_service_account" "cloud_run" {
  account_id   = "${var.app_name}-cloudrun-sa"
  display_name = "AIDA Cloud Run Runtime"
}

# BigQuery roles
resource "google_project_iam_member" "bq_data_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_project_iam_member" "bq_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Secret Manager — allow runtime SA to read secrets
resource "google_project_iam_member" "secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

# ── Service Account: GitHub Actions CI/CD ─────────────────────────────────────

resource "google_service_account" "github_actions" {
  account_id   = "${var.app_name}-github-actions"
  display_name = "AIDA GitHub Actions CI/CD"
}

resource "google_project_iam_member" "github_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_project_iam_member" "github_ar_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

resource "google_project_iam_member" "github_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# ── Secret Manager ────────────────────────────────────────────────────────────

resource "google_secret_manager_secret" "openai_api_key" {
  secret_id = "${var.app_name}-openai-api-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "openai_api_key" {
  secret      = google_secret_manager_secret.openai_api_key.id
  secret_data = var.openai_api_key
}

resource "google_secret_manager_secret" "anthropic_api_key" {
  count     = var.anthropic_api_key != "" ? 1 : 0
  secret_id = "${var.app_name}-anthropic-api-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "anthropic_api_key" {
  count       = var.anthropic_api_key != "" ? 1 : 0
  secret      = google_secret_manager_secret.anthropic_api_key[0].id
  secret_data = var.anthropic_api_key
}

resource "google_secret_manager_secret" "azure_client_id" {
  secret_id = "${var.app_name}-azure-client-id"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "azure_client_id" {
  secret      = google_secret_manager_secret.azure_client_id.id
  secret_data = var.azure_client_id
}

resource "google_secret_manager_secret" "azure_tenant_id" {
  secret_id = "${var.app_name}-azure-tenant-id"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "azure_tenant_id" {
  secret      = google_secret_manager_secret.azure_tenant_id.id
  secret_data = var.azure_tenant_id
}

resource "google_secret_manager_secret" "mssql_connection_string" {
  count     = var.mssql_connection_string != "" ? 1 : 0
  secret_id = "${var.app_name}-mssql-conn"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "mssql_connection_string" {
  count       = var.mssql_connection_string != "" ? 1 : 0
  secret      = google_secret_manager_secret.mssql_connection_string[0].id
  secret_data = var.mssql_connection_string
}

# ── Cloud Run: Backend (Express API) ─────────────────────────────────────────

resource "google_cloud_run_v2_service" "backend" {
  name     = local.backend_service
  location = var.region

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      min_instance_count = var.backend_min_instances
      max_instance_count = var.backend_max_instances
    }

    containers {
      # Image is updated by GitHub Actions on each deploy — Terraform manages infra only.
      # Initial placeholder; CI will push the real image on first deploy.
      image = "${local.image_base}/${local.backend_service}:latest"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true  # only charge CPU when processing a request
      }

      # ── Plain env vars ───────────────────────────────────────────────────
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "PORT"
        value = "8080"
      }
      env {
        name  = "AI_PROVIDER"
        value = var.ai_provider
      }
      env {
        name  = "OPENAI_MODEL"
        value = var.openai_model
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_FEEDBACK_DATASET"
        value = var.gcp_feedback_dataset
      }
      env {
        name  = "GCP_LOCATION"
        value = var.region
      }
      env {
        name  = "MAX_BQ_SCAN_GB"
        value = var.max_bq_scan_gb
      }
      # FRONTEND_URL is updated by CI after frontend is deployed (CORS whitelist)
      env {
        name  = "FRONTEND_URL"
        value = "https://${local.frontend_service}-*-${replace(var.region, "-", "")}.a.run.app"
      }

      # ── Secret env vars (Secret Manager references) ──────────────────────
      env {
        name = "OPENAI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.openai_api_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "AZURE_CLIENT_ID"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.azure_client_id.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "AZURE_TENANT_ID"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.azure_tenant_id.secret_id
            version = "latest"
          }
        }
      }

      # ANTHROPIC_API_KEY and MSSQL_CONNECTION_STRING are optional.
      # Add them manually via: gcloud run services update aida-backend \
      #   --update-secrets=ANTHROPIC_API_KEY=aida-anthropic-api-key:latest \
      #   --region=asia-south1
      # if you switch AI_PROVIDER to "claude" or enable Fabric.

      liveness_probe {
        http_get {
          path = "/api/health"
          port = 8080
        }
        initial_delay_seconds = 10
        period_seconds        = 30
        failure_threshold     = 3
      }

      startup_probe {
        http_get {
          path = "/api/health"
          port = 8080
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 10
      }
    }
  }

  depends_on = [
    google_artifact_registry_repository.images,
    google_secret_manager_secret_version.openai_api_key,
    google_secret_manager_secret_version.azure_client_id,
    google_secret_manager_secret_version.azure_tenant_id,
  ]

  lifecycle {
    # Allow CI to update the image tag without Terraform seeing it as drift
    ignore_changes = [
      template[0].containers[0].image,
      template[0].revision,
      client,
      client_version,
    ]
  }
}

# Allow public access to backend (auth is handled at the app level via Azure AD tokens)
resource "google_cloud_run_v2_service_iam_member" "backend_public" {
  project  = google_cloud_run_v2_service.backend.project
  location = google_cloud_run_v2_service.backend.location
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── Cloud Run: Frontend (Next.js) ─────────────────────────────────────────────

resource "google_cloud_run_v2_service" "frontend" {
  name     = local.frontend_service
  location = var.region

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      min_instance_count = var.frontend_min_instances
      max_instance_count = var.frontend_max_instances
    }

    containers {
      image = "${local.image_base}/${local.frontend_service}:latest"

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "PORT"
        value = "3000"
      }
      # Runtime API URL (Next.js reads this on server side; client uses build-time baked value)
      env {
        name  = "NEXT_PUBLIC_API_URL"
        value = "https://${local.backend_service}-${var.project_id}.${var.region}.run.app"
      }
    }
  }

  depends_on = [
    google_artifact_registry_repository.images,
    google_cloud_run_v2_service.backend,
  ]

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].revision,
      client,
      client_version,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  project  = google_cloud_run_v2_service.frontend.project
  location = google_cloud_run_v2_service.frontend.location
  name     = google_cloud_run_v2_service.frontend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
