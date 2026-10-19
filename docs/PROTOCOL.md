# Majsoul Protocol Descriptor

`assets/liqi.json` is the protobuf descriptor used to decode every Majsoul packet. It is extracted
**straight from the Mahjong Soul Unity client** asset bundles (`LuaByte/Lua/Protol/*_pb.lua.bytes`
plus `MyAssets/docs/proto_config.bytes`) instead of the CDN `res/proto/liqi.json`, which lags behind
the shipping client. The "update protocol" button in the settings panel runs the same pipeline at
runtime.

## Refresh locally

The command rewrites `assets/liqi.json` and `assets/liqi.meta.json`:

```bash
npx tsx scripts/extract-liqi.ts           # online: extract from the live client
npx tsx scripts/extract-liqi.ts --check   # compare only; exits non-zero when out of date
npx tsx scripts/extract-liqi.ts --from-raw tmp/raw   # offline: read Protol/*.lua + proto_config.bytes
```

## CI

The `Auto Liqi` workflow (`.github/workflows/auto-liqi.yml`) checks the client once a day and opens a
pull request whenever the extracted schema changes.

---

# 雀魂协议描述符

`assets/liqi.json` 是解析雀魂全部封包所依据的 protobuf 描述符，它**直接从雀魂 Unity 客户端**的
资源包中提取（`LuaByte/Lua/Protol/*_pb.lua.bytes` + `MyAssets/docs/proto_config.bytes`），不再使用
已滞后于客户端的 CDN `res/proto/liqi.json`。设置面板中的「更新协议文件」按钮会在运行时执行同一套流程。

## 本地刷新

以下命令会重写 `assets/liqi.json` 与 `assets/liqi.meta.json`：

```bash
npx tsx scripts/extract-liqi.ts           # 联网：从当前客户端提取
npx tsx scripts/extract-liqi.ts --check   # 只比对，不写入；不一致时以非 0 退出
npx tsx scripts/extract-liqi.ts --from-raw tmp/raw   # 离线：读取 Protol/*.lua 与 proto_config.bytes
```

## CI

`Auto Liqi` 工作流（`.github/workflows/auto-liqi.yml`）每天检查一次客户端协议，有变化时自动提交 PR。
