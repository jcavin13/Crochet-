# One-command entry points. See README.md.
.PHONY: lab lab-test lab-fixtures app app-test dev test

lab:            ## set up the Python env, run tests, execute notebooks -> lab/reports/*.html
	cd lab && uv sync && uv run pytest -q && uv run python -m crolab.reports

lab-test:
	cd lab && uv sync && uv run pytest -q

lab-fixtures:   ## regenerate spec/fixtures/*.lab.json reference metrics from the lab sim
	cd lab && uv sync && uv run python -m crolab.fixtures

app-test:
	cd app && npm ci && npm run typecheck && npm test

dev:
	cd app && npm install && npm run dev

test: lab-test app-test
