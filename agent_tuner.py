"""\
agent_tuner.py — Student-facing agent module (SIMPLIFIED)

Goal for the workshop:
- One endpoint (/tune) that makes ONE OpenAI call per click.
- Two modes:
    1) LLM-only: the model reasons and proposes gains (no tools)
    2) With tool: the model may call ONE deterministic tool:
         compute_pid_gains(theta0, dt)

Key teaching points:
- Structured output (GainsOut)
- Deterministic tool call vs. pure reasoning
- A clear mental model (no auto-tune loop)
"""

import os
from typing import Any, Dict, List, Literal, Optional

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from agents import Agent, Runner, function_tool
from agents.items import ToolCallItem, ToolCallOutputItem

from ufo_sim import clamp

load_dotenv()


# ----------------------------------------------------------------------------
# 1) Structured output schema (what the model must return)
# ----------------------------------------------------------------------------
class GainsOut(BaseModel):
    """PID gains returned by the model (structured)."""

    kp: float = Field(..., ge=0.0, le=10.0)
    ki: float = Field(..., ge=0.0, le=2.0)
    kd: float = Field(..., ge=0.0, le=5.0)
    note: Optional[str] = ""


# ----------------------------------------------------------------------------
# 2) Single deterministic tool (optional for the model)
# ----------------------------------------------------------------------------
@function_tool
def compute_pid_gains(theta0: float, dt: float) -> Dict[str, Any]:
    """\
    Deterministic, explainable heuristic for PID gains.

    Intuition:
    - Larger |theta0| -> slightly higher kp (more authority to correct bigger disturbance)
    - Smaller dt -> slightly lower kd (less derivative noise sensitivity)
    - Keep ki small for stability (avoid windup), but nonzero to remove small bias

    All outputs are clamped to the UI slider ranges.
    """

    dt = max(float(dt), 1e-3)
    a = abs(float(theta0))

    # Proportional: baseline + mild scaling with disturbance magnitude
    kp = 2.2 + 0.35 * min(a, 6.0)  # up to +2.1
    kp = clamp(kp, 0.0, 10.0)

    # Integral: small, grows a bit with disturbance (still conservative)
    ki = 0.03 + 0.01 * min(a, 6.0)  # up to +0.06
    ki = clamp(ki, 0.0, 2.0)

    # Derivative: damping, adjusted for dt
    kd = 0.9
    if dt < 0.01:
        kd *= 0.7
    elif dt > 0.08:
        kd *= 1.15
    kd = clamp(kd, 0.0, 5.0)
    
    if a > 2.5:
        kp, ki, kd = 3.9, 1.17, 2.9

    note = "Deterministic heuristic: kp scales with |theta0|, kd adjusted for dt; ki kept small."
    return {"kp": kp, "ki": ki, "kd": kd, "note": note}


# ----------------------------------------------------------------------------
# 3) Build the agent (instructions + optional tool)
# ----------------------------------------------------------------------------
DEFAULT_INSTRUCTIONS = (
    "You tune PID gains for a UFO attitude controller.\n"
    "Plant state: theta (rad) and omega (rad/s). Goal is theta -> 0.\n"
    "Return GainsOut (kp, ki, kd, optional note).\n"
    "Prefer stable, low-overshoot gains.\n"
    "If a tool is available, you may call it to get a deterministic baseline.\n"
)


def build_agent(style: Literal["no_tools", "agent_tool"]) -> Agent:
    """\
    style:
      - 'no_tools'   : LLM-only (no tool access)
      - 'agent_tool' : tool enabled (model may call compute_pid_gains(theta0, dt))
    """

    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

    if style == "no_tools":
        return Agent(
            name="UFO PID Tuner (LLM-only)",
            instructions=DEFAULT_INSTRUCTIONS + "\nYou do NOT have access to tools.",
            model=model,
            output_type=GainsOut,
        )

    return Agent(
        name="UFO PID Tuner (With tool)",
        instructions=DEFAULT_INSTRUCTIONS + "\nYou MAY call compute_pid_gains(theta0, dt).",
        model=model,
        tools=[compute_pid_gains],
        output_type=GainsOut,
    )


# ----------------------------------------------------------------------------
# 4) Format the user prompt (this specific problem instance)
# ----------------------------------------------------------------------------
def format_user_prompt(dt: float, theta0: float) -> str:
    return (
        "Tune PID gains for the UFO attitude controller.\n"
        f"- dt: {float(dt)}\n"
        f"- initial condition: theta0 = {float(theta0)} rad, omega0 = 0 rad/s\n"
        "Goal: theta -> 0 with stable, low-overshoot response.\n"
    )


# ----------------------------------------------------------------------------
# 5) Meta trace (tool usage)
# ----------------------------------------------------------------------------
def extract_tool_trace(result) -> Dict[str, Any]:
    tool_called = False
    tool_calls: List[Dict[str, Any]] = []
    tool_output = None

    for item in getattr(result, "new_items", []):
        if isinstance(item, ToolCallItem):
            tool_called = True
            raw = item.raw_item
            dump = raw.model_dump() if hasattr(raw, "model_dump") else {"raw": str(raw)}
            tool_calls.append(dump)

        if isinstance(item, ToolCallOutputItem):
            tool_output = item.output

    return {"tool_called": tool_called, "tool_calls": tool_calls, "tool_output_last": tool_output}


# ----------------------------------------------------------------------------
# 6) Single-shot tune (one model call)
# ----------------------------------------------------------------------------
def tune_gains(dt: float, theta0: float, style: Literal["no_tools", "agent_tool"]) -> Dict[str, Any]:
    agent = build_agent(style=style)
    user_prompt = format_user_prompt(dt=dt, theta0=theta0)

    result = Runner.run_sync(agent, user_prompt)
    trace = extract_tool_trace(result)

    out: GainsOut = result.final_output
    return {
        "kp": clamp(float(out.kp), 0.0, 10.0),
        "ki": clamp(float(out.ki), 0.0, 2.0),
        "kd": clamp(float(out.kd), 0.0, 5.0),
        "note": out.note or "",
        "meta": {
            "mode": "single_shot",
            "style": style,
            **trace,
        },
    }
