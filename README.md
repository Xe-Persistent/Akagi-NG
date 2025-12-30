<div align="center">
  <img src="https://gcore.jsdelivr.net/gh/Xe-Persistent/CDN-source/image/assets/akagi.png" width="50%">
  <h1>Akagi-NG</h1>

  <p>
    Next Generation Mahjong AI Assistant<br>
    Inspired by <b>Akagi</b> and <b>MajsoulHelper</b>
  </p>
<p><i>「死ねば助かるのに……」— 赤木しげる</i></p>

<p>
  <img src="https://img.shields.io/badge/python-3.12+-blue?logo=python">
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey">
  <img src="https://img.shields.io/badge/status-active%20development-orange">
</p>
</div>

---

## What is Akagi-NG?

**Akagi-NG** stands for **Next Generation**.It is a next-generation rewrite of the original **Akagi** project.

It is an AI-powered assistant for Japanese Mahjong (Riichi Mahjong), designed to provide **real-time analysis and
decision recommendations** while playing games such as **Mahjong Soul (雀魂)**.

Akagi-NG focuses on:

- A **modernized architecture**
- Cleaner separation between core logic, UI, configuration, and models
- Easier extensibility for future UIs (H5 / overlay / background service)
- Long-term maintainability

This project inherits ideas and legacy code from **Akagi** and **MajsoulHelper**, but it is not a drop-in replacement
and should be treated as a new generation.

---

## ⚠️ Disclaimer

This project is provided **for educational and research purposes only**.

Using third-party tools with online games may violate the game’s Terms of Service.  
The author of Akagi-NG is **not responsible for any consequences**, including but not limited to **account suspension or
bans**.

You are responsible for understanding the risks.

---

## Current Scope

- 🎮 **Supported game**
    - Mahjong Soul (雀魂)

- 🀄 **Game modes**
    - Four-player Mahjong
    - Three-player Mahjong

- 🤖 **AI models**
    - MJAI-compatible local models
    - (Optional) online / external models

- 🧠 **Core features**
    - Real-time hand analysis
    - Shanten / efficiency-based recommendations
    - Clear separation between engine and UI

> [!NOTE]
> Akagi-NG is still under active development.  
> Some features from the original Akagi project are intentionally not re-implemented yet.

---

### TODO List

- [x] Rewrite Akagi core logic
- [x] Add modern h5 UI support
- [ ] Refactor legacy mjai_bot code
- [ ] Refine playwright integration
- [ ] Compatible with online models
- [ ] Feature: Show which tile to discard when riichi, e.g.`12233445566778m`
- [ ] Feature: Show which tile to kan in mixed kan scenarios, e.g.`(444m)456777m45p44z` or `444456777m45p44z`

---

## Setup

Akagi-NG uses a modern Python packaging setup based on **pyproject.toml**.

This project is currently intended for **developers and advanced users**.

---

### Requirements

- Python **3.12 or newer**
- Windows (primary development target)
- A MJAI-compatible local or online model
- Git

---

### Clone the repository

```bash
git clone https://github.com/Xe-Persistent/Akagi-NG.git
cd Akagi-NG
```

---

### Create a virtual environment

Using venv (recommended):

```bash
python -m venv .venv
.venv\Scripts\activate
```

---

### Install backend dependencies

Install Akagi-NG in editable (development) mode:

```bash
pip install -e .
```

This will:

* Install all runtime dependencies defined in pyproject.toml
* Register the akagi-ng command
* Allow local code changes without reinstallation

---

### Install frontend dependencies

Before running the application, install the frontend dependencies.

The frontend is located in the `akagi_frontend/` directory and is managed independently from the Python backend.

```bash
cd frontend
npm install
```

If you prefer another package manager (e.g., pnpm or yarn), use the corresponding install command.

---

### Install Playwright browsers

Akagi-NG relies on Playwright for interacting with Mahjong Soul.

After installing dependencies, run:

```bash
python -m playwright install
```

---

## Running Akagi-NG

Akagi-NG can be started in two equivalent ways.

### Option 1: Run as a module

```bash
python -m akagi_ng
```

### Option 2: Use the installed command

```bash
akagi-ng
```

Both methods invoke the same entry point:

```
akagi_ng.__main__:main
```

---
During startup, Akagi-NG initializes:

* Project root detection
* Runtime configuration loading and validation
* Logging system
* AI model discovery and loading

Runtime logs are written to:

```
./logs/
```

---

## Configuration

Runtime configuration is stored outside the Python package:

```
config/settings.json
```

A schema file is included in the codebase to validate configuration structure.

Example:

```
config/settings.example.json
```

Copy it to settings.json and modify as needed.

---

## Legacy Code Notice

Akagi-NG contains **isolated legacy** code originating from the original Akagi project.

* It is intentionally kept untouched
* New features must not depend directly on legacy internals
* All access goes through explicit adapters

This allows gradual migration without destabilizing the system.

---

## License

This software is licensed under the [GNU Affero General Public License version 3 (AGPLv3)](LICENSE)
