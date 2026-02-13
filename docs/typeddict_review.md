# TypedDict 引入机会审查报告

## 概述

本报告审查了 Akagi-NG 后端项目中可以引入 `TypedDict` 的位置，以增强类型安全性和代码可维护性。

目前项目中已有 **2 个** TypedDict 定义：

- [`MjaiMetadata`](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/core/types.py) - MJAI 响应元数据
- [`EngineNotificationFlags`](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/core/types.py) - 引擎状态通知
- [`Recommendation`](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/core/types.py) - 推荐项定义
- [`MJAIEvent`](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/bridge/types.py) 及其子类型 - MJAI 协议事件

通过代码审查，发现约 **50+ 处**使用裸 `dict` 或 `dict[str, Any/object]` 注解，其中 **7 个高价值候选**适合引入 TypedDict。

---

## 高优先级候选

### 1. 引擎元数据结构

#### 1.1 通知标志 (Notification Flags)

**当前状态**: `dict[str, bool]` 或 `dict[str, Any]`

**出现位置**:

- [engine/base.py:L118](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/mjai_bot/engine/base.py#L118)
- [engine/provider.py:L59](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/mjai_bot/engine/provider.py#L59)
- [engine/akagi_ot.py:L118](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/mjai_bot/engine/akagi_ot.py#L118)
- [core/protocols.py:L24](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/core/protocols.py#L24)

**涉及字段**:

```python
fallback_used: bool
circuit_open: bool
circuit_restored: bool
no_engine_available: bool
riichi_lookahead_failed: bool
model_loaded_local: bool
model_loaded_online: bool
```

**建议 TypedDict**:

```python
class EngineNotificationFlags(TypedDict, total=False):
    """引擎通知标志"""
    fallback_used: bool  # 是否使用了回退引擎
    circuit_open: bool  # 熔断器是否打开
    circuit_restored: bool  # 熔断器是否已恢复
    no_engine_available: bool  # 是否无可用引擎
    model_loaded_local: bool  # 本地模型已加载
    model_loaded_online: bool  # 在线模型已加载
    riichi_lookahead_failed: bool  # 立直前瞻是否失败
```

**影响范围**: 中等 (约 10 处引用)

---

#### 1.2 附加元数据 (Additional Meta)

**当前状态**: `dict[str, Any]` 或 `dict[str, object]`

**出现位置**:

- [engine/base.py:L124](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/mjai_bot/engine/base.py#L124)
- [engine/provider.py:L75](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/mjai_bot/engine/provider.py#L75)
- [engine/akagi_ot.py:L127](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/mjai_bot/engine/akagi_ot.py#L127)

**涉及字段**:

```python
engine_type: str  # "mortal" | "akagiot" | "null" | "unknown"
circuit_open: bool
fallback_used: bool
no_engine_available: bool
```

**建议 TypedDict**:

```python
from typing import Literal

EngineType = Literal["mortal", "akagiot", "replay", "unknown", "null"]

class EngineAdditionalMeta(TypedDict, total=False):
    """引擎附加元数据"""
    engine_type: EngineType
    circuit_open: bool
    fallback_used: bool
    no_engine_available: bool
```

**影响范围**: 中等 (约 8 处引用)

---

### 2. DataServer 相关结构

#### 2.1 推荐项 (Recommendation Item)

**当前状态**: `dict[str, object]`

**出现位置**:

- [dataserver/adapter.py:L15](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/dataserver/adapter.py#L15) (返回值)
- [dataserver/adapter.py:L142](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/dataserver/adapter.py#L142) (列表元素)
- [dataserver/adapter.py:L151](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/dataserver/adapter.py#L151) (局部变量)

**涉及字段**:

```python
action: str  # "chi" | "pon" | "kan" | "reach" | "tsumo" | "ron" | "nukidora" | ...
confidence: float
tile: NotRequired[str]  # 牌张，如 "1m", "E"
consumed: NotRequired[list[str]]  # 消耗的牌
sim_candidates: NotRequired[list[dict]]  # 立直模拟候选
```

**建议 TypedDict**:

```python
class SimCandidate(TypedDict):
    """立直候选切牌"""
    tile: str
    confidence: float

class Recommendation(TypedDict):
    """DataServer 推荐项"""
    action: str
    confidence: float
    tile: NotRequired[str]
    consumed: NotRequired[list[str]]
    sim_candidates: NotRequired[list[SimCandidate]]
```

**影响范围**: 高 (约 15+ 处引用，核心数据结构)

---

#### 2.2 DataServer 载荷 (Payload)

**当前状态**: `dict[str, object]`

**出现位置**:

- [dataserver/adapter.py:L218](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/dataserver/adapter.py#L218) (函数返回值)

**涉及字段**:

```python
recommendations: list[RecommendationItem]
engine_type: str | None
fallback_used: bool | None
circuit_open: bool | None
```

**建议 TypedDict**:

```python
class FullRecommendationData(TypedDict, total=False):
    """发送到 DataServer 的载荷"""
    recommendations: list[Recommendation]
    engine_type: NotRequired[str | None]
    fallback_used: NotRequired[bool | None]
    circuit_open: NotRequired[bool | None]
```

**影响范围**: 低 (仅 1 处定义，但清晰化核心接口)

---

### 3. SSE 客户端数据

**当前状态**: `dict[str, dict]` (过于宽泛)

**出现位置**:

- [dataserver/sse.py:L24](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/dataserver/sse.py#L24)

**涉及字段**:

```python
response: web.StreamResponse
queue: asyncio.Queue
```

**建议 TypedDict**:

```python
import asyncio
from aiohttp import web

class SSEClientData(TypedDict):
    """SSE 客户端数据"""
    response: web.StreamResponse
    queue: asyncio.Queue
```

**影响范围**: 低 (约 5 处引用)

---

## 中优先级候选

### 6. Electron 消息类型

**当前状态**: `dict`

**出现位置**:

- [electron_client/base.py:L32](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/electron_client/base.py#L32)
- [electron_client/tenhou.py:L20](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/electron_client/tenhou.py#L20)
- [electron_client/majsoul.py:L20](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/electron_client/majsoul.py#L20)

**涉及字段** (因消息类型而异):

```python
# 通用字段
type: str

# websocket_created
url: str

# websocket
direction: str  # "inbound" | "outbound"
data: str
opcode: int

# liqi_definition
data: str
```

**建议 TypedDict** (需要多个子类型):

```python
class BaseElectronMessage(TypedDict):
    """Electron 消息基类"""
    type: str

class WebSocketCreatedMessage(BaseElectronMessage):
    type: Literal["websocket_created"]
    url: str

class WebSocketClosedMessage(BaseElectronMessage):
    type: Literal["websocket_closed"]

class WebSocketFrameMessage(BaseElectronMessage):
    type: Literal["websocket"]
    direction: str
    data: str
    opcode: NotRequired[int]

class LiqiDefinitionMessage(BaseElectronMessage):
    type: Literal["liqi_definition"]
    data: str

class DebuggerDetachedMessage(BaseElectronMessage):
    type: Literal["debugger_detached"]

ElectronMessage = (
    WebSocketCreatedMessage
    | WebSocketClosedMessage
    | WebSocketFrameMessage
    | LiqiDefinitionMessage
    | DebuggerDetachedMessage
)
```

**影响范围**: 中等 (约 15 处引用，涉及多个模块)

---

### 7. 立直前瞻元数据 (已整合)

**现状**: 已直接整合进 `MjaiMetadata` (自引用 `riichi_lookahead: Self`)，失败情况通过 `riichi_lookahead_failed` 标志位处理。

---

## 不建议引入 TypedDict 的场景

### 1. settings.py 中的动态字典

**位置**: [settings/settings.py:L68](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/settings/settings.py#L68)

**原因**:

- 用于反序列化任意 JSON 数据
- 字段动态变化，不适合静态类型

**建议**: 保持 `dict`，配合运行时验证

---

### 2. 临时/中间字典

**示例**:

- [mjai_bot/utils.py:L162](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/mjai_bot/utils.py#L162) - `meta_to_recommend` 函数参数
- [bridge/tenhou/utils/decoder.py:L110](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/bridge/tenhou/utils/decoder.py#L110) - XML 解析结果

**原因**:

- 仅在函数内部使用，生命周期短
- 引入 TypedDict 收益不大

**建议**: 保持 `dict`

---

### 3. 来自外部库的字典

**示例**:

- [bridge/majsoul/liqi.py:L51](file:///c:/Users/dongzhenxian/Documents/code/Akagi-NG/akagi_backend/akagi_ng/bridge/majsoul/liqi.py#L51) - Protobuf 反序列化结果

**原因**:

- 结构由外部库定义
- 修改成本高，收益低

**建议**: 保持 `dict`

---

## 实施建议

### 优先级排序

1. **P0 (立即执行)**:
   - `RecommendationItem` - 核心数据结构，影响范围广
   - `MJAIResponseMeta` - 核心数据流

2. **P1 (短期执行)**:
   - `EngineNotificationFlags` - 提升引擎状态管理
   - `EngineAdditionalMeta` - 统一引擎接口

3. **P2 (中期执行)**:
   - `DataServerPayload` - 清晰化接口边界
   - `SSEClientData` - 改善 SSE 模块类型安全

4. **P3 (长期执行)**:
   - `ElectronMessage` - 较复杂，可分阶段实施
   - `RiichiLookaheadMeta` - 影响范围小

---

### 实施步骤

#### 阶段 1: 定义 TypedDict

1. 在 `akagi_ng/core/types.py` (新建) 或 `akagi_ng/bridge/types.py` 中定义所有 TypedDict
2. 确保导入路径清晰，避免循环依赖

#### 阶段 2: 渐进式替换

1. 从叶子节点开始（如 `RiichiCandidate`）
2. 逐步向上替换（如 `RecommendationItem`）
3. 最后替换根节点

#### 阶段 3: 运行时验证

对于关键数据结构，添加运行时验证：

```python
from typing import TypedDict, get_type_hints
import inspect

def validate_typed_dict(data: dict, typed_dict_class: type[TypedDict]) -> bool:
    """验证字典是否符合 TypedDict 定义"""
    hints = get_type_hints(typed_dict_class)
    required_keys = {k for k in hints if not is_not_required(k)}

    # 检查必需字段
    if not required_keys.issubset(data.keys()):
        return False

    # 检查字段类型 (简化版)
    for key, value in data.items():
        if key in hints:
            expected_type = hints[key]
            if not isinstance(value, expected_type):
                return False

    return True
```

#### 阶段 4: 测试覆盖

1. 为每个 TypedDict 添加单元测试
2. 验证类型安全性（使用 mypy/pyright）
3. 回归测试确保功能不受影响

---

## 预期收益

### 1. 类型安全性

- **编译时检查**: IDE 可以检测字段拼写错误
- **自动补全**: 提升开发效率
- **重构安全**: 字段重命名时自动检测所有引用

### 2. 代码可读性

- **明确接口**: 不再需要查看文档或注释
- **自文档化**: TypedDict 本身即为契约

### 3. 维护性

- **减少错误**: 字段类型不匹配会被提前发现
- **降低认知负担**: 不需要记忆字典结构

---

## 风险评估

### 低风险

- `SSEClientData`
- `RiichiLookaheadMeta`

**原因**: 影响范围小，易于回滚

### 中风险

- `EngineNotificationFlags`
- `EngineAdditionalMeta`
- `DataServerPayload`

**原因**: 涉及多个模块，需要协调修改

### 高风险

- `RecommendationItem`
- `ElectronMessage`

**原因**: 核心数据结构，影响大量代码

**缓解措施**:

1. 分阶段实施，先添加类型注解，再逐步替换
2. 保持向后兼容，使用 `total=False` 和 `NotRequired`
3. 充分测试，确保不影响现有功能

---

## 总结

本报告涉及的大部分高价值 TypedDict 已在 `akagi_ng/core/types.py` 中实现：

1. `Recommendation` + `SimCandidate` (已实施)
2. `EngineNotificationFlags` + `EngineAdditionalMeta` (已实施)
3. `FullRecommendationData` (已实施)
4. `SSEClientData` (已实施)

**后续建议**:

1. 实施 `ElectronMessage` (P2)
2. 持续优化 `MjaiMetadata` 的字段覆盖率。
