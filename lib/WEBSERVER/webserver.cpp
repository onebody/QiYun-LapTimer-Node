#include "webserver.h"
// 由于 ElegantOTA 为第三方库，其源码位于各自仓库（如 https://github.com/ayushsharma82/ElegantOTA）
// 此处暂时注释掉，以解决编译错误
// #include <ElegantOTA>

#include <DNSServer.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <esp_wifi.h>
#include <Update.h>
#include <HTTPClient.h>

#include "debug.h"

static const uint8_t DNS_PORT = 53;
static IPAddress netMsk(255, 255, 255, 0);
static DNSServer dnsServer;
static IPAddress ipAddress;
static AsyncWebServer server(80);
static AsyncEventSource events("/events");

static const char *wifi_hostname = "qylpt";
static const char *wifi_ap_ssid_prefix = "QYLPT";
static const char *wifi_ap_password = "12345678";
static const char *wifi_ap_address = "33.0.0.1";
String wifi_ap_ssid;

static const char *WEBSERVER_API_ADDRESS = "http://192.168.3.37:8888/api";

// 新增：全局Webserver实例指针，用于静态回调函数中访问类方法
static Webserver *gWebserverInstance = nullptr;

static float clampf(float v, float lo, float hi)
{
    if (v < lo)
        return lo;
    if (v > hi)
        return hi;
    return v;
}

void Webserver::init(Config *config, LapTimer *lapTimer, BatteryMonitor *batMonitor, Buzzer *buzzer, Led *l)
{

    ipAddress.fromString(wifi_ap_address);

    conf = config;
    timer = lapTimer;
    monitor = batMonitor;
    buz = buzzer;
    led = l;

    // 保存全局实例指针
    gWebserverInstance = this;

    // 设置lap事件回调函数
    timer->setLapEventHandler(lapEventHandler);
    // 设置stop事件回调函数
    timer->setStopEventHandler(stopEventHandler);

    wifi_ap_ssid = String(wifi_ap_ssid_prefix) + "_" + WiFi.macAddress().substring(WiFi.macAddress().length() - 6);
    wifi_ap_ssid.replace(":", "");

    DEBUG("Webserver init: MAC=%s, AP SSID=%s\n", WiFi.macAddress().c_str(), wifi_ap_ssid.c_str());
    DEBUG("Config SSID='%s', Password='%s'\n", conf->getSsid(), conf->getPassword());

    WiFi.persistent(false);
    WiFi.disconnect();
    WiFi.mode(WIFI_OFF);
    WiFi.setTxPower(WIFI_POWER_19_5dBm);
    esp_wifi_set_protocol(WIFI_IF_STA, WIFI_PROTOCOL_LR);
    esp_wifi_set_protocol(WIFI_IF_AP, WIFI_PROTOCOL_LR);
    if (conf->getSsid()[0] == 0)
    {
        changeMode = WIFI_AP;
        DEBUG("No SSID configured, will start in AP mode\n");
    }
    else
    {
        changeMode = WIFI_STA;
        DEBUG("SSID configured, will try to connect to WiFi network\n");
    }
    changeTimeMs = millis();
    lastStatus = WL_DISCONNECTED;
    connectionAttempts = 0;
}

void Webserver::sendRssiEvent(uint8_t rssi)
{
    if (!servicesStarted)
        return;
    char buf[16];
    snprintf(buf, sizeof(buf), "%u", rssi);
    events.send(buf, "rssi");
}

void Webserver::sendLaptimeEvent(uint32_t lapTime)
{
    if (!servicesStarted)
        return;
    char buf[16];
    snprintf(buf, sizeof(buf), "%u", lapTime);
    events.send(buf, "lap");
}

// 新增：lap事件处理函数
void Webserver::lapEventHandler(uint32_t lapTime)
{
    if (gWebserverInstance != nullptr) {
        gWebserverInstance->sendLaptimeEvent(lapTime);
    }
}

// 新增：stop事件处理函数
void Webserver::stopEventHandler()
{
    if (gWebserverInstance != nullptr) {
        gWebserverInstance->uploadTrainingData();
    }
}

void Webserver::uploadTrainingData()
{
    DEBUG("Uploading training data...\n");
    
    // 检查WiFi连接状态
    if (WiFi.status() != WL_CONNECTED) {
        DEBUG("WiFi not connected, cannot upload data\n");
        return;
    }
    
    // 获取飞手信息
    char* pilotName = conf->getPilotName();
    char* pilotId = conf->getPilotId();
    
    // 检查飞手ID是否为空
    if (strlen(pilotId) == 0) {
        DEBUG("Pilot ID is empty, cannot upload data\n");
        return;
    }
    
    // 获取圈速数据
    uint32_t* lapTimes = timer->getLapTimes();
    uint8_t lapCount = timer->getLapCount();
    
    // 计算总时间
    uint32_t totalTime = 0;
    uint32_t bestLapTime = 0;
    
    for (uint8_t i = 0; i < lapCount; i++) {
        totalTime += lapTimes[i];
        if (i == 0 || lapTimes[i] < bestLapTime) {
            bestLapTime = lapTimes[i];
        }
    }
    
    // 构建JSON数据
    DynamicJsonDocument doc(1024);
    doc["pilot_id"] = pilotId;
    doc["title"] = "训练测试";
    doc["description"] = "计时器终端测试数据";
    doc["flight_date"] = "2026-02-05";
    doc["takeoff_time"] = "2026-02-05 12:00:00";
    doc["total_time"] = totalTime;
    doc["total_laps"] = lapCount;
    doc["average_lap_time"] = lapCount > 0 ? totalTime / lapCount : 0;
    doc["best_lap_time"] = bestLapTime;
    
    // 添加圈速数据
    JsonArray laps = doc.createNestedArray("laps");
    for (uint8_t i = 0; i < lapCount; i++) {
        JsonObject lap = laps.createNestedObject();
        lap["lap_time"] = lapTimes[i];
    }
    
    // 转换为JSON字符串
    String jsonString;
    serializeJson(doc, jsonString);
    
    DEBUG("Training data: %s\n", jsonString.c_str());
    
    // 发送HTTP请求
    HTTPClient http;
    http.begin(String(WEBSERVER_API_ADDRESS) + "/terminal/pilot/score");
    http.addHeader("Content-Type", "application/json");
    
    int httpCode = http.POST(jsonString);
    
    if (httpCode > 0) {
        String response = http.getString();
        DEBUG("HTTP Response code: %d\n", httpCode);
        DEBUG("Response: %s\n", response.c_str());
        
        // 检查上传是否成功
        DynamicJsonDocument responseDoc(512);
        DeserializationError error = deserializeJson(responseDoc, response);
        
        if (!error && responseDoc["success"] == true) {
            DEBUG("Training data uploaded successfully\n");
            buz->beep(200);
            led->on(200);
        } else {
            DEBUG("Failed to upload training data: %s\n", response.c_str());
            buz->beep(1000);
            led->blink(200);
        }
    } else {
        DEBUG("HTTP request failed, error: %s\n", http.errorToString(httpCode).c_str());
        buz->beep(1000);
        led->blink(200);
    }
    
    http.end();
}

void Webserver::handleWebUpdate(uint32_t currentTimeMs)
{
    // If a restart has been requested by the web handler, perform it from
    // the main loop/context to avoid doing a blocking delay or restart
    // inside the async webserver handler (which can be unsafe).
    if (restartRequested && (millis() - restartRequestTimeMs) > RESTART_DELAY_MS) {
        DEBUG("Restarting device now\n");
        restartRequested = false;
        delay(50);
        ESP.restart();
    }

    // 移除定期检查lapAvailable的逻辑，改为使用回调机制
    // if (timer->isLapAvailable()) {
    //     sendLaptimeEvent(timer->getLapTime());
    // }

    if (sendRssi && ((currentTimeMs - rssiSentMs) > WEB_RSSI_SEND_TIMEOUT_MS)) {
        sendRssiEvent(timer->getRssi());
        rssiSentMs = currentTimeMs;
    }

    // Check if configuration has changed requiring a reconnect
    // If we are in AP mode but have valid SSID/Password, try to connect?
    // Current logic relies on 'changeMode' flag which is set in 'init' or on failure.
    // We should also check if config was updated via web interface and 'modified' flag implies a need to re-evaluate.
    // However, the current Config::write() clears 'modified'.
    // A simple way is to check if we are in AP mode, but a SSID is configured, we should periodically try to switch to STA.
    // Or relying on the user to hit 'Save & Restart' is safer for full re-init.

    wl_status_t status = WiFi.status();

    if (status != lastStatus && wifiMode == WIFI_STA)
    {
        DEBUG("WiFi status = %u\n", status);
        switch (status)
        {
        case WL_NO_SSID_AVAIL:
            connectionAttempts++;
            if (connectionAttempts < 3)
            {
                DEBUG("Connection failed: SSID '%s' not found (WL_NO_SSID_AVAIL). Retrying (%d/3)...\n", conf->getSsid(), connectionAttempts);
                WiFi.disconnect();
                WiFi.begin(conf->getSsid(), conf->getPassword());
                changeTimeMs = currentTimeMs;
            }
            else
            {
                DEBUG("Connection failed 3 times: SSID '%s' not found. Switching to AP mode\n", conf->getSsid());
                changeTimeMs = currentTimeMs;
                changeMode = WIFI_AP;
            }
            break;
        case WL_CONNECT_FAILED:
            connectionAttempts++;
            if (connectionAttempts < 3)
            {
                DEBUG("Connection failed: authentication or handshake failed (WL_CONNECT_FAILED). Check password for SSID '%s'. Retrying (%d/3)...\n", conf->getSsid(), connectionAttempts);
                WiFi.disconnect();
                WiFi.begin(conf->getSsid(), conf->getPassword());
                changeTimeMs = currentTimeMs;
            }
            else
            {
                DEBUG("Connection failed 3 times: authentication failed for SSID '%s'. Switching to AP mode\n", conf->getSsid());
                changeTimeMs = currentTimeMs;
                changeMode = WIFI_AP;
            }
            break;
        case WL_CONNECTION_LOST:
            connectionAttempts++;
            if (connectionAttempts < 3)
            {
                DEBUG("Connection lost while attempting to connect (WL_CONNECTION_LOST). Retrying (%d/3)...\n", connectionAttempts);
                WiFi.disconnect();
                WiFi.begin(conf->getSsid(), conf->getPassword());
                changeTimeMs = currentTimeMs;
            }
            else
            {
                DEBUG("Connection repeatedly lost for SSID '%s'; switching to AP mode\n", conf->getSsid());
                changeTimeMs = currentTimeMs;
                changeMode = WIFI_AP;
            }
            break;
        case WL_DISCONNECTED: // try reconnection
            changeTimeMs = currentTimeMs;
            break;
        case WL_CONNECTED:
            buz->beep(200);
            led->off();
            wifiConnected = true;
            DEBUG("WiFi connected! IP address: %s\n", WiFi.localIP().toString().c_str());
            break;
        default:
            break;
        }
        lastStatus = status;
    }
    if (status != WL_CONNECTED && wifiMode == WIFI_STA && (currentTimeMs - changeTimeMs) > WIFI_CONNECTION_TIMEOUT_MS)
    {
        if (!wifiConnected)
        {
            connectionAttempts++;
            if (connectionAttempts < 3)
            {
                DEBUG("Connection timed out while connecting to '%s' (status=%u). Retrying (%d/3)...\n", conf->getSsid(), status, connectionAttempts);
                WiFi.disconnect();
                WiFi.begin(conf->getSsid(), conf->getPassword());
                changeTimeMs = currentTimeMs;
            }
            else
            {
                DEBUG("Connection timed out 3 times for '%s' (status=%u). Switching to AP mode\n", conf->getSsid(), status);
                changeMode = WIFI_AP; // if we didnt manage to ever connect to wifi network
                changeTimeMs = currentTimeMs;
            }
        }
        else
        {
            DEBUG("WiFi lost after being connected (status=%u). Attempting reconnect...\n", status);
            WiFi.reconnect();
            startServices();
            buz->beep(100);
            led->blink(200);
            changeTimeMs = currentTimeMs;
        }
    }
    if (changeMode != wifiMode && changeMode != WIFI_OFF && (currentTimeMs - changeTimeMs) > WIFI_RECONNECT_TIMEOUT_MS)
    {
        switch (changeMode)
        {
        case WIFI_AP:
            DEBUG("Changing to WiFi AP mode\n");

            WiFi.disconnect();
            wifiMode = WIFI_AP;
            WiFi.setHostname(wifi_hostname); // hostname must be set before the mode is set to STA
            WiFi.mode(wifiMode);
            changeTimeMs = currentTimeMs;
            WiFi.softAPConfig(ipAddress, ipAddress, netMsk);
            WiFi.softAP(wifi_ap_ssid.c_str(), wifi_ap_password);
            startServices();
            buz->beep(1000);
            led->on(1000);
            DEBUG("AP mode started! AP IP address: %s\n", WiFi.softAPIP().toString().c_str());
            break;
        case WIFI_STA:
            DEBUG("Connecting to WiFi network\n");
            wifiMode = WIFI_STA;
            WiFi.setHostname(wifi_hostname); // hostname must be set before the mode is set to STA
            WiFi.mode(wifiMode);
            changeTimeMs = currentTimeMs;
            WiFi.begin(conf->getSsid(), conf->getPassword());
            startServices();
            led->blink(200);
        default:
            break;
        }

        changeMode = WIFI_OFF;
    }

    if (servicesStarted)
    {
        dnsServer.processNextRequest();
    }
}

/** Is this an IP? */
static boolean isIp(String str)
{
    for (size_t i = 0; i < str.length(); i++)
    {
        int c = str.charAt(i);
        if (c != '.' && (c < '0' || c > '9'))
        {
            return false;
        }
    }
    return true;
}

/** IP to String? */
static String toStringIp(IPAddress ip)
{
    String res = "";
    for (int i = 0; i < 3; i++)
    {
        res += String((ip >> (8 * i)) & 0xFF) + ".";
    }
    res += String(((ip >> 8 * 3)) & 0xFF);
    return res;
}

static bool captivePortal(AsyncWebServerRequest *request)
{
    extern const char *wifi_hostname;

    if (!isIp(request->host()) && request->host() != (String(wifi_hostname) + ".local"))
    {
        DEBUG("Request redirected to captive portal\n");
        request->redirect(String("http://") + toStringIp(request->client()->localIP()));
        return true;
    }
    return false;
}

static void handleRoot(AsyncWebServerRequest *request)
{
    if (captivePortal(request))
    { // If captive portal redirect instead of displaying the page.
        return;
    }
    // 特殊处理 Captive Portal 探测 URL，直接返回 204 No Content 或简单的 Success
    // 避免它们去尝试打开不存在的物理文件 (LittleFS) 导致报错
    String url = request->url();
    if (url.endsWith("/generate_204") ||
        url.endsWith("/gen_204") ||
        url.endsWith("/ncsi.txt") ||
        url.endsWith("/success.txt") ||
        url.endsWith("/canonical.html") ||
        url.endsWith("/hotspot-detect.html") ||
        url.endsWith("/library/test/success.html") ||
        url.endsWith("/connectivity-check.html") ||
        url.endsWith("/check_network_status.txt") ||
        url.endsWith("/fwlink"))
    {
        request->send(204);
        return;
    }

    if (LittleFS.exists("/index.html"))
    {
        request->send(LittleFS, "/index.html", "text/html");
    }
    else
    {
        request->send(200, "text/plain", "QiYun-LapTimer is running.\n\nError: Web interface not found (index.html missing).\nPlease upload filesystem using 'pio run -t uploadfs'.");
    }
}

static void handleNotFound(AsyncWebServerRequest *request)
{
    if (request->method() == HTTP_OPTIONS)
    {
        AsyncWebServerResponse *preflight = request->beginResponse(204);
        preflight->addHeader("Access-Control-Allow-Origin", "*");
        preflight->addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        preflight->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
        preflight->addHeader("Access-Control-Max-Age", "600");
        request->send(preflight);
        return;
    }
    if (captivePortal(request))
    { // If captive portal redirect instead of displaying the error page.
        return;
    }
    String message = F("File Not Found\n\n");
    message += F("URI: ");
    message += request->url();
    message += F("\nMethod: ");
    message += (request->method() == HTTP_GET) ? "GET" : "POST";
    message += F("\nArguments: ");
    message += request->args();
    message += F("\n");

    for (uint8_t i = 0; i < request->args(); i++)
    {
        message += String(F(" ")) + request->argName(i) + F(": ") + request->arg(i) + F("\n");
    }
    AsyncWebServerResponse *response = request->beginResponse(404, "text/plain", message);
    response->addHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    response->addHeader("Pragma", "no-cache");
    response->addHeader("Expires", "-1");
    request->send(response);
}

static bool startLittleFS()
{
    if (!LittleFS.begin())
    {
        DEBUG("LittleFS mount failed\n");
        return false;
    }
    DEBUG("LittleFS mounted sucessfully\n");
    return true;
}

static void startMDNS()
{
    if (!MDNS.begin(wifi_hostname))
    {
        DEBUG("Error starting mDNS\n");
        return;
    }

    String instance = String(wifi_hostname) + "_" + WiFi.macAddress();
    instance.replace(":", "");
    MDNS.setInstanceName(instance);
    MDNS.addService("http", "tcp", 80);
}

void Webserver::startServices()
{
    if (servicesStarted)
    {
        MDNS.end();
        startMDNS();
        return;
    }

    startLittleFS();

    server.on("/", handleRoot);
    server.on("/generate_204", handleRoot); // handle Andriod phones doing shit to detect if there is 'real' internet and possibly dropping conn.
    server.on("/gen_204", handleRoot);
    server.on("/library/test/success.html", handleRoot);
    server.on("/hotspot-detect.html", handleRoot);
    server.on("/connectivity-check.html", handleRoot);
    server.on("/check_network_status.txt", handleRoot);
    server.on("/ncsi.txt", handleRoot);
    server.on("/fwlink", handleRoot);
    server.on("/canonical.html", handleRoot);
    server.on("/success.txt", handleRoot);

    server.on("/status", [this](AsyncWebServerRequest *request)
              {
        char buf[1024];
        char configBuf[256];
        conf->toJsonString(configBuf);
        float voltage = (float)monitor->getBatteryVoltage() / 10;
        const char *format =
            "\
Heap:\n\
\tFree:\t%i\n\
\tMin:\t%i\n\
\tSize:\t%i\n\
\tAlloc:\t%i\n\
LittleFS:\n\
\tUsed:\t%i\n\
\tTotal:\t%i\n\
Chip:\n\
\tModel:\t%s Rev %i, %i Cores, SDK %s\n\
\tFlashSize:\t%i\n\
\tFlashSpeed:\t%iMHz\n\
\tCPU Speed:\t%iMHz\n\
Firmware:\n\
\tVersion:\t%s\n\
Network:\n\
\tIP:\t%s\n\
\tMAC:\t%s\n\
EEPROM:\n\
%s\n\
Battery Voltage:\t%0.1fv";

        snprintf(buf, sizeof(buf), format,
                 ESP.getFreeHeap(), ESP.getMinFreeHeap(), ESP.getHeapSize(), ESP.getMaxAllocHeap(), LittleFS.usedBytes(), LittleFS.totalBytes(),
                 ESP.getChipModel(), ESP.getChipRevision(), ESP.getChipCores(), ESP.getSdkVersion(), ESP.getFlashChipSize(), ESP.getFlashChipSpeed() / 1000000, getCpuFrequencyMhz(),
                 FIRMWARE_VERSION,
                 WiFi.localIP().toString().c_str(), WiFi.macAddress().c_str(), configBuf, voltage);
        request->send(200, "text/plain", buf);
        led->on(200); });

    server.on("/version", [this](AsyncWebServerRequest *request)
              {
        char buf[128];
        snprintf(buf, sizeof(buf), "{\"version\":\"%s\",\"filesystemVersion\":\"%s\"}", FIRMWARE_VERSION, FILESYSTEM_VERSION);
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", buf);
        res->addHeader("Access-Control-Allow-Origin", "*");
        request->send(res);
        led->on(200); });

    server.on("/timer/start", HTTP_POST, [this](AsyncWebServerRequest *request)
              {
        timer->start();
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", "{\"status\": \"OK\"}");
        res->addHeader("Access-Control-Allow-Origin", "*");
        res->addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
        res->addHeader("Access-Control-Max-Age", "600");
        request->send(res); });

    server.on("/timer/stop", HTTP_POST, [this](AsyncWebServerRequest *request)
              {
        timer->stop();
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", "{\"status\": \"OK\"}");
        res->addHeader("Access-Control-Allow-Origin", "*");
        res->addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
        res->addHeader("Access-Control-Max-Age", "600");
        request->send(res); });

    server.on("/timer/rssiStart", HTTP_POST, [this](AsyncWebServerRequest *request)
              {
        sendRssi = true;
        DEBUG("RSSI streaming START requested\n");
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", "{\"status\": \"OK\"}");
        res->addHeader("Access-Control-Allow-Origin", "*");
        res->addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
        res->addHeader("Access-Control-Max-Age", "600");
        request->send(res);
        led->on(200); });

    server.on("/timer/rssiStop", HTTP_POST, [this](AsyncWebServerRequest *request)
              {
        sendRssi = false;
        DEBUG("RSSI streaming STOP requested\n");
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", "{\"status\": \"OK\"}");
        res->addHeader("Access-Control-Allow-Origin", "*");
        res->addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
        res->addHeader("Access-Control-Max-Age", "600");
        request->send(res);
        led->on(200); });

    server.on("/calibration/noise/start", HTTP_POST, [this](AsyncWebServerRequest *request)
              {
        timer->startCalibrationNoise();
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", "{\"status\": \"OK\"}");
        res->addHeader("Access-Control-Allow-Origin", "*");
        request->send(res); });

    server.on("/calibration/noise/stop", HTTP_POST, [this](AsyncWebServerRequest *request)
              {
        uint8_t maxNoise = timer->stopCalibrationNoise();
        uint16_t samples = timer->getCalibrationNoiseSamples();
        uint16_t target = conf->getCalibrationSamples();
        bool ok = samples >= target;
        char buf[128];
        snprintf(buf, sizeof(buf), "{\"status\":\"OK\",\"maxNoise\":%u,\"samples\":%u,\"target\":%u,\"ok\":%s}", maxNoise, samples, target, ok ? "true" : "false");
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", buf);
        res->addHeader("Access-Control-Allow-Origin", "*");
        request->send(res); });

    server.on("/calibration/crossing/start", HTTP_POST, [this](AsyncWebServerRequest *request)
              {
        // Deprecated but kept for compatibility
        timer->startCalibrationCrossing();
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", "{\"status\": \"OK\"}");
        res->addHeader("Access-Control-Allow-Origin", "*");
        request->send(res); });

    server.on("/calibration/crossing/stop", HTTP_POST, [this](AsyncWebServerRequest *request)
              {
        // Deprecated: just returns empty/dummy values to avoid breaking legacy clients if any
        uint8_t maxPeak = 0;
        uint8_t maxNoise = timer->getCalibrationMaxNoise();
        char buf[64];
        snprintf(buf, sizeof(buf), "{\"status\":\"OK\",\"maxNoise\":%u,\"maxPeak\":%u}", maxNoise, maxPeak);
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", buf);
        res->addHeader("Access-Control-Allow-Origin", "*");
        request->send(res); });

    server.on("/save_and_restart", HTTP_POST, [this](AsyncWebServerRequest *request)
              {
        conf->write();
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", "{\"status\": \"OK\"}");
        res->addHeader("Access-Control-Allow-Origin", "*");
        res->addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
        res->addHeader("Access-Control-Max-Age", "600");
        request->send(res);
        // Schedule a restart from the main loop/context to avoid calling
        // ESP.restart() inside the async handler.
        restartRequestTimeMs = millis();
        restartRequested = true; });

    server.on("/config", HTTP_GET, [this](AsyncWebServerRequest *request)
              {
        AsyncResponseStream *response = request->beginResponseStream("application/json");
        response->addHeader("Access-Control-Allow-Origin", "*");
        response->addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        response->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
        response->addHeader("Access-Control-Max-Age", "600");
        conf->toJson(*response);
        request->send(response);
        led->on(200); });

    server.on(
        "/update", HTTP_POST,
        [](AsyncWebServerRequest *request)
        {
            bool ok = !Update.hasError();
            AsyncWebServerResponse *res = request->beginResponse(ok ? 200 : 500, "application/json", ok ? "{\"status\":\"OK\"}" : "{\"status\":\"FAIL\"}");
            res->addHeader("Access-Control-Allow-Origin", "*");
            res->addHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
            res->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
            res->addHeader("Access-Control-Max-Age", "600");
            request->send(res);
            if (ok)
                ESP.restart();
        },
        [](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final)
        {
            if (!index)
            {
                Update.begin(UPDATE_SIZE_UNKNOWN);
            }
            Update.write(data, len);
            if (final)
            {
                Update.end(true);
            }
        });

    AsyncCallbackJsonWebHandler *configJsonHandler = new AsyncCallbackJsonWebHandler("/config", [this](AsyncWebServerRequest *request, JsonVariant &json)
                                                                                     {
        JsonObject jsonObj = json.as<JsonObject>();
#ifdef DEBUG_OUT
        serializeJsonPretty(jsonObj, DEBUG_OUT);
        DEBUG("\n");
#endif
        conf->fromJson(jsonObj);
        conf->write(); // 立即将配置写入EEPROM
        request->send(200, "application/json", "{\"status\": \"OK\"}");
        led->on(200); });

    server.serveStatic("/", LittleFS, "/").setCacheControl("max-age=600");

    events.onConnect([this](AsyncEventSourceClient *client)
                     {
        if (client->lastId()) {
            DEBUG("Client reconnected! Last message ID that it got is: %u\n", client->lastId());
        }
        client->send("start", NULL, millis(), 1000);
        led->on(200); });

    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
    DefaultHeaders::Instance().addHeader("Access-Control-Max-Age", "600");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "*");
    // 添加安全头信息
    DefaultHeaders::Instance().addHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
    DefaultHeaders::Instance().addHeader("X-Frame-Options", "SAMEORIGIN");
    DefaultHeaders::Instance().addHeader("X-XSS-Protection", "1; mode=block");
    DefaultHeaders::Instance().addHeader("X-Content-Type-Options", "nosniff");

    server.onNotFound(handleNotFound);

    server.addHandler(&events);
    server.addHandler(configJsonHandler);

    // 为了支持文件系统更新，我们需要添加一个额外的路由
    // 注意：ElegantOTA默认只处理固件更新，文件系统更新需要手动实现
    
    // 定义一个简单的文件系统更新路由，支持单个文件上传
    server.on("/update/fs/single", HTTP_POST, [](AsyncWebServerRequest *request) {
        AsyncWebServerResponse *res = request->beginResponse(200, "application/json", "{\"status\":\"OK\"}");
        res->addHeader("Access-Control-Allow-Origin", "*");
        request->send(res);
    }, [](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
        static File uploadFile;
        
        // 如果是第一个数据包，创建文件
        if (!index) {
            DEBUG("Uploading file: %s\n", filename.c_str());
            uploadFile = LittleFS.open("/" + filename, FILE_WRITE);
            if (!uploadFile) {
                DEBUG("Failed to create file: %s\n", filename.c_str());
                return;
            }
        }
        
        // 写入数据
        if (len > 0) {
            if (uploadFile.write(data, len) != len) {
                DEBUG("Failed to write to file: %s\n", filename.c_str());
                uploadFile.close();
                return;
            }
        }
        
        // 如果是最后一个数据包，完成上传
        if (final) {
            uploadFile.close();
            DEBUG("File upload completed: %s\n", filename.c_str());
        }
    });
    
    // 文件系统更新由ElegantOTA处理，不需要我们自己实现
    // ElegantOTA使用/ota/start路由，并通过mode=fs参数支持文件系统更新

    // 暂时注释掉ElegantOTA相关代码，以解决编译错误
    // ElegantOTA.setAutoReboot(true);
    // ElegantOTA.begin(&server);

    server.begin();

    dnsServer.start(DNS_PORT, "*", ipAddress);
    dnsServer.setErrorReplyCode(DNSReplyCode::NoError);

    startMDNS();

    servicesStarted = true;
}