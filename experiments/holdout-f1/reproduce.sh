#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"
PYTHON=${CZ_PYTHON:-$HOME/.venvs/cz/bin/python}
exec "$PYTHON" -m experiments.holdout_f1_runner
