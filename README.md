# PID Tuning Web App using Agents

This repository contains a simple educational web app for **PID gain tuning**, designed to compare:

- 🤖 **LLM-only reasoning**
- 🛠️ **LLM + deterministic tool (`compute_pid_gains`)**

This is mainly for teaching purposes.
---

## 1. Prerequisites

### Install Python (required)
- Install **Python 3.10 or newer**
- Download from:  
  👉 https://www.python.org/downloads/

⚠️ During installation on Windows, **make sure to check**:
> ✅ *“Add Python to PATH”*

---

### Install Git (if not already installed)
- Download from:  
  👉 https://git-scm.com/downloads

---

## 2. Clone the Repository

Open **PowerShell** (or Windows Terminal) and run:

```powershell
  git clone <REPO_URL_HERE>
  cd <REPO_FOLDER_NAME>
```
---

### Setting up PIP: (if not already)
- Download from: 
```powershell
  curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py
  python3 get-pip.py
``` 
---

## 3. Create and Activate a Virtual Environment

This keeps project dependencies isolated.

```powershell
py -m venv .venv
.\.venv\Scripts\activate
```

You should now see `(.venv)` at the beginning of your terminal prompt.

---

## 4. Install Python Dependencies

```powershell
pip install -r requirements.txt
```

This installs the project requirements.

---

## 5. Configure Environment Variables (OpenAI API Key)

### Create a `.env` file

### Edit `.env`
Open `.env` in a text editor and add your OpenAI API key:

```env
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
```

⚠️ **Important**
- Never commit your `.env` file
- Your API key stays local to your machine

---

## 6. Run the Application

You will run **two servers**: backend + frontend.

---

### Terminal 1 — Backend (FastAPI)

```powershell
uvicorn app_simple_web:app --host 127.0.0.1 --port 9500
```

This starts the API that:
- receives `dt` and `θ₀`
- calls the LLM
- optionally calls the deterministic PID tool

Leave this terminal running.

---

### Terminal 2 — Frontend (Static Web Server)

Open a **new terminal**, activate the virtual environment again if needed:

```powershell
.\.venv\Scripts\activate
python -m http.server 9800
```

---

### Open the App

In your browser, go to:

👉 **[http://localhost:9800](http://localhost:9800/index_simple_web.html)**

---

## 7. How to Use the App

### UI Controls
- `dt` — simulation time step
- `θ₀` — initial angle (initial condition)
- PID gain sliders (`Kp`, `Ki`, `Kd`)
- **Suggest gains**:
  - *LLM-only*
  - *With tool* (calls deterministic `compute_pid_gains`)

---

Happy experimenting 🚀
