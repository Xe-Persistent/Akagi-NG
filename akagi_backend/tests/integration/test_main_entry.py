"""Main Entry Integration Tests"""

from unittest.mock import patch

from akagi_ng.__main__ import main


def test_main_execution():
    with patch("akagi_ng.__main__.AkagiApp") as MockApp:
        mock_instance = MockApp.return_value
        mock_instance.run.return_value = 0

        ret = main()

        assert ret == 0
        MockApp.assert_called_once()
        mock_instance.initialize.assert_called_once()
        mock_instance.start.assert_called_once()
        mock_instance.run.assert_called_once()


def test_main_execution_failure():
    with patch("akagi_ng.__main__.AkagiApp") as MockApp:
        mock_instance = MockApp.return_value
        mock_instance.run.return_value = 1

        ret = main()

        assert ret == 1
