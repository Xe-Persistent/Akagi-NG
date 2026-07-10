from unittest.mock import patch

from akagi_ng.core import logging as logging_module


def test_off_level_removes_sinks_without_creating_a_file() -> None:
    with (
        patch.object(logging_module.logger, "remove") as remove,
        patch.object(logging_module.logger, "add") as add,
        patch.object(logging_module, "ensure_dir") as ensure_dir,
    ):
        logging_module.configure_logging("OFF")

    remove.assert_called_once_with()
    add.assert_not_called()
    ensure_dir.assert_not_called()


def test_no_logs_environment_overrides_selected_level() -> None:
    with (
        patch.dict("os.environ", {"AKAGI_NO_LOGS": "1"}),
        patch.object(logging_module.logger, "remove"),
        patch.object(logging_module.logger, "add") as add,
        patch.object(logging_module, "ensure_dir") as ensure_dir,
    ):
        logging_module.configure_logging("DEBUG")

    add.assert_not_called()
    ensure_dir.assert_not_called()
