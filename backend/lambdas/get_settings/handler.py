"""Inbound adapter of this Lambda: GET /settings -> use case. `handle(event, deps)` is what the local
server and the tests call; `lambda_handler` is what AWS calls, plugged into DynamoDB and S3."""
from houses_core.adapters.api_gateway import endpoint
from houses_core.adapters.aws import aws_dependencies

from .use_case import get_settings

handle = endpoint(lambda deps, r: get_settings(deps, r.owner, r.phone, r.name, r.email))


def lambda_handler(event, context):
    return handle(event, aws_dependencies())
