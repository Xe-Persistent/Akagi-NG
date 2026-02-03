"""AkagiApp Integration Tests"""

from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.application import AkagiApp
from akagi_ng.core import get_app_context


@pytest.fixture
def mock_components():
    import akagi_ng.application  # Ensure module is loaded

    with (
        patch("akagi_ng.application.DataServer") as MockDS,
        patch("akagi_ng.application.MitmClient") as MockMitm,
        patch("akagi_ng.electron_client.create_electron_client") as mock_create_client,
        patch("akagi_ng.mjai_bot.StateTrackerBot") as MockBot,
        patch("akagi_ng.mjai_bot.Controller") as MockController,
        patch("akagi_ng.application.configure_logging"),
        patch("importlib.import_module"),  # mock lib_loader
        patch.object(akagi_ng.application, "loaded_settings") as mock_settings,
    ):
        mock_ds_instance = MockDS.return_value
        mock_mitm_instance = MockMitm.return_value
        mock_client_instance = MagicMock()
        mock_create_client.return_value = mock_client_instance

        mock_bot_instance = MockBot.return_value
        mock_controller_instance = MockController.return_value

        # Configure settings
        mock_settings.server.host = "127.0.0.1"
        mock_settings.server.port = 2026
        mock_settings.log_level = "INFO"
        mock_settings.platform = "windows"
        mock_settings.mitm.enabled = True

        yield {
            "ds_cls": MockDS,
            "ds": mock_ds_instance,
            "mitm": mock_mitm_instance,
            "electron": mock_client_instance,
            "bot": mock_bot_instance,
            "controller": mock_controller_instance,
            "settings": mock_settings,
        }


def test_app_initialization(mock_components):
    app = AkagiApp()
    app.initialize()

    assert app.ds == mock_components["ds"]
    assert app.frontend_url == "http://127.0.0.1:2026/"

    # Check AppContext
    context = get_app_context()
    assert context.bot == mock_components["bot"]
    assert context.controller == mock_components["controller"]
    assert context.mitm_client == mock_components["mitm"]
    assert context.electron_client == mock_components["electron"]


def test_app_start(mock_components):
    app = AkagiApp()
    app.initialize()

    # Verify app.ds is indeed the mock
    assert app.ds is mock_components["ds"]

    with patch.object(app, "_setup_signals"):
        app.start()

    mock_components["ds"].start.assert_called_once()
    mock_components["mitm"].start.assert_called_once()
    mock_components["electron"].start.assert_called_once()


def test_app_main_loop_process_message(mock_components):
    """Test one iteration of main loop processing a message"""
    app = AkagiApp()
    app.initialize()

    # Inject a message
    msg = {"type": "tsumo", "actor": 0}
    app.message_queue.put(msg)

    # Mock _emit_outputs to signal stop after processing
    # AND mock _process_events to ensure it runs

    original_emit = app._emit_outputs

    def side_effect_emit(result, bot):
        original_emit(result, bot)
        app.stop()  # Force stop loop

    with patch.object(app, "_emit_outputs", side_effect=side_effect_emit) as mock_emit:
        # Run in main thread, expecting it to process one msg and stop
        app.run()

        mock_emit.assert_called_once()

        # Verify bot/controller reaction
        # Since we mock them in fixture, check calls
        mock_components["bot"].react.assert_called_with(msg)
        mock_components["controller"].react.assert_called_with(msg)


def test_app_handle_shutdown_signal(mock_components):
    app = AkagiApp()
    app.initialize()

    msg = {"type": "system_shutdown"}
    app.message_queue.put(msg)

    # Run loop
    app.run()

    # Should stop
    assert app._stop_event.is_set()


def test_app_cleanup(mock_components):
    app = AkagiApp()
    app.initialize()

    app.cleanup()

    mock_components["ds"].stop.assert_called_once()
    mock_components["mitm"].stop.assert_called_once()
    mock_components["electron"].stop.assert_called_once()
