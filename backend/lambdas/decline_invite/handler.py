"""Inbound adapter of this Lambda: POST /invites/{id}/decline -> use case. `handle(event, deps)` is what the local
server and the tests call; `lambda_handler` is what AWS calls, plugged into DynamoDB."""
from houses_core.adapters.api_gateway import endpoint
from houses_core.adapters.aws import aws_dependencies

from .use_case import decline_invite

handle = endpoint(lambda deps, r: decline_invite(deps, r.owner, r.id, r.phone), status=204)


def lambda_handler(event, context):
    return handle(event, aws_dependencies())
