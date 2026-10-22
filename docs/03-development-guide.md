# QiYun-LapTimer-Node 开发指南

> 面向二次开发者与上位机对接方。改代码前请先读第 2 节"运行时模型"。
> 固件 `1.0.9` / 文件系统 `1.0.7` / 配置结构 `CONFIG_VERSION = 4U`

---

## 1. 项目结构

```
QiYun-LapTimer-Node/
├── src/main.cpp            装配所有模块 + 双核调度（见"运行时模型"）
├── platformio.ini          4 个构建环境，依赖锁定版本
├── partitions.csv          双 OTA + LittleFS 分区表
├── data/                   ← 整个文件夹 = LittleFS 镜像（改这里只需 uploadfs）
│   ├── index.html          四页签单页应用
│   ├── script.js           全部前端逻辑：频段查表、校准向导、SSE、TTS、圈速表
│   ├── style.css           样式
│   ├── smoothie.js         实时折线图
│   ├── articulate.min.js   浏览器 TTS 封装
│   ├── jquery-3.7.1.min.js
│   ├── favicon.ico         页面图标
│   └── update/index.htm    OTA 上传页（被 iframe 内嵌）
└── lib/            9 个项目库，一模块一目录（PIO 只识别 lib/<子目录>）
    ├── CONFIG/config.h/.cpp     ★ 引脚表 + EEPROM 结构体 + JSON 序列化
    ├── RX5808/RX5808.h/.cpp     调频（软件 SPI + 寄存器回读校验）与 RSSI 采样
    ├── KALMAN/kalman.h/.cpp     一维卡尔曼滤波
    ├── LAPTIMER/laptimer.h/.cpp ★ 计时状态机、峰值捕获、校准采样
    ├── WEBSERVER/webserver.h/.cpp ★ WiFi 状态机 + 全部路由 + SSE + 云端上传
    ├── LED/led、BUZZER/buzzer、BATTERY/battery .h/.cpp  非阻塞外设状态机
    └── DEBUG/debug.h      ★ FIRMWARE_VERSION / FILESYSTEM_VERSION / DEBUG 宏
```

## 2. 运行时模型（改代码前务必理解）

工作被分到**三个上下文**，跨上下文共享数据**没有锁**：

| 上下文 | 位置 | 负责 |
|---|---|---|
| `loop()`（core 1） | `src/main.cpp:62` | 计时判定 `handleLapTimerUpdate()`、`ElegantOTA.loop()` |
| `parallelTask`（core 0，优先级 0，已 `disableCore0WDT()`） | `src/main.cpp:16` | LED、蜂鸣、EEPROM 落盘、切频、电池监测、RSSI 推送、WiFi 状态机、重启请求 |
| AsyncTCP 事件任务 | 库内部 | 所有 HTTP/SSE 路由 handler |

由此产生两条必须遵守的规矩：

1. **不要在路由 handler 里做阻塞操作**（`delay`、HTTPClient、长时间循环），它会卡死整个 web 服务和 SSE。需要耗时动作就置一个标志位，交给 `handleWebUpdate()` 在 core 0 处理——`restartRequested` 就是这个模式，照抄它。
2. **路由 handler 不要直接调用会触发网络请求的方法**（如 `timer->stop()`——当前 `/timer/stop` 的上云路径违反此条，属已知问题 #5）。

## 3. HTTP API 参考

所有响应默认带 `Access-Control-Allow-Origin: *`；全局响应头含 CSP、`X-Frame-Options: SAMEORIGIN`、`X-XSS-Protection`、`X-Content-Type-Options: nosniff`。**所有接口均无鉴权**（已知限制 #1），只可在可信网络暴露。

代码位置：`lib/WEBSERVER/webserver.cpp:587` 起的路由注册区。

### 3.1 页面与探测

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 返回 LittleFS 中的 `index.html`；静态资源整体 `serveStatic`，缓存 `max-age=600` |
| GET | `/generate_204` `/gen_204` `/hotspot-detect.html` `/connectivity-check.html` `/fwlink` `/ncsi.txt` `/success.txt` `/canonical.html` `/library/test/success.html` `/check_network_status.txt` | 各系统 captive portal 探测路径，全部重定向到首页 |

### 3.2 设备信息

| 方法 | 路径 | 响应 |
|---|---|---|
| GET | `/status` | `text/plain` 诊断文本：Heap（Free/Min/Size/Alloc）、LittleFS（Used/Total）、芯片（Model/Rev/Cores/SDK/FlashSize/FlashSpeed/CPU Speed）、Firmware Version、网络 IP 与 MAC、EEPROM 配置 dump、电池电压 |
| GET | `/version` | `{"version":"1.0.9","filesystemVersion":"1.0.7"}` |
| GET | `/config` | 配置 JSON（`conf->toJson`，流式响应）。⚠️ 序列化缓冲 `DynamicJsonDocument(320)`，字段字符串较长时**可能被截断**（已知限制 #3）；且**明文包含 WiFi 密码** |

### 3.3 计时控制（均为 POST，成功响应 `{"status": "OK"}`）

| 路径 | 行为 |
|---|---|
| `/timer/start` | `timer->start()`，进入计时状态 |
| `/timer/stop` | `timer->stop()`；满足条件时**在当前请求上下文同步执行云端上传**（`laptimer.cpp:50` 的 stop 回调 → `webserver.cpp:120` → `:124`，已知问题 #5，上传期间 web/SSE 卡顿数秒） |
| `/timer/rssiStart` | 打开 SSE RSSI 推送（`sendRssi = true`） |
| `/timer/rssiStop` | 关闭 RSSI 推送 |

### 3.4 校准

| 路径 | 响应 |
|---|---|
| POST `/calibration/noise/start` | `{"status": "OK"}`，开始累加底噪采样 |
| POST `/calibration/noise/stop` | `{"status":"OK","maxNoise":<u8>,"samples":<u16>,"target":<u16>,"ok":<bool>}`（`ok = samples >= 配置的采样次数`） |
| POST `/calibration/crossing/start` | 已废弃，仅为兼容保留 |
| POST `/calibration/crossing/stop` | 已废弃：恒返回 `"maxPeak":0`（已知限制 #8），新校准向导不依赖它 |

### 3.5 配置写入与重启

| 路径 | 行为 |
|---|---|
| POST `/config` | JSON body（`AsyncCallbackJsonWebHandler`）→ `conf->fromJson()` + 立即 `EEPROM.put` 落盘。⚠️ **缺字段会被清零**（无 `containsKey` 守卫，已知限制 #4；`freq=0` 会让 RX5808 收到非法寄存器值）。只有 ssid/password 变化时前端才调 `/save_and_restart` |
| POST `/save_and_restart` | `conf->write()` 后置 `restartRequested` 标志，由 core 0 的 `handleWebUpdate()` 执行重启（不在 handler 内直接 `ESP.restart()`，照此模式写新接口） |

### 3.6 OTA 更新

| 路径 | 行为 |
|---|---|
| POST `/update` | multipart 上传 `.bin`；自定义 handler 用 `Update.begin/write/end`，成功后 `ESP.restart()`，失败返回 500 `{"status":"FAIL"}`。ElegantOTA 同时挂载在 `/update` 区（`ELEGANTOTA_USE_ASYNC_WEBSERVER=1`） |
| POST `/update/fs/single` | 单文件覆盖 LittleFS（如只更新 `script.js`），无需整镜像 |
| GET `/update` | `data/update/index.htm` OTA 上传界面（被主页面 iframe 内嵌） |

> 更新接口无鉴权——同网段任意设备可刷写固件。

### 3.7 SSE 事件流（GET `/events`）

`AsyncEventSource`，连接时服务端先发 `event: start`。

| 事件名 | data | 频率 |
|---|---|---|
| `rssi` | 滤波后 RSSI（0–255 的无符号整数字符串） | `/timer/rssiStart` 开启后每 200 ms |
| `lap` | 圈速毫秒数（十进制字符串） | 每次过圈即时推送 |

## 4. 前端（data/）

- 全部逻辑集中在 `data/script.js`：频段频率查表（`:96`）、校准推荐值算法（`:201`）、SSE 订阅、Smoothie 曲线、圈速表、articulate.js TTS（`doSpeak()`，`:1327`）。
- **纯前端状态清单**（刷新即丢）：累计用时、圈速表、时钟。播报类型额外存 `localStorage` 且**优先于设备配置**。
- 改 `data/` 只需 `pio run -t uploadfs`，不用重烧固件。

## 5. 配置持久化（改配置相关代码必读）

配置是一个 **POD 结构体直接 `EEPROM.put` 到 NVS**（`lib/CONFIG/config.cpp:61`），不是逐字段序列化：

- 字段**顺序或类型变化会让老设备读出垃圾数据**；改结构体必须同时提升 `CONFIG_VERSION` 并在 `load()` 里为旧版本补迁移分支。
- 头部 2 bit 为 magic（`CONFIG_MAGIC`），校验失败回落 `setDefaults()`。
- 当前结构体占 **224 字节**，`EEPROM_RESERVED_SIZE = 256`，**只剩 32 字节余量**，加字符串字段要同时算总量。
- 无恢复出厂接口：`pio run -t erase` 擦 NVS，或临时提升 `CONFIG_VERSION` 触发默认值。
- 改完配置代码用 `GET /status` 核对读出的值。

**新增一个配置项的完整步骤**：

1. `laptimer_config_t` 加字段；
2. `CONFIG_VERSION` 加一，并在 `load()` 补旧版本迁移分支；
3. `toJson` / `toJsonString` / `fromJson` / `setDefaults` 四处都要加；
4. 前端 `saveConfig()` 加字段。

## 6. 常用改动落点

| 想做的事 | 改哪里 |
|---|---|
| 适配自己的板子引脚 | `lib/CONFIG/config.h:28-83` 加 `#elif` 分支 + `platformio.ini` 加 env（**同步更新同文件 `:5` 的接线表注释**） |
| 改过圈判定阈值逻辑 | `lib/LAPTIMER/laptimer.cpp:146-179` `lapPeakCapture` / `lapPeakCaptured` |
| 换滤波强度 | `lib/LAPTIMER/laptimer.cpp:5-16` `rssi_filter_q`/`rssi_filter_r`；注意注释里的量级换算与实际传入值不一致，且 `setMeasurementNoise` 设的是 Q、`setProcessNoise` 设的是 R（与常规命名相反），改前实测 |
| 新增 REST 接口 | `lib/WEBSERVER/webserver.cpp:595` 起的路由区（遵守第 2 节两条规矩） |
| 改上传 payload | `lib/WEBSERVER/webserver.cpp:124` `uploadTrainingData()` |
| 改播报文案/语言 | `data/script.js:1327` `doSpeak()` |
| 改版本显示 | `lib/DEBUG/debug.h:6-8` 两个宏（手动改，无 CI） |

## 7. 已知限制（动手前值得知道）

| # | 现象 | 根因位置 | 影响 |
|---|---|---|---|
| 1 | 更新/配置接口无鉴权 | `webserver.cpp:753` `/update`、`:821` `/update/fs/single`、`ElegantOTA.begin()`（`:858`）未 `setAuth` | 同网段任意设备可刷固件；`/config` 明文回显 WiFi 密码 |
| 2 | `exitRssi` 存了但判定不用 | `laptimer.cpp:159-178` | UI 滑块无效，容易被误判成"校准坏了" |
| 3 | `GET /config` 返回可能被截断 | `config.cpp:71` `DynamicJsonDocument(320)` 装不下含长字符串的 15 字段 | 页面显示不全，表现为"没保存住" |
| 4 | `POST /config` 缺字段会被清零 | `config.cpp:111-138` 无 `containsKey` 守卫 | 上位机只 POST 部分字段会把阈值归零（`freq=0` → RX5808 非法寄存器值） |
| 5 | 停止计时时同步发 HTTP | `webserver.cpp:656` → `laptimer.cpp:50` → `webserver.cpp:124` | 上传期间 web/SSE 卡住数秒，弱网更久 |
| 6 | NTP 同步阻塞最长 10 s | `webserver.cpp:541` `startNTP()`（`:552` 的 `delay(1000)` 重试循环） | 无外网时开机后设备"假死"十秒 |
| 7 | 跨核读写共享状态无同步 | `rssi[]` / `lapTimes[]` / `lapCount` / `conf` | 偶发一圈数据错乱；排查现场异常成绩先看这里 |
| 8 | 穿越校准接口已废弃但状态位不复位 | `webserver.cpp:717` | 前端 `stopCalibCrossing()` 恒拿 `maxPeak=0`；新向导不依赖，可忽略 |
| 9 | `WAITING` 状态、`isLapAvailable()` 为死代码；前端还在调用不存在的 `/nodes` 接口 | `laptimer.cpp:107`、`script.js:962` | 无功能影响；`/nodes` 未在固件注册，前端请求恒 404。多节点计时尚未实现，仅前端预留 |
| 10 | 无自动化测试 | 仓库不含 `test/` 目录，也没有 CI | 改计时逻辑请自行做实录回放验证 |

## 8. 构建与发布

### 构建环境

| env | 板子 | f_cpu |
|---|---|---|
| `esp32dev` | ESP32-WROOM/WROVER | 240 MHz |
| `esp32-c3-devkitm-1` | ESP32-C3 DevKit M1 | 160 MHz |
| `esp32-s3-devkitc-1` | ESP32-S3 DevKit C-1 | 240 MHz（额外依赖 ArduinoZip） |
| `esp32doit-devkit-v1` | DOIT DevKit V1 | 240 MHz（ArduinoZip @0.2.0） |

公共配置：framework=arduino、platform=espressif32@6.9.0、LittleFS、`partitions.csv`、dio、115200 上传/监视波特率；`lib_compat_mode = strict` 下按 `#include` 精确拉取依赖。

**源码布局**：每个模块独占一个 `lib/<大写模块名>/` 目录，PlatformIO 才会把它当项目库自动编译，并给它补齐 Arduino 核心与 libdeps 的头文件搜索路径。**不要把 `.cpp/.h` 平铺在 `lib/` 根**：PIO 会忽略这批散文件，`pio run` 只剩 `main.cpp`；即使再用 `extra_scripts` + `env.BuildSources("$BUILD_DIR/lib_flat", "lib")` 强行把它们编进固件，这些目标也拿不到库路径，实测在 `#include <WiFi.h>`、`#include <ArduinoJson.h>` 处直接 `fatal error: No such file or directory`（`lib_compat_mode` 改 soft 也一样）。加新模块请建 `lib/<NAME>/` 目录，别改构建脚本。

```bash
pio run -e esp32dev                 # 编译固件
pio run -e esp32dev -t upload       # 烧固件
pio run -e esp32dev -t buildfs      # 只构建 littlefs.bin（OTA 用）
pio run -e esp32dev -t uploadfs     # 烧文件系统
```

实测结果（2026-10-22，`pio run -e esp32dev`，espressif32 6.9.0）：编译通过，**Flash 87.5 %（1 146 969 / 1 310 720 B）、RAM 15.5 %（50 940 / 327 680 B）**，产出 app 镜像 `.pio/build/esp32dev/firmware.bin`（1 153 552 B，烧写地址 `0x10000`）。同目录的 `bootloader.bin`（`0x1000`）、`partitions.bin`（`0x8000`）是各自独立的文件，`firmware.bin` 里**不含**它们。另 3 个 env 未实测（需各自工具链）。

> Apple Silicon 上的已知坑：espressif32 6.9.0 附带的 `tool-mklittlefs` 是 **x86_64** 二进制，未装 Rosetta 的 Mac 上 `-t buildfs` / `-t uploadfs` 会报 `Bad CPU type in executable`（`pio run` 本体不受影响）。两条出路：装 Rosetta（`softwareupdate --install-rosetta --agree-to-license`），或用上游源码自编一份 arm64 的 `mklittlefs` 顶替 `~/.platformio/packages/tool-mklittlefs/mklittlefs`。

### 版本与发布顺序

| 项 | 位置 | 当前值 |
|---|---|---|
| 固件版本 | `lib/DEBUG/debug.h:6` `FIRMWARE_VERSION` | `1.0.9` |
| 文件系统版本 | `lib/DEBUG/debug.h:8` `FILESYSTEM_VERSION` | `1.0.7` |
| 配置结构版本 | `lib/CONFIG/config.h:88` `CONFIG_VERSION` | `4U` |

三个版本号**全部手工维护**，改完记得同步。发布顺序：改宏 → `pio run` → `pio run -t upload` → 若动了 `data/` 则 `pio run -t buildfs` + `-t uploadfs`，并把文件系统版本号写进 `.bin` 文件名，方便场地多机核对。

### 对外发 GitHub Release（预编译镜像）

给用户免工具链升级用，产物是**两个独立文件**（app 与文件系统各一个），不要合并成一个整片镜像——合并包会把 `bootloader` / `partitions` 也塞进去，用户按 `0x10000` 刷就刷歪。

```bash
pio run -e esp32dev && pio run -e esp32dev -t buildfs
cp .pio/build/esp32dev/firmware.bin QYLPT-Node-firmware-v<FIRMWARE_VERSION>-esp32.bin
cp .pio/build/esp32dev/littlefs.bin QYLPT-Node-web-v<FILESYSTEM_VERSION>-littlefs.bin
shasum -a 256 QYLPT-Node-*.bin          # 校验值贴进发布说明
git push origin main                    # 先确保要发布的提交已在远端
gh release create v<FIRMWARE_VERSION> --target main \
  --title "v<FIRMWARE_VERSION> · 骑云 FPV 竞速计时系统（ESP32 单节点）" \
  --notes-file <发布说明.md> <两个 bin>
```

- 标签用 `v` + `FIRMWARE_VERSION`，打在含最新 `data/` 与固件的那个提交上；文件系统版本只体现在文件名里。
- 发布说明必须写清：两个文件各自的**烧写地址**（`0x10000` / `0x290000`）、SHA256、"缺 `bootloader.bin` / `partitions.bin` / `boot_app0.bin`，刷不亮空白模块"，以及**只验证过哪些 env**。
- 命名与地址口径以 [02 §3.4](02-user-manual.md#34-用-release-预编译镜像升级免装-platformio) 为准，改这里要同步改那里。
- 现行发布：`v1.0.9`（固件 1.0.9 / 网页 1.0.7），打在提交 `e8be1f5` 上。<https://github.com/onebody/QiYun-LapTimer-Node/releases/tag/v1.0.9>

### 验证约定

- 没有自动化测试与 CI（仓库不含 `test/` 目录）；改动计时逻辑后请做**实录回放验证**（同一场飞行的曲线 + 期望圈数对比）。
- UI 变更需在真机浏览器（AP 热点下）走一遍四个页签的完整路径。

## 9. 许可与第三方声明

许可、版权、第三方组件清单与信息引用**只在仓库根 [README.md](../README.md) 的「许可与版权」一节维护**（MIT，Copyright (c) 2026 onebody，完整条款见 [`LICENSE`](../LICENSE)），本节不再复制内容，仅给出对开发者有约束力的两条结论：

- 内联在 `data/` 里的第三方 JS **文件头许可声明不得删除**（articulate.js 没有声明，商用前需向上游确认）。
- 从上游（RotorHazard 为 GPLv3）**只参考文档与算法思路，不要把 GPL 代码摘进本 MIT 发布**。
