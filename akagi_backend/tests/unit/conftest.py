"""单元测试共享 fixtures"""

import sys
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def mock_lib_loader_module():
    """Mock lib_loader 模块，防止加载真实二进制库"""
    mock_module = MagicMock()
    mock_module.libriichi = MagicMock()
    mock_module.libriichi.mjai.Bot = MagicMock
    mock_module.libriichi3p = MagicMock()
    mock_module.libriichi3p.mjai.Bot = MagicMock

    with patch.dict(sys.modules, {"akagi_ng.core.lib_loader": mock_module}):
        yield mock_module
