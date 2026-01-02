# Akagi-NG Project Instructions for AI Agents

## Project Overview

Akagi-NG is a next-generation Mahjong AI assistant for Mahjong Soul (雀魂). It uses a Python backend for core logic and
AI processing, and a Vue/Vite frontend for the user interface.

## Architecture

The system is composed of the following main components:

1. **Backend (`akagi_ng`)**: Python-based core.
    * **Playwright Client**: Interacts with the Mahjong Soul web game to capture game events.
    * **MJAI Bot**: Processes game events using MJAI-compatible bots (e.g., Mortal).
    * **Data Server**: A lightweight HTTP/SSE server that broadcasts analysis results to the frontend.
    * **Core**: Manages the application lifecycle and configuration.
2. **Frontend (`akagi_frontend`)**: A web-based UI that displays recommendations and game status, receiving real-time
   updates from the Data Server.

## Directory Structure

### Root

* `akagi_ng/`: Python backend source code.
* `akagi_frontend/`: Frontend Vue application.
* `config/`: Configuration files (e.g., `settings.json`, `ot_settings.json`).
* `logs/`: Runtime logs.
* `playwright_data/`: Browser profile data for Playwright.

### Backend (`akagi_ng/`)

* `__main__.py`: Application entry point. Orchestrates the startup of DataServer, Playwright Client, and Bot Controller.
* `core/`: Core utilities.
    * `context.py`: Global context management (stores references to active components).
    * `logging.py`: Logging configuration.
* `mjai_bot/`: AI logic.
    * `controller.py`: Manages bot instances and routes events (`Controller` class).
    * `bot.py`: Base `AkagiBot` class adapting `mjai.Bot`. Implements generic logic for reacting to events.
    * `mortal/`: Implementation for the Mortal bot (4-player).
    * `mortal3p/`: Implementation for the Mortal bot (3-player).
* `playwright_client/`: Browser interaction.
    * `client.py`: Thread management for the Playwright controller (`Client` class).
    * `majsoul.py`: Playwright script to inject JS bridge and capture traffic.
* `dataserver/`: Communication with frontend.
* `settings/`: Configuration loading logic.

### Frontend (`akagi_frontend/`)

* Standard Vite + Vue + TypeScript project structure.
* `src/`: Source code.

## Data Flow

1. **Event Capture**: `playwright_client` captures MJAI-format events from the game via intercepted network traffic or
   JS bridge.
2. **Bot Processing**: Events are passed to `mjai_bot.Controller`.
    * The Controller determines which bot to use (e.g., Mortal vs Mortal3p).
    * The Bot (`AkagiBot`) acknowledges the event and may produce a decision (discard, call, etc.).
3. **UI Update**: The Bot's decision and analysis are wrapped into a payload and sent to the `DataServer`.
4. **Display**: `DataServer` pushes the payload to `akagi_frontend` via SSE (Server-Sent Events), updating the UI.

## Development Guidelines

### Python Backend

* **Python Version**: >= 3.12
* **Type Hinting**: Fully typed code is expected.
* **Style**: Follow PEP 8.
* **imports**: Use absolute imports within the package (e.g., `from akagi_ng.core import ...`) or relative imports where
  appropriate inside submodules.
* **Configuration**: Do NOT hardcode settings. Use `settings.settings` to access configuration values loaded from
  `config/settings.json`.
* **Logging**: Use `loguru` via `core.logging`.

### Modifying Frontend

* Run `npm run dev` in `akagi_frontend` for hot-reload development.
* Ensure the backend is running to receive real data, or use mock data if implemented.

## Key Files for Agents to Know

* `akagi_ng/__main__.py`: Read this to understand the startup sequence.
* `akagi_ng/mjai_bot/bot.py`: Core AI logic. Modify this to change how the bot reacts to general events.
* `akagi_ng/playwright_client/majsoul.py`: Modify this if game updates break the event capture.
* `config/settings.json`: User-configurable settings.

## Common Tasks Reference

* **Fixing Game Update Issues**: Check `playwright_client/majsoul.py` selectors and network interception logic.
* **Adjusting AI Behavior**: Check `mjai_bot/bot.py` or the specific bot implementation in `mjai_bot/<bot_name>/`.
* **UI Changes**: Work in `akagi_frontend/src/`.
