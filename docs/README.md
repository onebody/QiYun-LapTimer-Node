# QiYun-LapTimer-Node 文档中心

骑云 FPV 竞速计时系统（ESP32 + RX5808 单节点圈速计时器）的完整文档。

| 文档 | 内容 | 适合谁 |
|---|---|---|
| [01-项目说明](01-project-overview.md) | 产品定位、RSSI 峰值计时原理、系统架构、网络模式、技术选型、上云链路、安全边界 | 想搞清"这是什么、怎么工作"的任何人 |
| [02-操作手册](02-user-manual.md) | 物料 → 接线 → 烧录 → 首连 → 配置 → 校准 → 比赛 → 上云 → OTA → 维护 → 故障排除 | DIY 组装者与赛场操作员 |
| [03-开发指南](03-development-guide.md) | 项目结构、三上下文运行时模型、HTTP/SSE API 参考、配置持久化、改动落点、已知限制、发布约定 | 二次开发者、上位机/云平台对接方 |

## 这里是唯一出处

本目录的三份 Markdown 承载全部说明内容，仓库其他任何位置（根 README、代码注释、网页文案、Issue 回复）只允许**指向这里**，不复制内容。已按此规则清理掉的重复/失效材料：

| 已移除 | 原因 | 现在去哪里看 |
|---|---|---|
| `docs/site/`（5 页手写 HTML） | 与三份 md 内容重复，改动必然漂移 | 本目录 md；GitHub 直接渲染，离线用任意 Markdown 查看器 |
| `test_modifications.md`（仓库根） | 早期改动小结，机尺寸/门径/阈值算法全部与现行代码矛盾 | [01 §2](01-project-overview.md#2-工作原理)、[02 §7](02-user-manual.md#7-校准最关键的一步) |
| `test/README`、`include/README` | PlatformIO 脚手架样板说明，两个目录内无任何源文件 | —— （项目无自动化测试，见 [03 §7](03-development-guide.md#7-已知限制动手前值得知道) 第 10 条） |

## 版本信息

| 项 | 值 | 定义位置 |
|---|---|---|
| 固件版本 | 1.0.9 | [lib/debug.h](../lib/debug.h) `FIRMWARE_VERSION` |
| 文件系统版本 | 1.0.7 | [lib/debug.h](../lib/debug.h) `FILESYSTEM_VERSION` |
| 配置结构版本 | 4U | [lib/config.h](../lib/config.h) `CONFIG_VERSION` |
| 许可证 / 版权 | MIT / Copyright (c) 2026 onebody | [LICENSE](../LICENSE)，第三方组件许可与引用明细见根 [README.md](../README.md) 的「许可与版权」 |

> **与仓库根 README 的关系**：根 [README.md](../README.md) 是精简入口（项目是什么 + 五分钟跑通 + 文档索引 + 许可与版权），完整手册只在本目录。
> **改动约定**：新增或修改使用说明、接线、校准、API、限制类内容，只改本目录文件，不要往根 README 里堆；反过来，许可/版权/引用致谢类的法律信息以根 README + `LICENSE` 为准，本目录只做指针。
> **源码引用约定**：文中形如 `lib/laptimer.cpp:146` 的行号会随重构漂移；以源码为准，改代码时顺手核对被引用的行号。
