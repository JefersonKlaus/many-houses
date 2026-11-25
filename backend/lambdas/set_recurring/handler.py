"""Inbound adapter of this Lambda: PUT /houses/{id}/recurring -> use case. `handle(event, deps)` is what the local
server and the tests call; `lambda_handler` is what AWS calls, plugged into DynamoDB."""
from houses_core.adapters.api_gateway import endpoint
from houses_core.adapters.aws import aws_dependencies

from .use_case import set_recurring

handle = endpoint(lambda deps, r: set_recurring(deps, r.owner, r.id, r.body))


def lambda_handler(event, context):
    return handle(event, aws_dependencies())
