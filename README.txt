# Akagi-NG Desktop

Akagi-NG 是一个本地运行的麻将分析与辅助工具。
它不会修改游戏客户端，也不包含任何自动打牌功能。

Akagi-NG is a local desktop tool for Mahjong analysis and assistance.
It does not modify the game client and does not perform automatic gameplay.

---

## Quick Start | 快速开始

1. 解压下载的压缩包
2. 双击运行 `Akagi-NG`
3. 首次启动可能较慢，请耐心等待初始化完成

1. Extract the downloaded archive
2. Double-click `Akagi-NG`
3. The first launch may take longer due to initialization

> macOS: the build is unsigned and not notarized. On first launch, right-click `Akagi-NG.app` and choose **Open**, or allow it in **System Settings → Privacy & Security**. If macOS still blocks it, run `xattr -dr com.apple.quarantine /Applications/Akagi-NG.app`.

> macOS：构建未签名、未公证。首次启动请右键点击 `Akagi-NG.app` 选择“打开”，或在“系统设置 → 隐私与安全性”中允许运行；若仍被拦截，可执行 `xattr -dr com.apple.quarantine /Applications/Akagi-NG.app`。

---

## Configuration | 配置说明

Akagi-NG 的配置文件位于程序目录下：

`config/settings.json`

配置文件结构 **可能会在不同版本之间发生变化**。
当检测到配置不兼容时，程序会自动将原配置备份为
`settings.json.bak`，并生成新的配置文件。

Akagi-NG stores its configuration at:

`config/settings.json`
(located alongside the executable)

The configuration format may change between versions.
If an incompatible configuration is detected, it will be automatically
backed up as `settings.json.bak` and a new configuration will be generated.

---

## Updating Akagi-NG | 更新方式

Akagi-NG 以便携式（portable）形式发布。

更新方式：
- 删除旧版本目录
- 解压新的版本压缩包

如果配置结构发生变化，配置文件可能会被重置。

Akagi-NG is distributed as a portable application.

To update:
- Remove the old directory
- Extract the new version

Configuration files may be reset if the format has changed.

---

## Logs | 日志

运行日志会生成在 `logs/` 目录中。
当程序无法启动或行为异常时，请优先查看该目录下的日志文件。

Runtime logs are written to the `logs/` directory.
If the application fails to start or behaves unexpectedly,
please check the log files first.

---

## Notes | 说明

- Akagi-NG 不会安装系统级组件
- 不会修改注册表或系统配置
- 不会在系统目录中写入文件

Akagi-NG does not install system-wide components,
modify system settings, or write to system directories.

---

GitHub: https://github.com/Xe-Persistent/Akagi-NG
License: AGPL-3.0
