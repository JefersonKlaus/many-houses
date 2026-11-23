"""Inbound adapter of this Lambda: DELETE /houses/{id}/expenses/{expense_id} -> use case. `handle(event, deps)` is what the local
server and the tests call; `lambda_handler` is what AWS calls, plugged into DynamoDB."""
from houses_core.adapters.api_gateway import endpoint
from houses_core.adapters.aws import aws_dependencies

from .use_case import delete_expense

handle = endpoint(lambda deps, r: delete_expense(deps, r.owner, r.id, r.path["expense_id"]))


def lambda_handler(event, context):
    return handle(event, aws_dependencies())
