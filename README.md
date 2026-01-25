
## 开发指南

### 编译和上传

#### 编译固件
```bash
pio run -e esp32dev
```

#### 上传固件
```bash
pio run -e esp32dev -t upload --upload-port /dev/cu.SLAB_USBtoUART
```

#### 编译文件系统
```bash
pio run -e esp32dev -t buildfs
```

#### 上传文件系统
```bash
pio run -e esp32dev -t uploadfs --upload-port /dev/cu.SLAB_USBtoUART
```

### 版本管理

- 固件版本定义在 `lib/DEBUG/debug.h` 文件中的 `FIRMWARE_VERSION` 宏
- 文件系统版本定义在 `lib/DEBUG/debug.h` 文件中的 `FILESYSTEM_VERSION` 宏
- 更新版本后需重新编译和上传

## 故障排除

### WiFi连接问题
- 确保WiFi密码正确
- 检查WiFi信号强度
- 如果无法连接，尝试重置设备（长按重置按钮5秒）

### 计时不准确
- 重新进行噪声校准
- 调整阈值参数

### Web界面无法访问
- 确认设备IP地址正确
- 检查WiFi连接状态
- 尝试清除浏览器缓存

### OTA更新失败
- 确保文件格式正确（.bin文件）
- 检查文件大小是否超过设备存储空间
- 确保网络连接稳定

## 版本历史

### v1.0.4 (2025-01-24)
- 修复OTA文件系统更新路径错误
- 添加文件系统版本显示
- 优化Web界面响应速度
- 改进WiFi连接稳定性

### v1.0.3 (2025-01-23)
- 添加电池电压监测功能
- 优化RSSI数据滤波算法
- 改进校准流程

### v1.0.2 (2025-01-22)
- 修复Web界面显示问题
- 优化计时精度
- 添加蜂鸣器提示功能

### v1.0.1 (2025-01-21)
- 改进WiFi配置界面
- 修复OTA更新bug

### v1.0.0 (2025-01-20)
- 初始版本发布
- 基本计时功能
- Web界面控制
- OTA更新支持

## 许可证

本项目采用GPL-3.0许可证，详情请查看[LICENSE](LICENSE)文件。

## 贡献

欢迎提交Issue和Pull Request来改进项目！

## 联系方式

如果您有任何问题或建议，欢迎通过以下方式联系我们：
- GitHub Issues: https://github.com/yourusername/QiYun-LapTimer-Node/issues

---