#include <WiFi.h>
#include <ESPAsyncWebServer.h>

#include "battery.h"
#include "laptimer.h"

#define WIFI_CONNECTION_TIMEOUT_MS 30000
#define WIFI_RECONNECT_TIMEOUT_MS 500
#define WEB_RSSI_SEND_TIMEOUT_MS 200
#define RESTART_DELAY_MS 1000

class Webserver {
   public:
    void init(Config *config, LapTimer *lapTimer, BatteryMonitor *batMonitor, Buzzer *buzzer, Led *l);
    void handleWebUpdate(uint32_t currentTimeMs);

   private:
    void startServices();
    void sendRssiEvent(uint8_t rssi);
    void sendLaptimeEvent(uint32_t lapTime);
    // 新增：lap事件处理函数
    static void lapEventHandler(uint32_t lapTime);
    // 新增：stop事件处理函数
    static void stopEventHandler();
    // 新增：上传训练数据到平台
    void uploadTrainingData();

    Config *conf;
    LapTimer *timer;
    BatteryMonitor *monitor;
    Buzzer *buz;
    Led *led;

    wifi_mode_t wifiMode = WIFI_OFF;
    wl_status_t lastStatus = WL_IDLE_STATUS;
    volatile wifi_mode_t changeMode = WIFI_OFF;
    volatile uint32_t changeTimeMs = 0;
    volatile bool restartRequested = false;
    volatile uint32_t restartRequestTimeMs = 0;
    bool servicesStarted = false;
    bool wifiConnected = false;

    bool sendRssi = false;
    uint32_t rssiSentMs = 0;
    uint32_t nodesRefreshMs = 0;
    uint8_t connectionAttempts = 0;
};