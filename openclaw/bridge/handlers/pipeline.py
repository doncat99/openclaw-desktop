"""Pipeline handler stubs for OntoSynth OpenClaw plugin."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Mapping


def _stub(method: str, params: Mapping[str, Any]) -> Dict[str, Any]:
    return {
        "status": "not_implemented",
        "method": method,
        "message": "Pipeline async handlers will be added in Phase 3.",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "params": dict(params),
    }


def ontosynth_pipeline_start(params: Mapping[str, Any]) -> Dict[str, Any]:
    return _stub("ontosynth.pipeline.start", params)


def ontosynth_pipeline_status(params: Mapping[str, Any]) -> Dict[str, Any]:
    return _stub("ontosynth.pipeline.status", params)


def ontosynth_pipeline_cancel(params: Mapping[str, Any]) -> Dict[str, Any]:
    return _stub("ontosynth.pipeline.cancel", params)


def ontosynth_pipeline_logs(params: Mapping[str, Any]) -> Dict[str, Any]:
    return _stub("ontosynth.pipeline.logs", params)


def ontosynth_pipeline_list(params: Mapping[str, Any]) -> Dict[str, Any]:
    return _stub("ontosynth.pipeline.list", params)
