# 飞机大小调整计时门直径功能修改总结

## 修改内容

### 1. 配置系统修改
- **config.h**: 
  - 更新配置版本从1U到2U
  - 添加飞机大小宏定义：`DRONE_SIZE_SMALL`(0)和`DRONE_SIZE_LARGE`(1)
  - 在`laptimer_config_t`结构体中添加`droneSize`字段
  - 添加`getDroneSize()`和`getGateDiameter()`方法声明

- **config.cpp**:
  - 实现`getDroneSize()`和`getGateDiameter()`方法
  - 更新JSON序列化方法，添加`droneSize`和`gateDiameter`字段
  - 更新JSON反序列化方法，支持`droneSize`配置
  - 设置默认飞机大小为小飞机
  - 增加JSON文档缓冲区大小以容纳新字段

### 2. 前端界面修改
- **index.html**:
  - 在配置界面添加飞机大小选择下拉框
  - 在校准向导的每个步骤中添加当前飞机大小显示

- **script.js**:
  - 添加`droneSizeSelect`变量声明
  - 修改`stopCalibCrossing()`函数，根据飞机大小动态调整阈值计算比例
  - 添加`updateCalibDroneSizeInfo()`函数，更新校准步骤中的飞机大小信息
  - 修改`saveConfig()`函数，保存飞机大小配置
  - 修改配置初始化代码，加载飞机大小设置

### 3. 后端逻辑修改
- **webserver.cpp**:
  - 修改`/calibration/crossing/stop`接口，返回飞机大小和计时门直径信息

## 功能特性

### 飞机大小与计时门直径对应关系
- **小飞机 (DRONE_SIZE_SMALL = 0)**: 计时门直径2米
- **大飞机 (DRONE_SIZE_LARGE = 1)**: 计时门直径4米

### 底噪阈值调整逻辑
- **小飞机 (2米计时门)**: 监测区域较小，使用更敏感的阈值
  - 进入阈值：底噪 + (峰值-底噪) × 0.60
  - 退出阈值：底噪 + (峰值-底噪) × 0.30

- **大飞机 (4米计时门)**: 监测区域较大，使用更宽松的阈值
  - 进入阈值：底噪 + (峰值-底噪) × 0.50
  - 退出阈值：底噪 + (峰值-底噪) × 0.20

## 编译状态
✅ 编译成功，无错误
- RAM使用: 14.8% (48632 bytes)
- Flash使用: 72.8% (953973 bytes)

## 下一步操作
1. 将修改后的固件烧录到ESP32设备
2. 测试飞机大小选择功能
3. 验证校准逻辑根据飞机大小正确调整阈值
4. 确认配置保存和加载功能正常