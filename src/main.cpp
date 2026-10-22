#include "debug.h"
#include "led.h"
#include "webserver.h"
#include <ElegantOTA.h>

static RX5808 rx(PIN_RX5808_RSSI, PIN_RX5808_DATA, PIN_RX5808_SELECT, PIN_RX5808_CLOCK);
static Config config;
static Webserver ws;
static Buzzer buzzer;
static Led led;
static LapTimer timer;
static BatteryMonitor monitor;

static TaskHandle_t xTimerTask = NULL;

static void parallelTask(void *pvArgs) {
    for (;;) {
        uint32_t currentTimeMs = millis();
        buzzer.handleBuzzer(currentTimeMs);
        led.handleLed(currentTimeMs);
        ws.handleWebUpdate(currentTimeMs);
        config.handleEeprom(currentTimeMs);
        rx.handleFrequencyChange(currentTimeMs, config.getFrequency());
        monitor.checkBatteryState(currentTimeMs, config.getAlarmThreshold());
        buzzer.handleBuzzer(currentTimeMs);
        led.handleLed(currentTimeMs);
    }
}

static void initParallelTask() {
    // 禁用看门狗，兼容不同的ESP32变体
    #if defined(ESP32)
        // 对于ESP32-WROOM/WROVER
        disableCore0WDT();
    #elif defined(ESP32C3) || defined(ESP32S3)
        // 对于ESP32-C3和ESP32-S3
        esp_task_wdt_delete(NULL);
    #endif
    xTaskCreatePinnedToCore(parallelTask, "parallelTask", 3000, NULL, 0, &xTimerTask, 0);
}

void setup() {
    DEBUG_INIT;
    config.init();
    rx.init();
    buzzer.init(PIN_BUZZER, BUZZER_INVERTED);
    // 根据不同芯片型号设置板载LED的极性
    #if defined(ESP32C3) || defined(ESP32S2) || defined(ESP32S3) || defined(ESP32)
        // ESP32系列板载LED通常是低电平点亮（inverted=true）
        led.init(PIN_LED, true);
    #else
        led.init(PIN_LED, false);
    #endif
    timer.init(&config, &rx, &buzzer, &led);
    monitor.init(PIN_VBAT, VBAT_SCALE, VBAT_ADD, &buzzer, &led);
    ws.init(&config, &timer, &monitor, &buzzer, &led);
    led.on(400);
    buzzer.beep(200);
    initParallelTask();
}

void loop() {
    uint32_t currentTimeMs = millis();
    timer.handleLapTimerUpdate(currentTimeMs);
    ElegantOTA.loop();
}