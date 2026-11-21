"""Inbound adapter of this Lambda: GET /invites -> use case. `handle(event, deps)` is what the local
server and the tests call; `lambda_handler` is what AWS calls, plugged into DynamoDB."""
from houses_core.adapters.api_gateway import endpoint
from houses_core.adapters.aws import aws_dependencies

from .use_case import list_invites

handle = endpoint(lambda deps, r: list_invites(deps, r.owner, r.phone))


def lambda_handler(event, context):
    return handle(event, aws_dependencies())
