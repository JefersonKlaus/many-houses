"""Inbound adapter of this Lambda: DELETE /houses/{id}/installments/{installment_id} -> use case. `handle(event, deps)` is what the local
server and the tests call; `lambda_handler` is what AWS calls, plugged into DynamoDB."""
from houses_core.adapters.api_gateway import endpoint
from houses_core.adapters.aws import aws_dependencies

from .use_case import delete_installment

handle = endpoint(lambda deps, r: delete_installment(deps, r.owner, r.id, r.path["installment_id"]))


def lambda_handler(event, context):
    return handle(event, aws_dependencies())
