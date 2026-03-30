variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "asia-south1" # Mumbai — closest to Bengaluru
}

variable "app_name" {
  description = "Short name used in all resource names"
  type        = string
  default     = "aida"
}

# ── Secret values (passed via -var or terraform.tfvars — never committed) ─────

variable "openai_api_key" {
  description = "OpenAI API key"
  type        = string
  sensitive   = true
}

variable "anthropic_api_key" {
  description = "Anthropic Claude API key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "azure_client_id" {
  description = "Azure AD Application (client) ID"
  type        = string
  sensitive   = true
}

variable "azure_tenant_id" {
  description = "Azure AD Directory (tenant) ID"
  type        = string
  sensitive   = true
}

variable "mssql_connection_string" {
  description = "Microsoft Fabric / SQL Server connection string (optional)"
  type        = string
  sensitive   = true
  default     = ""
}

# ── App configuration ─────────────────────────────────────────────────────────

variable "ai_provider" {
  description = "AI provider: 'openai' or 'claude'"
  type        = string
  default     = "openai"
}

variable "openai_model" {
  description = "OpenAI model name"
  type        = string
  default     = "gpt-4o-mini"
}

variable "gcp_feedback_dataset" {
  description = "BigQuery dataset for AIDA history, feedback and metadata tables"
  type        = string
  default     = "AFL_AI"
}

variable "max_bq_scan_gb" {
  description = "Max BigQuery scan size in GB before a query is blocked"
  type        = string
  default     = "5"
}

variable "backend_min_instances" {
  description = "Minimum Cloud Run instances for backend (0 = scale to zero)"
  type        = number
  default     = 0
}

variable "backend_max_instances" {
  description = "Maximum Cloud Run instances for backend"
  type        = number
  default     = 10
}

variable "frontend_min_instances" {
  description = "Minimum Cloud Run instances for frontend"
  type        = number
  default     = 0
}

variable "frontend_max_instances" {
  description = "Maximum Cloud Run instances for frontend"
  type        = number
  default     = 5
}
