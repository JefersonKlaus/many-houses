"""Composition root in AWS: plugs the ports into DynamoDB and S3."""
from __future__ import annotations

import os
from typing import Optional

from ..ports import Dependencies
from .dynamo_repository import DynamoRepository
from .s3_photos import S3Photos

_dependencies: Optional[Dependencies] = None


def aws_dependencies() -> Dependencies:
    global _dependencies
    if _dependencies is None:       # created once per execution environment and reused
        import boto3                # already present in Lambda; imported here so tests don't require it
        from botocore.config import Config
        region = os.environ["AWS_REGION"]
        # the regional S3 address, the one the site's CSP allows (infra/frontend.tf)
        s3 = boto3.client("s3", region_name=region, endpoint_url=f"https://s3.{region}.amazonaws.com",
                          config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))
        _dependencies = Dependencies(DynamoRepository(boto3.client("dynamodb"), os.environ["TABLE_NAME"]),
                                     S3Photos(s3, os.environ["PHOTOS_BUCKET"]))
    return _dependencies
