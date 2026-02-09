
from __future__ import annotations

from typing import Tuple, Dict, Any
from pydantic import BaseModel


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


class UFOState(BaseModel):
    """
    State for the UFO attitude system.

    theta: angle (radians)
    omega: angular rate (rad/s)
    integ: integral term memory for PID (integral of error)
    e_prev: previous error for derivative term
    paused: if True, plant does not advance
    """
    theta: float = 3.0   # radians (initial disturbance)
    omega: float = 0.0   # rad/s
    integ: float = 0.0
    e_prev: float = 0.0
    paused: bool = True


# Continuous-time dynamics (from your MATLAB example)
# x = [theta, omega]^T
# xdot = A x + B u
A11, A12 = 0.0, 1.0
A21, A22 = 0.01, 0.0
B1, B2 = 0.0, 1.0


def pid_control(e: float, e_prev: float, integ: float, dt: float, kp: float, ki: float, kd: float) -> Tuple[float, float]:
    integ = integ + e * dt
    deriv = (e - e_prev) / max(dt, 1e-6)
    u = kp * e + ki * integ + kd * deriv
    return u, integ


def step_ufo(
    dt: float,
    state: UFOState,
    kp: float,
    ki: float,
    kd: float,
    theta_ref: float = 0.0,
    u_limit: float = 3.0,
) -> Tuple[UFOState, float, float]:
    """
    One discrete simulation step (Euler integration).

    Returns:
      next_state, error, u
    """
    dt = max(float(dt), 1e-4)

    # Error: want theta -> theta_ref
    e = theta_ref - state.theta

    # PID controller
    u, integ = pid_control(e, state.e_prev, state.integ, dt, kp, ki, kd)
    u = clamp(u, -u_limit, u_limit)

    # Plant
    theta, omega = state.theta, state.omega
    if not state.paused:
        theta_dot = A11 * theta + A12 * omega + B1 * u
        omega_dot = A21 * theta + A22 * omega + B2 * u
        theta = theta + dt * theta_dot
        omega = omega + dt * omega_dot

    next_state = UFOState(
        theta=theta,
        omega=omega,
        integ=integ,
        e_prev=e,
        paused=state.paused,
    )
    return next_state, e, u


def rollout_metrics(
    dt: float,
    kp: float,
    ki: float,
    kd: float,
    seconds: float = 6.0,
    theta0: float = 3.0,
    omega0: float = 0.0,
    u_limit: float = 3.0,
) -> Dict[str, Any]:
    """
    Deterministic rollout used by 'evaluate_gains' tool.
    Returns simple metrics that are easy to explain.
    """
    steps = int(max(2, seconds / max(dt, 1e-4)))
    s = UFOState(theta=theta0, omega=omega0, paused=False)
    iae = 0.0
    max_abs_e = 0.0
    max_abs_u = 0.0
    fuel = 0.0  # simple proxy: sum(|u|)*dt

    for _ in range(steps):
        s, e, u = step_ufo(dt=dt, state=s, kp=kp, ki=ki, kd=kd, theta_ref=0.0, u_limit=u_limit)
        iae += abs(e) * dt
        max_abs_e = max(max_abs_e, abs(e))
        max_abs_u = max(max_abs_u, abs(u))
        fuel += abs(u) * dt

    return {
        "iae": iae,
        "max_abs_error": max_abs_e,
        "max_abs_u": max_abs_u,
        "fuel": fuel,
        "seconds": seconds,
        "dt": dt,
    }
