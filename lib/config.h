#include <ArduinoJson.h>
#include <AsyncJson.h>
#include <stdint.h>

/*
## 接线表（与本文件下方 #define 保持一致，改动请同时更新两处）##

RX5808 的 +5V 引脚故意接 ESP32 的 3V3（欠压供电，提高 RSSI 分辨率）。
RSSI 必须落在 ADC1 上；LED 为各芯片板载 LED。

| 信号 | ESP32 | ESP32-C3 | ESP32-S2 | ESP32-S3 |
| --- | :-: | :-: | :-: | :-: |
| RSSI | 33 | 3 | 3 | 13 |
| CH1 (DATA) | 19 | 6 | 6 | 11 |
| CH2 (SEL) | 22 | 7 | 7 | 10 |
| CH3 (CLK) | 23 | 4 | 4 | 12 |
| +5V → 3V3 | 3V3 | 3V3 | 3V3 | 3V3 |
| GND | GND | GND | GND | GND |
| 蜂鸣器 (+) | 27 | 5 | 5 | 3 |
| LED | 2 | 8 | 13 | 48 |
| VBAT 分压中点 | 35 | 0 | 4 | 1 |

注：ESP32-S2 有引脚表但 platformio.ini 中无对应构建环境，需自行添加 [env:...]。
完整文档见 docs/ 目录。
*/

//ESP32-C3
#if defined(ESP32C3)

#define PIN_LED 8    // 使用ESP32-C3板载LED（GPIO8）
#define PIN_VBAT 0
#define VBAT_SCALE 2
#define VBAT_ADD 2
#define PIN_RX5808_RSSI 3
#define PIN_RX5808_DATA 6     //CH1
#define PIN_RX5808_SELECT 7   //CH2
#define PIN_RX5808_CLOCK 4    //CH3
#define PIN_BUZZER 5
#define BUZZER_INVERTED false

//ESP32-S2
#elif defined(ESP32S2)

#define PIN_LED 13   // 使用ESP32-S2板载LED（GPIO13）
#define PIN_VBAT 4
#define VBAT_SCALE 2
#define VBAT_ADD 2
#define PIN_RX5808_RSSI 3
#define PIN_RX5808_DATA 6     //CH1
#define PIN_RX5808_SELECT 7   //CH2
#define PIN_RX5808_CLOCK 4    //CH3
#define PIN_BUZZER 5
#define BUZZER_INVERTED false

//ESP32-S3
#elif defined(ESP32S3)

#define PIN_LED 48   // 使用ESP32-S3板载LED（GPIO48）
#define PIN_VBAT 1
#define VBAT_SCALE 2
#define VBAT_ADD 2
#define PIN_RX5808_RSSI 13
#define PIN_RX5808_DATA 11     //CH1
#define PIN_RX5808_SELECT 10   //CH2
#define PIN_RX5808_CLOCK 12    //CH3
#define PIN_BUZZER 3
#define BUZZER_INVERTED false

//ESP32 (WROOM/WROVER/DOIT等)
#else

#define PIN_LED 2    // 使用ESP32-WROOM/WROVER板载LED（GPIO2）
#define PIN_VBAT 35
#define VBAT_SCALE 2
#define VBAT_ADD 2
#define PIN_RX5808_RSSI 33
#define PIN_RX5808_DATA 19   //CH1
#define PIN_RX5808_SELECT 22 //CH2
#define PIN_RX5808_CLOCK 23  //CH3
#define PIN_BUZZER 27
#define BUZZER_INVERTED false

#endif

#define EEPROM_RESERVED_SIZE 256
#define CONFIG_MAGIC_MASK (0b11U << 30)
#define CONFIG_MAGIC (0b01U << 30)
#define CONFIG_VERSION 4U

#define EEPROM_CHECK_TIME_MS 1000

typedef struct {
    uint32_t version;
    uint16_t frequency;
    uint8_t minLap;
    uint8_t alarm;
    uint8_t announcerType;
    uint8_t announcerRate;
    uint8_t enterRssi;
    uint8_t exitRssi;
    uint8_t droneSize;
    uint16_t calibSamples;
    char pilotName[21];
    char pilotId[21];
    char ssid[33];
    char password[33];
    char apiAddress[100];
} laptimer_config_t;

class Config {
   public:
    void init();
    void load();
    void write();
    void toJson(AsyncResponseStream& destination);
    void toJsonString(char* buf);
    void fromJson(JsonObject source);
    void handleEeprom(uint32_t currentTimeMs);

    // getters and setters
    uint16_t getFrequency();
    uint32_t getMinLapMs();
    uint8_t getAlarmThreshold();
    uint8_t getEnterRssi();
    uint8_t getExitRssi();
    uint8_t getDroneSize();
    uint16_t getGateDiameterMm();
    uint16_t getCalibrationSamples();
    char* getSsid();
    char* getPassword();
    char* getPilotName();
    char* getPilotId();
    char* getApiAddress();

   private:
    laptimer_config_t conf;
    bool modified;
    volatile uint32_t checkTimeMs = 0;
    void setDefaults();
};