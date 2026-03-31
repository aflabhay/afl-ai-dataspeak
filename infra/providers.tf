terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # Remote state in GCS — keeps state off local disk and enables team collaboration.
  # Create the bucket manually once: gsutil mb -l asia-south1 gs://<your-project-id>-tf-state
  # Remote GCS backend — run these once before terraform init:
  #
  #   # Activate the service account that owns the project
  #   gcloud auth activate-service-account --key-file=../afl-ai-aida-chatbot.json
  #   gcloud config set project arvind-brands-poc
  #
  #   # Create the state bucket (only needed once)
  #   gcloud storage buckets create gs://arvind-brands-poc-tf-state \
  #     --location=asia-south1 --project=arvind-brands-poc
  #
  #   # Then init as normal — ADC will use the activated service account
  #   terraform init
  backend "gcs" {
    bucket = "arvind-brands-poc-tf-state"
    prefix = "aida/terraform.tfstate"
  }
}

provider "google" {
  project     = var.project_id
  region      = var.region
  credentials = file(var.gcp_credentials_file)
}
