terraform {
  # Ephemeral resources and write-only attributes keep the generated OPERATOR_SECRET out of the state.
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0, < 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.7, < 4.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = merge({ openpurr = var.name }, var.tags)
  }
}
