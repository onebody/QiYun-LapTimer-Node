#include "RX5808.h"
#include "buzzer.h"
#include "config.h"
#include "kalman.h"
#include "led.h"

typedef enum {
    STOPPED,
    WAITING,
    RUNNING
} laptimer_state_e;

#define LAPTIMER_LAP_HISTORY 50
#define LAPTIMER_RSSI_HISTORY 100

class LapTimer {
   public:
    void init(Config *config, RX5808 *rx5808, Buzzer *buzzer, Led *l);
    void start();
    void stop();
    void handleLapTimerUpdate(uint32_t currentTimeMs);
    uint8_t getRssi();
    uint32_t getLapTime();
    bool isLapAvailable();

    void startCalibrationNoise();
    uint8_t stopCalibrationNoise();
    void startCalibrationCrossing();
    uint8_t stopCalibrationCrossing();

   private:
    laptimer_state_e state = STOPPED;
    RX5808 *rx;
    Config *conf;
    Buzzer *buz;
    Led *led;
    KalmanFilter filter;
    uint32_t startTimeMs = 0;
    uint8_t lapCount;
    uint8_t rssiCount;
    uint32_t lapTimes[LAPTIMER_LAP_HISTORY];
    uint8_t rssi[LAPTIMER_RSSI_HISTORY];

    uint8_t rssiPeak = 0;
    uint32_t rssiPeakTimeMs = 0;

    bool lapAvailable = false;

    // Calibration
    bool isCalibratingNoise = false;
    bool isCalibratingCrossing = false;
    uint8_t calibrationMaxNoise = 0;
    uint8_t calibrationMaxPeak = 0;

    void lapPeakCapture(uint32_t currentTimeMs);
    bool lapPeakCaptured();
    void lapPeakReset();

    void startLap();
    void finishLap();
};
