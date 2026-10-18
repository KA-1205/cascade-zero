"""Optional, default-deny sandbox webhook execution.

The in-memory ledger is scoped to one executor/process. Persist its entries in an
external store before using this adapter across restarts or multiple workers.
"""

from .executor import (
    ALLOWED_ACTIONS,
    ExecutionRecord,
    GatedExecutor,
    IdempotencyLedger,
    executor_from_env,
)

__all__ = [
    "ALLOWED_ACTIONS",
    "ExecutionRecord",
    "GatedExecutor",
    "IdempotencyLedger",
    "executor_from_env",
]
