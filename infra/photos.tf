# The photos (a cost's NF and material, the house's timeline): a private bucket. The browser posts each
# photo straight to it with a form the API signs (only a JPEG, only up to a size, only at its house's
# key) and sees it through links that expire (backend/core/houses_core/adapters/s3_photos.py).
# The name has "-site-" so the deploy policy (docs/iam-deploy-policy.json) already covers it.
resource "aws_s3_bucket" "photos" {
  bucket = "${local.prefix}-site-photos-${local.account}"
}

resource "aws_s3_bucket_public_access_block" "photos" {
  bucket                  = aws_s3_bucket.photos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Only the site may send photos from the browser.
resource "aws_s3_bucket_cors_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id

  cors_rule {
    allowed_methods = ["POST", "GET"]
    allowed_origins = ["https://${aws_cloudfront_distribution.site.domain_name}"]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

locals {
  # The regional address the API signs the forms and links for; the site's CSP allows exactly it.
  photos_origin = "https://${aws_s3_bucket.photos.bucket}.s3.${var.region}.amazonaws.com"
}
