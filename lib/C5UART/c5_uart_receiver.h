#pragma once
#include <Arduino.h>
#include "../RSSI/rssi_receiver.h"

/*
 * Host adapter for Widscan58's RotorHazard serial-node protocol (API level 36).
 * The C5 remains responsible for RF capture/RSSI measurement; the QiYun host
 * selects seat 0, sets its frequency and polls READ_LAP_PASS_STATS.
 *
 * Wire: 115200 baud, 8N1, 3.3 V TTL, crossed TX/RX and common GND.
 */
class C5UartReceiver : public RssiReceiver {
public:
    C5UartReceiver(int8_t rxPin, int8_t txPin);
    void init() override;
    uint8_t readRssi() override;
    bool consumeFreshSample() override;
    void handleFrequencyChange(uint32_t currentTimeMs, uint16_t frequencyMhz) override;

private:
    static constexpr uint32_t BAUD = 115200;
    static constexpr uint8_t CMD_READ_LAP_PASS_STATS = 0x0D;
    static constexpr uint8_t CMD_WRITE_FREQUENCY = 0x51;
    static constexpr uint32_t POLL_INTERVAL_MS = 2;
    static constexpr uint32_t RESPONSE_TIMEOUT_MS = 20;
    static constexpr uint32_t TUNE_SETTLE_MS = 300;

    int8_t rxPin_;
    int8_t txPin_;
    uint16_t requestedFrequency_ = 0;
    uint32_t lastPollMs_ = 0;
    volatile uint32_t lastFrequencySetMs_ = 0;
    uint32_t requestStartedMs_ = 0;
    bool requestPending_ = false;
    volatile bool haveLevel_ = false;
    volatile bool freshSample_ = false;
    volatile uint8_t level_ = 0;
    uint8_t response_[9] = {};
    uint8_t responseLength_ = 0;

    void sendFrequency(uint16_t frequencyMhz, uint32_t nowMs);
    void sendPoll(uint32_t nowMs);
    void consumeSerial(uint32_t nowMs);
    static uint8_t checksum(const uint8_t* bytes, size_t length);
};
