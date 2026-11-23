"""Inbound adapter of this Lambda: PUT /houses/{id}/timeline/{entry_id} -> use case. `handle(event, deps)` is what the local
server and the tests call; `lambda_handler` is what AWS calls, plugged into DynamoDB and S3."""
from houses_core.adapters.api_gateway import endpoint
from houses_core.adapters.aws import aws_dependencies

from .use_case import update_timeline_entry

handle = endpoint(lambda deps, r: update_timeline_entry(deps, r.owner, r.id, r.path["entry_id"], r.body))


def lambda_handler(event, context):
    return handle(event, aws_dependencies())
