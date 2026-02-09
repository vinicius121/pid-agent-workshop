"""\
app_simple_web.py — FastAPI backend for the UFO PID workshop

Endpoints:
- POST /control : deterministic plant+PID step (called frequently by frontend)
- POST /tune    : 1-shot agent suggestion (1 model call)

Important workshop rule:
- The animation loop NEVER calls the LLM.
"""

from __future__ import annotations

from typing import Any, Dict, Literal

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ufo_sim import UFOState, step_ufo
from agent_tuner import tune_gains

load_dotenv()

app = FastAPI(title="UFO PID Workshop Backend")

# Allow simple local dev (frontend served on another port)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------
# Deterministic control endpoint
# -----------------------------
class ControlRequest(BaseModel):
    dt: float
    theta_ref: float = 0.0  # radians

    kp: float
    ki: float
    kd: float

    state: UFOState


@app.post("/control")
def control(req: ControlRequest) -> Dict[str, Any]:
    """\
    Deterministic control + plant step. NO LLM CALLS.
    Called frequently by the frontend animation loop.
    """
    next_state, e, u = step_ufo(
        dt=req.dt,
        state=req.state,
        kp=req.kp,
        ki=req.ki,
        kd=req.kd,
        theta_ref=req.theta_ref,
    )
    return {"state": next_state.model_dump(), "error": e, "u": u}


# -----------------------------
# Agent endpoint (one call)
# -----------------------------
class TuneRequest(BaseModel):
    dt: float
    theta0: float


@app.post("/tune")
def tune(req: TuneRequest, style: Literal["no_tools", "agent_tool"] = "agent_tool") -> Dict[str, Any]:
    """\
    One OpenAI call per click.
    style=no_tools   : LLM must propose gains.
    style=agent_tool : model may call compute_pid_gains(theta0, dt).
    """
    return tune_gains(dt=req.dt, theta0=req.theta0, style=style)
