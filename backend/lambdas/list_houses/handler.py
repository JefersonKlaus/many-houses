"""Inbound adapter of this Lambda: GET /houses -> use case. `handle(event, deps)` is what the local
server and the tests call; `lambda_handler` is what AWS calls, plugged into DynamoDB."""
from houses_core.adapters.api_gateway import endpoint
from houses_core.adapters.aws import aws_dependencies

from .use_case import list_houses

handle = endpoint(lambda deps, r: list_houses(deps, r.owner))


def lambda_handler(event, context):
    return handle(event, aws_dependencies())
