"""Inbound adapter of this Lambda: POST /invites/{id}/accept -> use case. `handle(event, deps)` is what the local
server and the tests call; `lambda_handler` is what AWS calls, plugged into DynamoDB."""
from houses_core.adapters.api_gateway import endpoint
from houses_core.adapters.aws import aws_dependencies

from .use_case import accept_invite

handle = endpoint(lambda deps, r: accept_invite(deps, r.owner, r.id, r.phone, r.name))


def lambda_handler(event, context):
    return handle(event, aws_dependencies())
