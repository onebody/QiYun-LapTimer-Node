#include "laptimer.h"

#include "debug.h"

const uint16_t rssi_filter_q = 2000; //  0.01 - 655.36
const uint16_t rssi_filter_r = 40;   // 0.0001 - 65.536

void LapTimer::init(Config *config, RX5808 *rx5808, Buzzer *buzzer, Led *l)
{
    conf = config;
    rx = rx5808;
    buz = buzzer;
    led = l;

    filter.setMeasurementNoise(rssi_filter_q * 0.01f);
    filter.setProcessNoise(rssi_filter_r * 0.0001f);

    stop();
    memset(rssi, 0, sizeof(rssi));
    lapEventHandler = nullptr; // 初始化回调函数指针为空
}

void LapTimer::start()
{
    DEBUG("LapTimer started\n");
    rssiPeakTimeMs = millis();
    state = RUNNING;
    lapAvailable = false;
    lapCount = 0;
    rssiCount = 0;
    memset(lapTimes, 0, sizeof(lapTimes));
    startTimeMs = 0;
    lapPeakReset();
    buz->beep(500);
    led->on(500);
}

void LapTimer::stop()
{
    DEBUG("LapTimer stopped\n");
    state = STOPPED;
    lapCount = 0;
    rssiCount = 0;
    memset(lapTimes, 0, sizeof(lapTimes));
    lapAvailable = false;
    startTimeMs = 0;
    lapPeakReset();
    buz->beep(500);
    led->on(500);
}

/**
 * @brief 处理计时系统的核心更新逻辑
 * @param currentTimeMs 当前系统时间（毫秒）
 *
 * 该函数是计时系统的主循环处理函数，负责：
 * 1. 持续读取和滤波RSSI信号
 * 2. 处理噪声校准和穿越校准逻辑
 * 3. 根据当前状态（STOPPED/WAITING/RUNNING）执行不同的计时处理
 * 4. 管理RSSI历史记录
 */
void LapTimer::handleLapTimerUpdate(uint32_t currentTimeMs)
{
    // 始终读取RSSI值，通过卡尔曼滤波器进行滤波处理以减少噪声
    rssi[rssiCount] = round(filter.filter(rx->readRssi(), 0));
    // DEBUG("RSSI: %u\n", rssi[rssiCount]);

    // 噪声校准模式：记录环境噪声的最大RSSI值
    if (isCalibratingNoise)
    {
        // 增加校准样本计数（上限为65535）
        if (calibrationNoiseSamples < 65535)
            calibrationNoiseSamples++;
        // 更新最大噪声RSSI值
        if (rssi[rssiCount] > calibrationMaxNoise)
        {
            calibrationMaxNoise = rssi[rssiCount];
        }
    }

    // 穿越校准模式：记录穿越计时门时的最大RSSI峰值
    if (isCalibratingCrossing)
    {
        // 增加校准样本计数（上限为65535）
        if (calibrationCrossingSamples < 65535)
            calibrationCrossingSamples++;
        // 更新最大穿越RSSI峰值
        if (rssi[rssiCount] > calibrationMaxPeak)
        {
            calibrationMaxPeak = rssi[rssiCount];
        }
    }

    // 根据当前计时状态执行不同的处理逻辑
    switch (state)
    {
    case STOPPED: // 停止状态：不执行任何计时相关操作
        break;
    case WAITING: // 等待状态：检测第一个穿越（开圈）
        
        // 捕获RSSI峰值以检测穿越
        lapPeakCapture(currentTimeMs);
        // 如果检测到有效峰值，开始计时
        if (lapPeakCaptured())
        {
            state = RUNNING;
            startLap();
        }
        // DEBUG("LapTimer WAITING\n");
        break;
    case RUNNING: // 运行状态：持续计时并检测后续穿越
        

        // 无论是否超过最小圈时，都持续捕获RSSI值

        // 仅当超过最小圈时后才更新峰值信息（避免过快连续触发）
        if ((currentTimeMs - startTimeMs) > conf->getMinLapMs())
        {
            lapPeakCapture(currentTimeMs);
        }

        // 检测到有效峰值时，完成当前圈并开始新圈
        if (lapPeakCaptured())
        {
            finishLap();
            startLap();
        }
        // DEBUG("LapTimer RUNNING\n");
        break;
    default: // 默认状态：不执行任何操作
        break;
    }

    // 更新RSSI历史记录索引（循环缓冲区）
    rssiCount = (rssiCount + 1) % LAPTIMER_RSSI_HISTORY;
}

void LapTimer::lapPeakCapture(uint32_t currentTimeMs)
{
    // 恢复严格的enterRssi阈值检查，避免误触发
    if (rssi[rssiCount] >= conf->getEnterRssi())
    {
        // Check if RSSI is greater than the previous detected peak
        if (rssi[rssiCount] > rssiPeak)
        {
            rssiPeak = rssi[rssiCount];
            rssiPeakTimeMs = currentTimeMs;
        }
    }
}

bool LapTimer::lapPeakCaptured()
{
    // 获取计时门直径（毫米）
    uint16_t gateDiameterMm = conf->getGateDiameterMm();

    uint8_t minDelta;
    bool rssiConditions;

    // 全有圈严格的参数要求
    minDelta = (gateDiameterMm == 1000) ? 10 : 6;
    // 严格检查RSSI下降和变化量
    rssiConditions = (rssi[rssiCount] < rssiPeak);
    bool deltaCondition = (rssiPeak - rssi[rssiCount]) >= minDelta;

    // 增加调试输出以帮助分析
    // DEBUG("lapPeakCaptured: state=%d, rssiCount=%d, rssi=%d, rssiPeak=%d, exitRssi=%d, minDelta=%d, rssiConditions=%d, deltaCondition=%d\n",
    //       state, rssiCount, rssi[rssiCount], rssiPeak, conf->getExitRssi(), minDelta, rssiConditions, deltaCondition);

    return rssiConditions && deltaCondition;
}

void LapTimer::lapPeakReset()
{
    rssiPeak = 0;
    rssiPeakTimeMs = 0;
}

void LapTimer::startLap()
{
    DEBUG("Lap started\n");
    startTimeMs = rssiPeakTimeMs;
    lapPeakReset();
    buz->beep(200);
    led->on(200);
}

void LapTimer::finishLap()
{
    lapTimes[lapCount] = rssiPeakTimeMs - startTimeMs;
    DEBUG("Lap finished, lap time = %u\n", lapTimes[lapCount]);
    lapCount = (lapCount + 1) % LAPTIMER_LAP_HISTORY;
    lapAvailable = true;

    // 立即触发lap事件回调，不再等待定期检查
    if (lapEventHandler != nullptr)
    {
        lapEventHandler(lapTimes[lapCount > 0 ? lapCount - 1 : LAPTIMER_LAP_HISTORY - 1]);
    }
}

uint8_t LapTimer::getRssi()
{
    return rssi[rssiCount];
}

uint32_t LapTimer::getLapTime()
{
    uint32_t lapTime = 0;
    lapAvailable = false;
    if (lapCount == 0)
    {
        lapTime = lapTimes[LAPTIMER_LAP_HISTORY - 1];
    }
    else
    {
        lapTime = lapTimes[lapCount - 1];
    }
    return lapTime;
}

bool LapTimer::isLapAvailable()
{
    return lapAvailable;
}

void LapTimer::startCalibrationNoise()
{
    isCalibratingNoise = true;
    calibrationMaxNoise = 0;
    calibrationNoiseSamples = 0;
    buz->beep(200);
}

uint8_t LapTimer::stopCalibrationNoise()
{
    isCalibratingNoise = false;
    buz->beep(200);
    return calibrationMaxNoise;
}

void LapTimer::startCalibrationCrossing()
{
    isCalibratingCrossing = true;
    calibrationMaxPeak = 0;
    calibrationCrossingSamples = 0;
    buz->beep(200);
}

uint8_t LapTimer::stopCalibrationCrossing()
{
    isCalibratingCrossing = false;
    buz->beep(200);
    return calibrationMaxPeak;
}

uint8_t LapTimer::getCalibrationMaxNoise()
{
    return calibrationMaxNoise;
}

uint8_t LapTimer::getCalibrationMaxPeak()
{
    return calibrationMaxPeak;
}

uint16_t LapTimer::getCalibrationNoiseSamples()
{
    return calibrationNoiseSamples;
}

uint16_t LapTimer::getCalibrationCrossingSamples()
{
    return calibrationCrossingSamples;
}

void LapTimer::setLapEventHandler(void (*handler)(uint32_t lapTime))
{
    lapEventHandler = handler;
}