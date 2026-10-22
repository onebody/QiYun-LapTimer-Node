# QiYun-LapTimer-Node 项目说明

> 骑云 FPV 竞速计时系统 · 单节点固件与 Web 终端
> 适用固件版本 `1.0.9` / 文件系统版本 `1.0.7` / 配置结构版本 `4U`

---

## 1. 这是什么

一台**低成本、单节点**的 5.8 GHz FPV 穿越机圈速计时器。整台设备只有两块板子——ESP32 开发板 + RX5808 图传接收模块——自带中文 Web 配置页面。手机、平板或笔记本连上它自身的 WiFi 热点即可使用，不需要安装任何 App，也不需要服务器（数据上云为可选功能）。

一句话概括工作方式的差异：**它不"看见"飞机，它"听见"飞机**——穿越机图传开机即持续发射 5.8 GHz 信号，计时器通过 RSSI（信号强度）随距离变化的曲线来判定飞机何时通过计时门。

### 核心能力一览

| 能力 | 说明 |
|---|---|
| RSSI 峰值计时 | 以信号峰值时刻（而非回落点）判定过门，精度关键 |
| 多芯片支持 | ESP32（WROOM/WROVER/DOIT）、ESP32-C3、ESP32-S3 有独立构建环境；S2 有引脚表但需自建 env |
| 飞机尺寸自适应 | 2 寸机（1.0 m 门）/ 5 寸机（2.0 m 门）对应不同判定阈值 |
| 中文 Web UI | 配置 / 比赛 / 校准 / 更新四个页签，单页应用 |
| 自动校准向导 | 先选机型，再走三步：开始采底噪 → 实时读数 → 出推荐阈值并应用 |
| 实时 RSSI 曲线 | SSE 每 200 ms 推送一次采样值，浏览器绘制 |
| 语音播报 | 浏览器 TTS 播报单圈或累计用时，可调语速 |
| 本地反馈 | 蜂鸣器 + LED 由固件本地驱动，不依赖手机 |
| 训练数据上云 | 停止计时后自动 POST 圈速明细到自建平台（可选） |
| 双通道 OTA | 固件与文件系统均可网页更新，免拆机 |

### 与上游项目的关系

项目基于 [PhobosLT](https://github.com/phobos-/PhobosLT) / [RotorHazard](https://github.com/RotorHazard/RotorHazard) 的 RSSI 峰值计时思路，面向国内场景做了定制：

| 相对上游的改动 | 说明 |
|---|---|
| 多芯片支持 | 除经典 ESP32 外支持 C3 / S2 / S3，各有独立引脚表 |
| 飞机尺寸自适应 | 按机型选门径与阈值，不必手算 RSSI |
| 中文 Web UI | 四页签界面 + 自动校准向导 + 浮窗提示 |
| 语音播报 | 浏览器 TTS，支持播报类型与速率调节 |
| 训练数据上云 | 自建平台对接，含圈速明细与飞手 ID |
| 双通道 OTA | 固件 + LittleFS 均可网页刷写 |

**许可**：MIT，条款与第三方组件清单见根 [README.md 的「许可与版权」](../README.md)。**外壳 3D 模型已随仓库提供**（两半式，含 Bambu Studio 切片工程，见 [3d/README.md](3d/README.md)），自备打印机即可，也可继续用洞洞板裸跑；**硬件原理图仍未提供**，电气连接以 [《操作手册》§2 接线](02-user-manual.md#2-接线) 的引脚表为准。

---

## 2. 工作原理

### 2.1 计时模型：越近越强

ESP32 让 RX5808 固定在与飞机图传相同的频段/频道上，持续读取 RSSI 模拟电压。飞机掠过计时门时，RSSI 出现一个峰：

```
  RSSI
   ↑        ╱╲  ← 峰值 = 飞机最近点（过门瞬间）
   │   ╱╲  ╱  ╲
   │  ╱  ╲╱    ╲      进入阈值 enterRssi ─ ─ ─ ─ ─ ─
   │ ╱╲  ╱        ╲ ╱╲
   │╱  ╲╱          ╳  ╲___  退出（回落）
   └──────────────────────────────────────→ 时间
    圈 1        圈 2        圈 3
```

### 2.2 过圈判定状态机

判定逻辑位于 `lib/laptimer.cpp`（`lapPeakCapture` / `lapPeakCaptured`，约 146–179 行）：

1. 滤波后的 RSSI **爬升越过 `enterRssi`（进入阈值）** → 进入峰值捕获状态；
2. 捕获期间持续记录**最高点及其时刻**；
3. 信号**回落且 `峰值 − 当前 ≥ minDelta`（所需变化量）** → 判定穿越完成，锁定峰值时刻为过门时刻；
4. **圈速 = 本次峰值时刻 − 上次峰值时刻**。取峰值而非取回落点，是精度的关键。

`minDelta` 由计时门直径决定：

| 机型 | 计时门直径 | 所需变化量 minDelta |
|---|---|---|
| 2 寸机 | 1.0 m | ≥ 10 |
| 5 寸机 | 2.0 m | ≥ 6 |

门越大，信号变化越平缓，所需变化量越小（越灵敏）。

**防重复计数闸门**：距上一圈不足最小圈时（`minLap`）不进入峰值捕获，避免"炸机停在门边被反复计数"。

> ⚠️ UI 上的"退出阈值（exitRssi）"滑块会被保存和回显，但**当前固件的过圈判定并不使用它**，真正起作用的是 `minDelta`。这是已知历史遗留（见《开发指南》已知限制 #2）。

### 2.3 信号滤波

RSSI 采样先经过一级**一维卡尔曼滤波**（`lib/kalman.cpp`）压掉 ADC 抖动，再进入上述判定。滤波强度由 `rssi_filter_q` / `rssi_filter_r` 控制（`laptimer.cpp` 顶部）。

### 2.4 "开圈"约定

按下开始后的**第一次过门只用来对齐相位**（作为计时起点），不产生圈速；从第二次过门起才是第 1 圈。数据上传云端时同样会剔除这条。这是设计行为，不是 bug。

---

## 3. 系统架构

### 3.1 硬件组成

```
┌──────────┐   模拟电压(随距离)   ┌──────────┐   软件SPI(改频)  ┌──────────┐
│  RX5808  │─────── RSSI ───────▶│          │── CH1/CH2/CH3 ──▶│  5.8G 频段 │
│ 接收模块  │                     │  ESP32   │                  │  寄存器    │
└──────────┘                     └──────────┘                  └──────────┘
    +5V ←── 故意接 3V3（欠压供电，提高 RSSI 分辨率、降低发热）
可选外设：有源蜂鸣器（过圈/告警反馈）、板载 LED、1/2 分压电池监测（VBAT）
```

关键点：

- 结构件：两半式 3D 打印外壳（33.2 × 65.4 mm，合盖总高 26.5 mm，内腔约 29 × 61 mm）可容纳 ESP32 + RX5808 整机；模型与成型参数在 [3d/README.md](3d/README.md)（线上同步发布于 [Creality Cloud](https://www.crealitycloud.cn/model-detail/6ad9d953328846f6477a79e6)），属可选件。
- RX5808 **必须做 SPI 改造**（短接锡饼 + 引出 CH1/CH2/CH3），否则无法改频。
- RX5808 的 `+5V` 引脚接 ESP32 的 `3V3` 而非 5V——这是本项目正常工作的前提。
- RSSI 必须接在 **ADC1** 引脚上（经典 ESP32 为 GPIO33，仅 GPIO32–39 可用；GPIO25/26 属 ADC2，与 WiFi 共用不可用）。
- 引脚定义唯一来源：`lib/config.h:28` 起的 `#define`；同文件 `:5` 顶部注释是接线表，两者需同步维护。

### 3.2 固件模块划分

```
src/main.cpp ────────── 装配所有模块 + 双核调度
 │
 └── lib/   17 个源文件同级平铺，由 builder.py 接入编译（PIO 默认不编译 lib/ 根）
      ├── config.h/.cpp    ★ 引脚表 + EEPROM 配置结构体 + JSON 序列化
      ├── RX5808.h/.cpp      调频（软件 SPI + 寄存器回读校验）与 RSSI 采样
      ├── kalman.h/.cpp      一维卡尔曼滤波
      ├── laptimer.h/.cpp  ★ 计时状态机、峰值捕获、校准采样
      ├── webserver.h/.cpp ★ WiFi 状态机 + 全部 HTTP 路由 + SSE + 云端上传
      ├── led/buzzer/battery.h/.cpp  非阻塞外设状态机
      └── debug.h            版本宏（FIRMWARE_VERSION / FILESYSTEM_VERSION）与日志
```

### 3.3 运行时模型（三上下文）

| 上下文 | 核 | 负责 |
|---|---|---|
| `loop()` | core 1 | 计时判定 `handleLapTimerUpdate()`、`ElegantOTA.loop()` |
| `parallelTask` | core 0（已关 WDT） | LED、蜂鸣、EEPROM 落盘、切频、电池监测、RSSI 推送、WiFi 状态机、重启请求 |
| AsyncTCP 事件任务 | 库内部 | 所有 HTTP/SSE 路由 handler |

跨上下文共享数据（`rssi[]`、`lapTimes[]`、`conf` 等）**没有锁**，这是设计上的已知取舍，详见《开发指南》。

### 3.4 数据链路

```
RX5808 ──ADC──▶ 卡尔曼滤波 ──▶ 峰值判定状态机 ──▶ 圈速表（固件内）
                     │                                │
                     │ SSE "rssi"（200ms/次）          │ SSE "lap"（过圈即时）
                     ▼                                ▼
              浏览器 data/script.js（Smoothie 曲线 + 圈速表 + TTS 播报）
                     │
                     │ REST（按钮、保存配置）
                     ▼
              ESPAsyncWebServer 路由（lib/webserver.cpp）
                     │
                     │ POST <API地址>/training/device_upload（停止计时时，可选）
                     ▼
                 自建云平台
```

前端库全部内联在 LittleFS 中：jQuery 3.7.1、Smoothie Charts、articulate.js（TTS 封装），无外部 CDN 依赖。

---

## 4. 网络模式

设备有三种网络状态，自动切换：

| 状态 | 触发条件 | 行为 |
|---|---|---|
| **AP 热点**（默认） | 配置里 WiFi 名称为空 | 热点 `QYLPT_XXXX`（`XXXX` = MAC 去冒号后的末 4 位十六进制），密码 `12345678`，IP `33.0.0.1`，DNS 抓取任意域名（captive portal） |
| **STA 联网** | 配置了 WiFi 名/密码 | 连接路由器（仅 2.4 GHz），以路由器分配的 IP 访问 |
| **降级回 AP** | STA 连续 3 次连不上/超时 | 自动切回 AP 模式，蜂鸣 1 s 提示 |

备用访问方式：`http://qylpt.local`（mDNS，需系统支持）。

---

## 5. 技术选型

| 层 | 选型 | 版本 | 用途 |
|---|---|---|---|
| MCU 框架 | Arduino on PlatformIO | espressif32@6.9.0（锁死） | 固件构建 |
| TCP/IP | AsyncTCP | 3.4.10 | 异步网络底座 |
| HTTP | ESPAsyncWebServer | 3.9.4 | Web 服务 + SSE |
| JSON | ArduinoJson | 7.2.0 | 配置序列化、API |
| OTA | ElegantOTA | ^3.1.7 | 固件在线更新（启用 AsyncWebServer 模式） |
| 文件系统 | LittleFS | — | 网页镜像（分区标签写作 `spiffs`，实际类型为 LittleFS） |
| 持久化 | EEPROM(→NVS) | — | 配置结构体整体落盘，预留 256 B |
| 前端 | 原生 JS + jQuery + Smoothie + articulate.js | — | 单页应用 |

> 依赖版本在 `platformio.ini` 中锁死，不要随意升级 espressif32 平台——分区表和 LittleFS 行为会跟着变。

### 分区布局（4 MB flash）

| 分区 | 起始 | 大小 | 用途 |
|---|---|---|---|
| nvs | 0x9000 | 20 KB | EEPROM（配置存储） |
| otadata | 0xe000 | 8 KB | OTA 引导选择 |
| app0 / app1 | 0x10000 / 0x150000 | 各 1.25 MB | 双 OTA 固件槽 |
| spiffs | 0x290000 | 1.5 MB | 网页文件（分区名沿用 `spiffs`，实际类型由 `board_build.filesystem = littlefs` 决定） |

参考值：一次全功能构建约 954 KB / 1.25 MB（73%）。

---

## 6. 训练数据上云（可选）

点「停止」后固件向 `<API地址>/training/device_upload` POST JSON（Content-Type: application/json）。

**前置条件**（任一不满足则跳过上传并蜂鸣 1 s）：

- WiFi 处于已连接的 STA 状态；
- 配置中飞手 ID 非空。

**payload 字段**：

| 字段 | 含义 |
|---|---|
| `device_id` | `QYLPT_` + MAC 末 4 位十六进制（与热点名同源），同场区分计时器 |
| `pilot_id` / `pilot_name` | 来自配置页 |
| `title` / `description` / `record_type` | 固定"训练测试"/"计时器终端数据"/"system" |
| `flight_date` / `takeoff_time` / `updated_at` | 设备 NTP 时间，`YYYY-MM-DD HH:MM:SS` |
| `total_time` / `total_laps` / `average_lap_time` / `best_lap_time` | 汇总值，单位 ms |
| `laps[]` | 每圈 `{ "lap_time": <ms> }`，已剔除开圈那条 |

服务端需返回含 `{"success": true}` 的响应体；成功蜂鸣 200 ms，失败蜂鸣 1 s + 闪灯。

**时间依赖 NTP**（`pool.ntp.org` / `time.nist.gov`，东八区偏移硬编码，同步发生在服务启动时）。海外场地或无外网时时间戳不准甚至回到 1970——此时不要使用上云功能。

---

## 7. 安全边界（必读）

- **固件与网页更新接口没有任何鉴权**：同一局域网内任何设备都能刷写固件/文件系统。
- **`GET /config` 明文回显 WiFi 密码**。
- **串口启动日志也会打印已保存的 WiFi 名称与密码明文**（`lib/webserver.cpp:67` 的 DEBUG 输出）——向他人提交串口日志或 Issue 附件前先脱敏。
- 请只在可信网络使用；**不要把设备暴露到公共 WiFi 或做端口映射**。
- 比赛现场长期开放时，需自行给 ElegantOTA 加 `setAuth()`、给 `/config`、`/update` 等路由加口令校验。

（响应头已内置 CSP、`X-Frame-Options: SAMEORIGIN`、`X-Content-Type-Options: nosniff` 等基础安全头，但不能替代接口鉴权。）

---

## 8. 已知限制总览

按对使用体验的影响排序（详细说明与根因位置见《开发指南》第 7 节）：

| # | 现象 | 影响面 |
|---|---|---|
| 1 | 更新/配置接口无鉴权 | 安全 |
| 2 | `exitRssi` 存了但判定不用 | UI 滑块无效，易误判"校准坏了" |
| 3 | `GET /config` 返回可能被截断（320 B 缓冲） | 长字符串显示不全，像"没保存住" |
| 4 | `POST /config` 缺字段会被清零 | 自写上位机风险（`freq=0` 会产生非法寄存器值） |
| 5 | 停止计时时在请求上下文同步发 HTTP | 上传期间 web/SSE 卡住数秒 |
| 6 | NTP 同步阻塞最长 10 s | 无外网时开机"假死"十秒 |
| 7 | 跨核读写共享状态无同步 | 偶发一圈数据错乱 |
| 8 | 穿越校准接口已废弃但保留 | 前端恒拿 `maxPeak=0`，新向导不依赖 |
| 9 | `WAITING` 状态、`isLapAvailable()` 为死代码；前端仍调用未注册的 `/nodes` | 多节点计时未实现，仅前端预留 |
| 10 | 无自动化测试 | 改计时逻辑需实录回放验证 |

---

## 9. 下一步

- 动手组装与使用 → [《操作手册》](02-user-manual.md)
- 改代码 / 接上位机 / 排查固件问题 → [《开发指南》](03-development-guide.md)
