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
            // Check if timer min has elapsed, start capturing peak
            if ((currentTimeMs - startTimeMs) > conf->getMinLapMs()) {
                lapPeakCapture(currentTimeMs);
            }

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
    // Check if RSSI is on or post threshold, update RSSI peak
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
    
    // 基于计时门直径计算最小RSSI变化量（降低要求以提高检测灵敏度）
    // 直径越小，需要的RSSI变化量越大，以确保信号来自门内
    uint8_t minDelta = (gateDiameterMm == 1500) ? 25 : 15;
    
    // 检查当前RSSI是否低于峰值和退出阈值，并且RSSI变化量足够大
    // 只有当RSSI变化量足够大时，才认为是有效的过门信号
    bool rssiConditions = (rssi[rssiCount] < rssiPeak) && (rssi[rssiCount] < conf->getExitRssi());
    bool deltaCondition = (rssiPeak - conf->getExitRssi()) >= minDelta;
    
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