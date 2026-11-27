# One-command entry points. See README.md.
.PHONY: lab lab-test lab-fixtures lab-check app-test dev test

# The lab's numerics are small: single-threaded BLAS/OpenMP is faster, does not oversubscribe a
# loaded machine and keeps reductions in a fixed order (docs/review.md R5). crolab sets the same
# defaults itself; these also cover tools that import numpy before crolab.
export OPENBLAS_NUM_THREADS ?= 1
export OMP_NUM_THREADS ?= 1
export MKL_NUM_THREADS ?= 1

lab:            ## set up the Python env, run tests, execute notebooks -> lab/reports/*.html
	cd lab && uv sync --locked && uv run pytest -q && uv run python -m crolab.reports

lab-test:
	cd lab && uv sync --locked && uv run pytest -q

lab-fixtures:   ## regenerate spec/fixtures/*.lab.json reference metrics from the lab sim
	cd lab && uv sync --locked && uv run python -m crolab.fixtures

lab-check:      ## committed lab outputs are current: lab.json, network.json, reports (byte-identical)
	cd lab && uv sync --locked && uv run python -m crolab.fixtures --check \
	  && uv run python -m crolab.export_network --check && uv run python -m crolab.reports --check

app-test:
	cd app && npm ci && npm run typecheck && npm test

dev:
	cd app && npm install && npm run dev

test: lab-test app-test
