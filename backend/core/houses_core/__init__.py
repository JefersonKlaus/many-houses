"""The core shared by every Lambda (hexagonal architecture). It is packaged into each Lambda's zip.

    domain/         entities and rules: pure Python, no I/O (the centre of the hexagon)
    ports.py        what the use cases need from outside: the Repository
    application.py  rules that more than one use case applies (they only go through the ports)
    adapters/       DynamoDB and the API Gateway input

Each Lambda in backend/lambdas/<action>/ adds its own use case (use_case.py) and its inbound
adapter (handler.py). Nothing in domain/, ports.py or application.py imports AWS."""
