# Akagi-NG Codebase Analysis

## 1. Overview

Akagi-NG is an AI assistant for the online Mahjong game **Majsoul (雀魂)**. It uses **Playwright** to read game state
from the browser and feeds this data into **Mortal**, a strong Mahjong AI engine, to generate play recommendations.

## 2. Directory Structure

| Directory            | Purpose                                                                                                                                |
|:---------------------|:---------------------------------------------------------------------------------------------------------------------------------------|
| `akagi_ng/`          | Root package.                                                                                                                          |
| `__main__.py`        | **Entry Point**. Initializes the application, starts the browser, and runs the main event loop.                                        |
| `core/`              | **Utilities**. Contains global context (`context.py`), frontend data shaping (`frontend_adapter.py`), and helper functions.            |
| `dataserver/`        | **Frontend Communication**. A simple HTTP server that pushes AI decisions to a local UI via Server-Sent Events (SSE).                  |
| `playwright_client/` | **Browser Automation**. Uses Playwright to launch Chrome, navigate to Majsoul, and intercept WebSocket traffic to capture game events. |
| `mjai_bot/`          | **AI Logic**. Converts game events into MJAI format and queries the AI model.                                                          |
| `mjai_bot/mortal`    | **Mortal AI**. Contains the AI model weights (`mortal.pth`) and C-extensions (`libriichi.pyd`) for high-performance calculation.       |
| `mjai_bot/mortal3p`  | **3-Player Mortal AI**. Variant for 3-player Mahjong (Sanma) with its own weights and logic.                                           |
| `settings/`          | **Configuration**. Manages user settings.                                                                                              |

## 3. System Logic & Data Flow

The system operates in a continuous loop:

1. **Capture**: `PlaywrightController` (`playwright_client/majsoul.py`) injects listeners into the Majsoul game
   WebSocket. It decodes the binary protocol into JSON messages.
2. **Normalization**: These messages are converted into **MJAI** (Mahjong AI) format standard events.
3. **Decision**:
    - `Controller` (`mjai_bot/controller.py`) receives events.
    - It routes them to the active bot instance (e.g., `Mortal` or `Mortal3P`).
    - The `AkagiBot` class tracks game state (hands, dora, points).
    - The `Mortal` model (using `libriichi` C++ backend) calculates the best move (discard, call, etc.).
4. **Feedback**:
    - The AI's decision is formatted by `core.frontend_adapter`.
    - `DataServer` pushes this recommendation to the standalone frontend UI (running on `http://127.0.0.1:8765`).

## 4. Key Components Analysis

### `playwright_client/majsoul.py`

This is the "eyes" of the system. It:

- Launches a persistent Chrome context.
- Hooks into the `websocket` event.
- Uses `MajsoulBridge` to decode the specific Protobuf-like binary traffic of Majsoul into readable JSON.

### `mjai_bot/bot.py` (`AkagiBot`)

The base bot class. It is responsible for:

- Maintaining the "World State" of the table (who discarded what, score, whose turn it is).
- Handling discrepancies between Majsoul events and standard MJAI (e.g., patching 3-player "Kita" events).

### `mjai_bot/mortal/`

The "brain". It runs locally:

- `model.py`: Loads the PyTorch model.
- `libriichi.pyd`: Fast C++ implementation of Mahjong rules and state features, crucial for AI performance.
- `mortal.pth`: The trained neural network weights.

## 5. Execution Flow (`__main__.py`)

The main loop is simple and robust:

```python
while True:
    # 1. Get new game messages from browser
    msgs = client.dump_messages()

    # 2. Update AI Controller
    ai_response = controller.react(msgs)
    bot.react(msgs)  # Update state tracker

    # 3. Send AI result to UI
    payload = build_payload(ai_response, bot)
    server.update_data(payload)
```
