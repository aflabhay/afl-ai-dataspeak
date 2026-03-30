output "backend_url" {
  description = "Cloud Run backend service URL"
  value       = google_cloud_run_v2_service.backend.uri
}

output "frontend_url" {
  description = "Cloud Run frontend service URL (share this with users)"
  value       = google_cloud_run_v2_service.frontend.uri
}

output "artifact_registry" {
  description = "Artifact Registry repository path (use in docker push)"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${local.registry_id}"
}

output "github_actions_sa_email" {
  description = "Service account email to use in GitHub Actions (create a key and add to GH Secrets as GCP_SA_KEY)"
  value       = google_service_account.github_actions.email
}

output "cloud_run_sa_email" {
  description = "Service account attached to Cloud Run services"
  value       = google_service_account.cloud_run.email
}

output "next_steps" {
  description = "What to do after terraform apply"
  value = <<-EOT

    ✅ Infrastructure provisioned. Next steps:

    1. Create a GitHub Actions service account key:
         gcloud iam service-accounts keys create /tmp/gh-sa-key.json \
           --iam-account=${google_service_account.github_actions.email}
       Then add the JSON as a GitHub Secret named GCP_SA_KEY.

    2. Add these GitHub Secrets in your repo settings:
         GCP_PROJECT_ID  = ${var.project_id}
         GCP_SA_KEY      = (contents of /tmp/gh-sa-key.json)

    3. Register the frontend URL as a redirect URI in Azure AD:
         App Registration → Authentication → Single-page application
         Add: ${google_cloud_run_v2_service.frontend.uri}

    4. Push to main branch — GitHub Actions will build & deploy both services.

    Frontend: ${google_cloud_run_v2_service.frontend.uri}
    Backend:  ${google_cloud_run_v2_service.backend.uri}
  EOT
}
