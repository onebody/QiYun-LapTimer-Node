#include "debug.h"
#include "led.h"
#include "webserver.h"
#include <ElegantOTA.h>

#if defined(QIYUN_C5_UART_RSSI)
#include "c5_uart_receiver.h"
static C5UartReceiver rx(PIN_C5_UART_RX, PIN_C5_UART_TX);
#else
#include "RX5808.h"
static RX5808 rx(PIN_RX5808_RSSI, PIN_RX5808_DATA, PIN_RX5808_SELECT, PIN_RX5808_CLOCK);
#endif

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
        // Keep the task schedulable even if the web server is idle.
        vTaskDelay(1);
    }
}

static void initParallelTask() {
    // Disable the watchdog for compatibility with the original busy-loop task.
    // The task now yields once per millisecond rather than starving the system.
    #if defined(ESP32)
        disableCore0WDT();
    #elif defined(ESP32C3) || defined(ESP32S3)
        esp_task_wdt_delete(NULL);
    #endif
    xTaskCreatePinnedToCore(parallelTask, "parallelTask", 4096, NULL, 1, &xTimerTask, 0);
}

void setup() {
    DEBUG_INIT;
    config.init();
    rx.init();
    buzzer.init(PIN_BUZZER, BUZZER_INVERTED);
    #if defined(ESP32C3) || defined(ESP32S2) || defined(ESP32S3) || defined(ESP32)
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
