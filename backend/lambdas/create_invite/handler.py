"""Inbound adapter of this Lambda: POST /houses/{id}/invites -> use case. `handle(event, deps)` is what the local
server and the tests call; `lambda_handler` is what AWS calls, plugged into DynamoDB."""
from houses_core.adapters.api_gateway import endpoint
from houses_core.adapters.aws import aws_dependencies

from .use_case import create_invite

handle = endpoint(lambda deps, r: create_invite(deps, r.owner, r.id, r.body, r.phone, r.name), status=201)


def lambda_handler(event, context):
    return handle(event, aws_dependencies())
