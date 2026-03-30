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
  backend "gcs" {
    bucket = "arvind-brands-poc-tf-state"
    prefix = "aida/terraform.tfstate"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
