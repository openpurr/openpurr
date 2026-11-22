terraform {
  # mock_provider in tests/ needs OpenTofu 1.7 (or Terraform 1.7).
  required_version = ">= 1.7"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = ">= 2.60, < 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.7, < 4.0"
    }
  }
}

# The API token comes from DIGITALOCEAN_TOKEN (or DIGITALOCEAN_ACCESS_TOKEN), never from a file here.
provider "digitalocean" {}
