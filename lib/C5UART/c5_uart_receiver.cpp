#include "c5_uart_receiver.h"

C5UartReceiver::C5UartReceiver(int8_t rxPin, int8_t txPin)
    : rxPin_(rxPin), txPin_(txPin) {}

uint8_t C5UartReceiver::checksum(const uint8_t* bytes, size_t length) {
    uint8_t sum = 0;
    for (size_t i = 0; i < length; ++i) sum = static_cast<uint8_t>(sum + bytes[i]);
    return sum;
}

void C5UartReceiver::init() {
    // Serial remains the USB console; Serial1 is the dedicated C5 link.
    Serial1.begin(BAUD, SERIAL_8N1, rxPin_, txPin_);
    while (Serial1.available()) Serial1.read();
    requestedFrequency_ = 0;
    lastPollMs_ = millis();
    lastFrequencySetMs_ = millis();
    requestPending_ = false;
    haveLevel_ = false;
    level_ = 0;
    responseLength_ = 0;
}

uint8_t C5UartReceiver::readRssi() {
    // The C5 median window is empty for ~255 ms after tune. Return zero while
    // settling instead of allowing the previous channel's cached level to
    // trigger a lap on the new channel.
    if (!haveLevel_ || (millis() - lastFrequencySetMs_) < TUNE_SETTLE_MS) return 0;
    return level_;
}

void C5UartReceiver::sendFrequency(uint16_t frequencyMhz, uint32_t nowMs) {
    // RotorHazard WRITE_FREQUENCY (0x51), big-endian MHz, checksum of payload.
    const uint8_t payload[2] = {
        static_cast<uint8_t>(frequencyMhz >> 8),
        static_cast<uint8_t>(frequencyMhz & 0xff)
    };
    const uint8_t packet[4] = {
        CMD_WRITE_FREQUENCY, payload[0], payload[1], checksum(payload, sizeof(payload))
    };
    Serial1.write(packet, sizeof(packet));
    requestedFrequency_ = frequencyMhz;
    lastFrequencySetMs_ = nowMs;
    haveLevel_ = false;
    level_ = 0;
    requestPending_ = false;
    responseLength_ = 0;
    while (Serial1.available()) Serial1.read();
}

void C5UartReceiver::sendPoll(uint32_t nowMs) {
    Serial1.write(CMD_READ_LAP_PASS_STATS);
    requestStartedMs_ = nowMs;
    requestPending_ = true;
    responseLength_ = 0;
    lastPollMs_ = nowMs;
}

void C5UartReceiver::consumeSerial(uint32_t nowMs) {
    while (Serial1.available()) {
        const uint8_t b = static_cast<uint8_t>(Serial1.read());
        if (!requestPending_) continue;

        // Fixed nine-byte response: lap, pass-age(2), level, node peak,
        // pass peak, loop_us(2), checksum. Slide by one byte on bad checksum
        // so a stray boot banner or byte loss cannot permanently desync us.
        if (responseLength_ < sizeof(response_)) {
            response_[responseLength_++] = b;
        }
        if (responseLength_ == sizeof(response_)) {
            if (checksum(response_, sizeof(response_) - 1) == response_[sizeof(response_) - 1]) {
                const uint8_t rawLevel = response_[3];
                // 0 and 255 are reserved as invalid by RotorHazard; 1 means
                // no valid filtered sample yet. Preserve real values 2..254.
                if (rawLevel >= 2 && rawLevel <= 254) {
                    level_ = rawLevel;
                    haveLevel_ = true;
                } else {
                    haveLevel_ = false;
                    level_ = 0;
                }
                requestPending_ = false;
                responseLength_ = 0;
            } else {
                for (uint8_t i = 1; i < sizeof(response_); ++i) response_[i - 1] = response_[i];
                responseLength_ = sizeof(response_) - 1;
            }
        }
    }

    if (requestPending_ && (nowMs - requestStartedMs_) > RESPONSE_TIMEOUT_MS) {
        requestPending_ = false;
        responseLength_ = 0;
        haveLevel_ = false;
        level_ = 0;
    }
}

void C5UartReceiver::handleFrequencyChange(uint32_t currentTimeMs, uint16_t frequencyMhz) {
    consumeSerial(currentTimeMs);

    if (frequencyMhz != requestedFrequency_) {
        sendFrequency(frequencyMhz, currentTimeMs);
        return;
    }

    if (!requestPending_ && (currentTimeMs - lastPollMs_) >= POLL_INTERVAL_MS) {
        sendPoll(currentTimeMs);
    }
}
