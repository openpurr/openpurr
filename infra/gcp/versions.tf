terraform {
  # Ephemeral resources and write-only attributes keep generated passwords out of the state.
  required_version = ">= 1.11"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 7.0, < 8.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.7, < 4.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
