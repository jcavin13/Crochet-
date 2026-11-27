"""Stitch parameters (`spec/stitch_params.json`) and simulator config (`spec/sim_config.json`)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from . import SPEC_DIR

PARAMS_PATH = SPEC_DIR / "stitch_params.json"
PARAMS_SCHEMA_PATH = SPEC_DIR / "stitch_params.schema.json"
SIM_CONFIG_PATH = SPEC_DIR / "sim_config.json"


def load_json(path: Path | str) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_params_file(path: Path | str | None = None) -> dict:
    return load_json(path or PARAMS_PATH)


def validate_params(doc: Mapping) -> None:
    """Raise jsonschema.ValidationError if `doc` is not a valid stitch_params.json."""
    import jsonschema

    jsonschema.validate(doc, load_json(PARAMS_SCHEMA_PATH))


@dataclass(frozen=True)
class StitchParams:
    """One parameter set: per stitch type width / height / stiffness (mm, mm, relative)."""

    id: str
    stitches: Mapping[str, Mapping[str, float]]
    raw: Mapping[str, Any]

    def width(self, t: str) -> float:
        return float(self.stitches[t]["width"])

    def height(self, t: str) -> float:
        return float(self.stitches[t]["height"])

    def stiffness(self, t: str) -> float:
        return float(self.stitches[t]["stiffness"])


def select_set(pattern: Mapping | None = None, doc: Mapping | None = None, set_id: str | None = None) -> StitchParams:
    """Pick the set named by `set_id`, else `pattern.meta.params`, else `default_set`."""
    doc = doc if doc is not None else load_params_file()
    if set_id is None and pattern is not None:
        set_id = pattern.get("meta", {}).get("params")
    if set_id is None:
        set_id = doc["default_set"]
    for s in doc["sets"]:
        if s["id"] == set_id:
            return StitchParams(id=s["id"], stitches=s["stitches"], raw=s)
    raise KeyError(f"stitch parameter set {set_id!r} not found (have: {[s['id'] for s in doc['sets']]})")


def load_sim_config(path: Path | str | None = None) -> dict:
    return load_json(path or SIM_CONFIG_PATH)
