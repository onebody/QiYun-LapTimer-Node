#include "laptimer.h"

#include "debug.h"

const uint16_t rssi_filter_q = 2000;  //  0.01 - 655.36
const uint16_t rssi_filter_r = 40;    // 0.0001 - 65.536

void LapTimer::init(Config *config, RX5808 *rx5808, Buzzer *buzzer, Led *l) {
    conf = config;
    rx = rx5808;
    buz = buzzer;
    led = l;

    filter.setMeasurementNoise(rssi_filter_q * 0.01f);
    filter.setProcessNoise(rssi_filter_r * 0.0001f);

    stop();
    memset(rssi, 0, sizeof(rssi));
    lapEventHandler = nullptr;  // 初始化回调函数指针为空
}

void LapTimer::start() {
    DEBUG("LapTimer started\n");
    state = WAITING;
    lapAvailable = false;
    lapCount = 0;
    rssiCount = 0;
    memset(lapTimes, 0, sizeof(lapTimes));
    startTimeMs = 0;
    lapPeakReset();
    buz->beep(500);
    led->on(500);
}

void LapTimer::stop() {
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

void LapTimer::handleLapTimerUpdate(uint32_t currentTimeMs) {
    // always read RSSI
    rssi[rssiCount] = round(filter.filter(rx->readRssi(), 0));
    // DEBUG("RSSI: %u\n", rssi[rssiCount]);

    if (isCalibratingNoise) {
        if (calibrationNoiseSamples < 65535) calibrationNoiseSamples++;
        if (rssi[rssiCount] > calibrationMaxNoise) {
            calibrationMaxNoise = rssi[rssiCount];
        }
    }

    if (isCalibratingCrossing) {
        if (calibrationCrossingSamples < 65535) calibrationCrossingSamples++;
        if (rssi[rssiCount] > calibrationMaxPeak) {
            calibrationMaxPeak = rssi[rssiCount];
        }
    }

    switch (state) {
        case STOPPED:
            break;
        case WAITING:
            // detect hole shot
            lapPeakCapture(currentTimeMs);
            if (lapPeakCaptured()) {
                state = RUNNING;
                startLap();
            }
            break;
        case RUNNING:
            // 无论是否超过最小圈时，都持续捕获RSSI值
            lapPeakCapture(currentTimeMs);
            
            // 去除最小圈时限制，只要捕获到峰值就触发圈速计算
            if (lapPeakCaptured()) {
                finishLap();
                startLap();
            }
            break;
        default:
            break;
    }

    rssiCount = (rssiCount + 1) % LAPTIMER_RSSI_HISTORY;
}

void LapTimer::lapPeakCapture(uint32_t currentTimeMs) {
    // 恢复严格的enterRssi阈值检查，避免误触发
    if (rssi[rssiCount] >= conf->getEnterRssi()) {
        // Check if RSSI is greater than the previous detected peak
        if (rssi[rssiCount] > rssiPeak) {
            rssiPeak = rssi[rssiCount];
            rssiPeakTimeMs = currentTimeMs;
        }
    }
}

bool LapTimer::lapPeakCaptured() {
    // 获取计时门直径（毫米）
    uint16_t gateDiameterMm = conf->getGateDiameterMm();
    
    uint8_t minDelta;
    bool rssiConditions;
    
    // 针对WAITING状态（第一次开圈）使用更灵敏的检测参数，减少延迟
    // 针对RUNNING状态（后续圈速）保持严格的检测参数，避免误触发
    if (state == WAITING) {
        // 第一次开圈使用较低阈值，提高响应速度
        minDelta = 4;
        // 只要RSSI开始下降且有小变化，就触发第一次开圈
        rssiConditions = (rssi[rssiCount] < rssiPeak);
    } else {
        // 后续圈速恢复严格的参数要求
        minDelta = (gateDiameterMm == 1500) ? 10 : 6;
        // 严格检查RSSI下降和变化量
        rssiConditions = (rssi[rssiCount] < rssiPeak);
    }
    
    bool deltaCondition = (rssiPeak - rssi[rssiCount]) >= minDelta;
    
    // 增加调试输出以帮助分析
    DEBUG("lapPeakCaptured: state=%d, rssiCount=%d, rssi=%d, rssiPeak=%d, exitRssi=%d, minDelta=%d, rssiConditions=%d, deltaCondition=%d\n", 
          state, rssiCount, rssi[rssiCount], rssiPeak, conf->getExitRssi(), minDelta, rssiConditions, deltaCondition);
    
    return rssiConditions && deltaCondition;
}

void LapTimer::lapPeakReset() {
    rssiPeak = 0;
    rssiPeakTimeMs = 0;
}

void LapTimer::startLap() {
    DEBUG("Lap started\n");
    startTimeMs = rssiPeakTimeMs;
    lapPeakReset();
    buz->beep(200);
    led->on(200);
}

void LapTimer::finishLap() {
    lapTimes[lapCount] = rssiPeakTimeMs - startTimeMs;
    DEBUG("Lap finished, lap time = %u\n", lapTimes[lapCount]);
    lapCount = (lapCount + 1) % LAPTIMER_LAP_HISTORY;
    lapAvailable = true;
    
    // 立即触发lap事件回调，不再等待定期检查
    if (lapEventHandler != nullptr) {
        lapEventHandler(lapTimes[lapCount > 0 ? lapCount - 1 : LAPTIMER_LAP_HISTORY - 1]);
    }
}

uint8_t LapTimer::getRssi() {
    return rssi[rssiCount];
}

uint32_t LapTimer::getLapTime() {
    uint32_t lapTime = 0;
    lapAvailable = false;
    if (lapCount == 0) {
        lapTime = lapTimes[LAPTIMER_LAP_HISTORY - 1];
    } else {
        lapTime = lapTimes[lapCount - 1];
    }
    return lapTime;
}

bool LapTimer::isLapAvailable() {
    return lapAvailable;
}

void LapTimer::startCalibrationNoise() {
    isCalibratingNoise = true;
    calibrationMaxNoise = 0;
    calibrationNoiseSamples = 0;
    buz->beep(200);
}

uint8_t LapTimer::stopCalibrationNoise() {
    isCalibratingNoise = false;
    buz->beep(200);
    return calibrationMaxNoise;
}

void LapTimer::startCalibrationCrossing() {
    isCalibratingCrossing = true;
    calibrationMaxPeak = 0;
    calibrationCrossingSamples = 0;
    buz->beep(200);
}

uint8_t LapTimer::stopCalibrationCrossing() {
    isCalibratingCrossing = false;
    buz->beep(200);
    return calibrationMaxPeak;
}

uint8_t LapTimer::getCalibrationMaxNoise() {
    return calibrationMaxNoise;
}

uint8_t LapTimer::getCalibrationMaxPeak() {
    return calibrationMaxPeak;
}

uint16_t LapTimer::getCalibrationNoiseSamples() {
    return calibrationNoiseSamples;
}

uint16_t LapTimer::getCalibrationCrossingSamples() {
    return calibrationCrossingSamples;
}

void LapTimer::setLapEventHandler(void (*handler)(uint32_t lapTime)) {
    lapEventHandler = handler;
}