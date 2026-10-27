# QiYun + ESP32-C5 UART 数字 RSSI 适配

本分支在骑云原项目上新增一个接收器接口和一个 C5 UART 适配器。计时状态机、卡尔曼滤波、校准、圈速记录、Web UI、SSE、OTA 与训练数据上报仍由骑云主控运行；ESP32-C5 负责射频捕获并按 Widscan58 的 RotorHazard 串口节点协议提供数字 RSSI。

## 构建环境

| PlatformIO 环境 | 主控板 | C5 UART RX / TX（主控视角） |
|---|---|---|
| `esp32-s3-zero-c5uart` | Waveshare ESP32-S3-Zero / Zero-M，4 MB Flash | GPIO17 / GPIO18 |
| `esp32-s3-devkitc-1-c5uart` | ESP32-S3 DevKitC-1 | GPIO17 / GPIO18 |
| `esp32-c3-devkitm-1-c5uart` | ESP32-C3 DevKitM-1 | GPIO6 / GPIO7 |

原有 `esp32dev`、`esp32-c3-devkitm-1`、`esp32-s3-devkitc-1` 和 `esp32doit-devkit-v1` 环境仍保留 RX5808 模拟 RSSI 后端，不被本分支默认改写。三个新环境统一使用 C5 数字 RSSI 后端。

## 接线

| ESP32-C5 | QiYun 主控（S3-Zero） | 说明 |
|---|---|---|
| GPIO11 / TX | GPIO17 / RX | UART 数据交叉 |
| GPIO12 / RX | GPIO18 / TX | UART 数据交叉 |
| GND | GND | 必须共地 |
| 供电 | 两块板分别 USB 供电进行首测 | 不要把两个 3V3 输出直接并联 |

- 串口：115200 baud、8 data bits、无校验、1 stop bit（8N1），3.3 V TTL。
- 不要将 5 V UART 接到任一 GPIO。
- C5 端按 Widscan58 文档使用 UART0 GPIO11/12；主控端用独立的 Serial1 GPIO17/18，不占用 S3-Zero 的 USB 原生串口日志（UART0 GPIO43/44）。
- C3 主控构建环境使用 GPIO6（RX）和 GPIO7（TX），同样与 C5 GPIO11/12 交叉连接。

## 协议与 RSSI 语义

此适配器不使用未经验证的 `SETFREQ\n` / `RSSI ...\n` 文本协议，而是使用 Widscan58 当前实现的 RotorHazard 串口节点协议：

- `WRITE_FREQUENCY = 0x51`：写入大端 MHz 频率，随后附加数据字节和校验和。
- `READ_LAP_PASS_STATS = 0x0D`：读取固定 9 字节响应；第 4 个字节（偏移 3）是 RSSI level，最后一个字节是前面所有响应字节之和模 256。
- 只接受校验正确的完整响应；响应超时或无效 level 时不沿用旧 RSSI。
- C5 调频后等待 300 ms 再向计时算法提供有效值。Widscan58 的中值窗口在频率切换后需要填充时间。
- C5 的 level 是数字接收链路的相对代码（1–254），并非 RX5808 ADC 的原始电压计数，也不是直接的 dBm。必须在骑云网页上重新执行底噪与过门校准，重新设定 enter 阈值；不要沿用原 RX5808 阈值。

参考实现与协议说明：
- https://github.com/onebody/widscan58/blob/main/docs/RotorHazard.md
- https://github.com/onebody/widscan58/blob/main/firmware/src/proto/rh.c
- https://github.com/onebody/widscan58/blob/main/firmware/src/proto/uart_link.c

## macOS / Linux 构建

在项目根目录：

```sh
python -m pip install --upgrade platformio
pio run -e esp32-s3-zero-c5uart
pio run -e esp32-s3-devkitc-1-c5uart
pio run -e esp32-c3-devkitm-1-c5uart
```

首轮烧录固件与网页文件系统（端口按实际设备替换）：

```sh
pio run -e esp32-s3-zero-c5uart -t upload --upload-port /dev/cu.usbmodemXXXX
pio run -e esp32-s3-zero-c5uart -t uploadfs --upload-port /dev/cu.usbmodemXXXX
pio device monitor -e esp32-s3-zero-c5uart --port /dev/cu.usbmodemXXXX --baud 115200
```

S3-Zero 使用原生 USB，不带 USB 转串口芯片。如果无法进入下载模式，按住 BOOT 再连接 USB，必要时按一下 RESET。首次烧录务必同时上传固件和 LittleFS 页面，否则 Web UI 可能空白。

## 硬件验收步骤

1. **单独验证 C5**：刷入 Widscan58 的 C5 固件，确认浏览器能切换到 Lap timer / RotorHazard 模式；将 C5 的 GPIO11/12、GND 接到主控 UART。
2. **主控启动**：烧录 `esp32-s3-zero-c5uart` 的固件和 LittleFS。打开 USB 日志，检查是否复位、堆栈溢出或看门狗异常。
3. **频率命令**：在骑云配置页选择实际 VTX 频率（例如 Raceband R5 = 5806 MHz）。C5 应开始扫描该频率；切换频率后至少等待 300 ms。
4. **RSSI 变化**：关闭 VTX 记录底噪，打开 VTX 并靠近接收端，确认 RSSI 变化明显且没有冻结。若没有数据，先检查 TX/RX 是否交叉、GND、115200 8N1、C5 是否进入 RotorHazard 模式。
5. **校准**：必须重新执行噪声与过门校准；确认过门峰值超过底噪，且阈值适合现场距离和 VTX 功率。
6. **圈速验证**：低速手持 VTX 模拟过门，至少验证 20 次过门；检查漏判、重复判圈、最小圈时过滤和网页圈速显示。
7. **回归测试**：验证开始/停止、蜂鸣器、配置持久化、SSE 页面更新、OTA 固件与文件系统更新、训练数据上报。
8. **失联测试**：断开 C5 TX 或关闭 C5，主控不应持续使用最后一次 RSSI 制造新圈速；恢复连接后重新确认频率与校准状态。

## 当前限制 / 验收门槛

- 这个分支目前是代码改造候选；GitHub Connector 不能替代本地 PlatformIO 构建和真实硬件测试。必须在目标环境完成上面的构建与实测后，才能称为“已验证可编译/可比赛”。
- C5 返回的 RSSI 数值分布与 RX5808 不同，Web 校准阈值不可照搬。
- S3-Zero 的板载 RGB 是 GPIO21 上的 WS2812，而原骑云 LED 模块按普通 GPIO 控制；因此这版不会保证板载 RGB 指示灯效果一致。外接蜂鸣器仍按 GPIO3 连接；电池电压监测只有在 GPIO1 外接正确分压电路时才有意义。
- 原项目的 Wi-Fi / OTA 安全边界保持不变；仅在可信网络中使用，不要将未鉴权 OTA 暴露到公网。
