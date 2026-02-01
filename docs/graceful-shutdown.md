# 优雅关闭机制改进

## 问题描述

由于 Electron 管理了后端的生命周期,原本程序退出时的日志无法被记录。这是因为:

1. **Windows 平台的信号限制**: 在 Windows 上,`SIGTERM` 信号不会触发 Python 的信号处理器,而是直接终止进程
2. **Electron 的进程管理**: Electron 使用 `ChildProcess.kill()` 直接终止后端进程,导致 Python 的 `cleanup()` 方法无法执行
3. **日志丢失**: 退出时的清理日志、组件停止状态等重要信息无法被记录

## 解决方案

### 1. 后端改进

#### 1.1 增强日志配置 (`akagi_ng/core/logging.py`)

- 在 GUI 模式下,日志同时输出到文件和 `stderr`
- 确保 Electron 可以捕获所有日志输出,包括退出日志

```python
def configure_logging(level: str = "INFO"):
    logger.remove()

    # 始终输出到文件
    logger.add(log_file, level=level, format=LOG_FORMAT, enqueue=True)

    # 在 GUI 模式下,同时输出到 stderr 供 Electron 捕获
    if os.getenv("AKAGI_GUI_MODE") == "1":
        logger.add(sys.stderr, level=level, format=LOG_FORMAT, enqueue=True)
```

#### 1.2 改进信号处理 (`akagi_ng/application.py`)

- 添加详细的信号处理日志
- 记录接收到的信号类型和触发的关闭流程

```python
def _setup_signals(self):
    def signal_handler(signum: int, frame: object) -> None:
        sig_name = signal.Signals(signum).name
        logger.info(f"Received signal {sig_name} ({signum}), initiating graceful shutdown...")
        self.stop()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
```

#### 1.3 增强清理日志 (`akagi_ng/application.py`)

- 为每个组件的停止过程添加详细日志
- 记录成功和失败的情况

```python
def cleanup(self):
    logger.info("Stopping Akagi-NG...")

    # 停止 MITM 客户端
    if app.mitm_client:
        try:
            logger.info("Stopping MITM client...")
            app.mitm_client.stop()
            logger.info("MITM client stopped successfully.")
        except Exception as e:
            logger.error(f"Error stopping MITM client: {e}")

    # ... 其他组件类似

    logger.info("Akagi-NG stopped gracefully.")
```

#### 1.4 添加 Shutdown API (`akagi_ng/dataserver/api.py`)

- 新增 `/api/shutdown` 端点
- 允许 Electron 通过 HTTP POST 请求触发优雅关闭
- 这是在 Windows 上实现优雅关闭的最可靠方式

```python
async def shutdown_handler(_request: web.Request) -> web.Response:
    logger.info("Received shutdown request from API")
    app = get_app_context()
    if hasattr(app, "akagi_app") and app.akagi_app:
        logger.info("Initiating graceful shutdown via API...")
        app.akagi_app.stop()
        return _json_response({"ok": True, "message": "Shutdown initiated"})
    # ...
```

#### 1.5 扩展 AppContext (`akagi_ng/core/context.py`)

- 添加 `akagi_app` 字段,存储 `AkagiApp` 实例的引用
- 使得 API 端点可以访问并触发优雅关闭

### 2. Electron 改进

#### 2.1 优雅关闭流程 (`electron/backend-manager.ts`)

实现了多层次的优雅关闭机制:

```typescript
public async stop() {
  // 步骤 1: 通过 API 触发优雅关闭 (最可靠)
  try {
    await fetch(`http://${this.HOST}:${this.PORT}/api/shutdown`, {
      method: 'POST',
      signal: controller.signal,
    });
  } catch (error) {
    // 步骤 2: 回退到信号方式
    this.pyProcess.kill('SIGTERM');
  }

  // 步骤 3: 超时后强制终止
  setTimeout(() => {
    if (this.pyProcess && !this.pyProcess.killed) {
      this.pyProcess.kill('SIGKILL');
    }
  }, 5000);
}
```

## 工作流程

1. **Electron 关闭时**:
   - 调用 `BackendManager.stop()`
2. **优雅关闭尝试**:
   - 首先发送 HTTP POST 到 `/api/shutdown`
   - 后端接收请求,记录日志,调用 `AkagiApp.stop()`
   - 触发主循环退出,执行 `cleanup()`
3. **清理过程**:
   - 依次停止 MITM 客户端、Electron 客户端、DataServer
   - 每个步骤都记录详细日志
   - 最终记录 "Akagi-NG stopped gracefully."
4. **超时保护**:
   - 如果 API 调用失败,回退到 SIGTERM
   - 如果 5 秒内进程未退出,发送 SIGKILL 强制终止

## 测试验证

创建了测试脚本 `tests/manual/test_api_shutdown.py` 来验证:

- ✅ 后端启动正常
- ✅ API 端点响应正确
- ✅ 所有关键日志都被记录
- ✅ 进程优雅退出

测试输出示例:

```
✓ 找到日志: 'Received shutdown request from API'
✓ 找到日志: 'Initiating graceful shutdown via API'
✓ 找到日志: 'Stopping Akagi-NG'
✓ 找到日志: 'Stopping MITM client...'
✓ 找到日志: 'Stopping Electron client...'
✓ 找到日志: 'Stopping DataServer...'
✓ 找到日志: 'Akagi-NG stopped gracefully'
```

## 优势

1. **跨平台兼容**: API 方式在 Windows、Linux、macOS 上都能正常工作
2. **可靠性高**: 多层次回退机制确保进程最终能够退出
3. **日志完整**: 所有退出过程都被详细记录,便于排查问题
4. **优雅降级**: 即使 API 调用失败,仍有信号和强制终止作为后备

## 相关文件

### 后端

- `akagi_ng/application.py` - 主应用类,信号处理和清理逻辑
- `akagi_ng/core/logging.py` - 日志配置
- `akagi_ng/core/context.py` - 应用上下文
- `akagi_ng/dataserver/api.py` - API 端点

### 前端

- `electron/backend-manager.ts` - 后端进程管理

### 测试

- `tests/manual/test_api_shutdown.py` - API 关闭测试
- `tests/manual/test_graceful_shutdown.py` - 信号关闭测试(Windows 上不适用)
