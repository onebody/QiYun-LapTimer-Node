#pragma once
#include <Arduino.h>

/*
 * Common receiver interface used by LapTimer. RX5808 is the legacy analog
 * implementation; C5UartReceiver consumes the Widscan58 RotorHazard UART
 * node protocol. RSSI is a calibrated 0..255 level, not a physical dBm value.
 */
class RssiReceiver {
public:
    virtual ~RssiReceiver() {}
    virtual void init() = 0;
    virtual uint8_t readRssi() = 0;
    // Serial adapters gate the timer on a new protocol sample, not cached data.
    virtual bool consumeFreshSample() { return true; }
    virtual void handleFrequencyChange(uint32_t currentTimeMs, uint16_t frequencyMhz) = 0;
};
