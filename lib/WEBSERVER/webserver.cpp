#include "webserver.h"
// 由于 ElegantOTA 为第三方库，其源码位于各自仓库（如 https://github.com/ayushsharma82/ElegantOTA）
// 此处仅保留头文件包含，以启用 OTA 功能
#include <ElegantOTA.h>

#include <DNSServer.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <esp_wifi.h>
#include <Update.h>

#include "debug.h"

static const uint8_t DNS_PORT = 53;
static IPAddress netMsk(255, 255, 255, 0);
static DNSServer dnsServer;
static IPAddress ipAddress;
static AsyncWebServer server(80);
static AsyncEventSource events("/events");

static const char *wifi_hostname = "QiYun-LapTimer";
static const char *wifi_ap_ssid_prefix = "QiYun-LapTimer";
static const char *wifi_ap_password = "12345678";
static const char *wifi_ap_address = "33.0.0.1";
String wifi_ap_ssid;

void Webserver::init(Config *config, LapTimer *lapTimer, BatteryMonitor *batMonitor, Buzzer *buzzer, Led *l) {

    ipAddress.fromString(wifi_ap_address);

    conf = config;
    timer = lapTimer;
    monitor = batMonitor;
    buz = buzzer;
    led = l;

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
    if (conf->getSsid()[0] == 0) {
        changeMode = WIFI_AP;
        DEBUG("No SSID configured, will start in AP mode\n");
    } else {
        changeMode = WIFI_STA;
        DEBUG("SSID configured, will try to connect to WiFi network\n");
    }
    changeTimeMs = millis();
    lastStatus = WL_DISCONNECTED;
    connectionAttempts = 0;
}

void Webserver::sendRssiEvent(uint8_t rssi) {
    if (!servicesStarted) return;
    char buf[16];
    snprintf(buf, sizeof(buf), "%u", rssi);
    events.send(buf, "rssi");
}

void Webserver::sendLaptimeEvent(uint32_t lapTime) {
    if (!servicesStarted) return;
    char buf[16];
    snprintf(buf, sizeof(buf), "%u", lapTime);
    events.send(buf, "lap");
}

void Webserver::handleWebUpdate(uint32_t currentTimeMs) {
    if (timer->isLapAvailable()) {
        sendLaptimeEvent(timer->getLapTime());
    }

    if (sendRssi && ((currentTimeMs - rssiSentMs) > WEB_RSSI_SEND_TIMEOUT_MS)) {
        sendRssiEvent(timer->getRssi());
        rssiSentMs = currentTimeMs;
    }

    wl_status_t status = WiFi.status();

    if (status != lastStatus && wifiMode == WIFI_STA) {
        DEBUG("WiFi status = %u\n", status);
        switch (status) {
            case WL_NO_SSID_AVAIL:
            case WL_CONNECT_FAILED:
            case WL_CONNECTION_LOST:
                connectionAttempts++;
                if (connectionAttempts < 3) {
                    DEBUG("Connection failed, retrying (%d/3)...\n", connectionAttempts);
                    WiFi.disconnect();
                    WiFi.begin(conf->getSsid(), conf->getPassword());
                    changeTimeMs = currentTimeMs;
                } else {
                    DEBUG("Connection failed 3 times, switching to AP\n");
                    changeTimeMs = currentTimeMs;
                    changeMode = WIFI_AP;
                }
                break;
            case WL_DISCONNECTED:  // try reconnection
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
    if (status != WL_CONNECTED && wifiMode == WIFI_STA && (currentTimeMs - changeTimeMs) > WIFI_CONNECTION_TIMEOUT_MS) {
        if (!wifiConnected) {
            connectionAttempts++;
            if (connectionAttempts < 3) {
                DEBUG("Connection timed out, retrying (%d/3)...\n", connectionAttempts);
                WiFi.disconnect();
                WiFi.begin(conf->getSsid(), conf->getPassword());
                changeTimeMs = currentTimeMs;
            } else {
                DEBUG("Connection timed out 3 times, switching to AP\n");
                changeMode = WIFI_AP;  // if we didnt manage to ever connect to wifi network
                changeTimeMs = currentTimeMs;
            }
        } else {
            DEBUG("WiFi Connection failed, reconnecting\n");
            WiFi.reconnect();
            startServices();
            buz->beep(100);
            led->blink(200);
            changeTimeMs = currentTimeMs;
        }
    }
    if (changeMode != wifiMode && changeMode != WIFI_OFF && (currentTimeMs - changeTimeMs) > WIFI_RECONNECT_TIMEOUT_MS) {
        switch (changeMode) {
            case WIFI_AP:
                DEBUG("Changing to WiFi AP mode\n");

                WiFi.disconnect();
                wifiMode = WIFI_AP;
                WiFi.setHostname(wifi_hostname);  // hostname must be set before the mode is set to STA
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
                WiFi.setHostname(wifi_hostname);  // hostname must be set before the mode is set to STA
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

    if (servicesStarted) {
        dnsServer.processNextRequest();
    }
}

/** Is this an IP? */
static boolean isIp(String str) {
    for (size_t i = 0; i < str.length(); i++) {
        int c = str.charAt(i);
        if (c != '.' && (c < '0' || c > '9')) {
            return false;
        }
    }
    return true;
}

/** IP to String? */
static String toStringIp(IPAddress ip) {
    String res = "";
    for (int i = 0; i < 3; i++) {
        res += String((ip >> (8 * i)) & 0xFF) + ".";
    }
    res += String(((ip >> 8 * 3)) & 0xFF);
    return res;
}

static bool captivePortal(AsyncWebServerRequest *request) {
    extern const char *wifi_hostname;

    if (!isIp(request->host()) && request->host() != (String(wifi_hostname) + ".local")) {
        DEBUG("Request redirected to captive portal\n");
        request->redirect(String("http://") + toStringIp(request->client()->localIP()));
        return true;
    }
    return false;
}

static void handleRoot(AsyncWebServerRequest *request) {
    if (captivePortal(request)) {  // If captive portal redirect instead of displaying the page.
        return;
    }
    if (LittleFS.exists("/index.html")) {
        request->send(LittleFS, "/index.html", "text/html");
    } else {
        request->send(200, "text/plain", "QiYun-LapTimer is running.\n\nError: Web interface not found (index.html missing).\nPlease upload filesystem using 'pio run -t uploadfs'.");
    }
}

static void handleNotFound(AsyncWebServerRequest *request) {
    if (request->method() == HTTP_OPTIONS) {
        AsyncWebServerResponse *preflight = request->beginResponse(204);
        preflight->addHeader("Access-Control-Allow-Origin", "*");
        preflight->addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        preflight->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
        preflight->addHeader("Access-Control-Max-Age", "600");
        request->send(preflight);
        return;
    }
    if (captivePortal(request)) {  // If captive portal redirect instead of displaying the error page.
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

    for (uint8_t i = 0; i < request->args(); i++) {
        message += String(F(" ")) + request->argName(i) + F(": ") + request->arg(i) + F("\n");
    }
    AsyncWebServerResponse *response = request->beginResponse(404, "text/plain", message);
    response->addHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    response->addHeader("Pragma", "no-cache");
    response->addHeader("Expires", "-1");
    request->send(response);
}

static bool startLittleFS() {
    if (!LittleFS.begin()) {
        DEBUG("LittleFS mount failed\n");
        return false;
    }
    DEBUG("LittleFS mounted sucessfully\n");
    return true;
}

static void startMDNS() {
    if (!MDNS.begin(wifi_hostname)) {
        DEBUG("Error starting mDNS\n");
        return;
    }

    String instance = String(wifi_hostname) + "_" + WiFi.macAddress();
    instance.replace(":", "");
    MDNS.setInstanceName(instance);
    MDNS.addService("http", "tcp", 80);
}

void Webserver::startServices() {
    if (servicesStarted) {
        MDNS.end();
        startMDNS();
        return;
    }

    startLittleFS();

    server.on("/", handleRoot);
    server.on("/generate_204", handleRoot);  // handle Andriod phones doing shit to detect if there is 'real' internet and possibly dropping conn.
    server.on("/gen_204", handleRoot);
    server.on("/library/test/success.html", handleRoot);
    server.on("/hotspot-detect.html", handleRoot);
    server.on("/connectivity-check.html", handleRoot);
    server.on("/check_network_status.txt", handleRoot);
    server.on("/ncsi.txt", handleRoot);
    server.on("/fwlink", handleRoot);

    server.on("/status", [this](AsyncWebServerRequest *request) {
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
Network:\n\
\tIP:\t%s\n\
\tMAC:\t%s\n\
EEPROM:\n\
%s\n\
Battery Voltage:\t%0.1fv";

        snprintf(buf, sizeof(buf), format,
                 ESP.getFreeHeap(), ESP.getMinFreeHeap(), ESP.getHeapSize(), ESP.getMaxAllocHeap(), LittleFS.usedBytes(), LittleFS.totalBytes(),
                 ESP.getChipModel(), ESP.getChipRevision(), ESP.getChipCores(), ESP.getSdkVersion(), ESP.getFlashChipSize(), ESP.getFlashChipSpeed() / 1000000, getCpuFrequencyMhz(),
                 WiFi.localIP().toString().c_str(), WiFi.macAddress().c_str(), configBuf, voltage);
        request->send(200, "text/plain", buf);
        led->on(200);
    });

    server.on("/timer/start", HTTP_POST, [this](AsyncWebServerRequest *request) {
        timer->start();
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", "{\"status\": \"OK\"}");
        res->addHeader("Access-Control-Allow-Origin", "*");
        res->addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
        res->addHeader("Access-Control-Max-Age", "600");
        request->send(res);
    });

    server.on("/timer/stop", HTTP_POST, [this](AsyncWebServerRequest *request) {
        timer->stop();
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", "{\"status\": \"OK\"}");
        res->addHeader("Access-Control-Allow-Origin", "*");
        res->addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
        res->addHeader("Access-Control-Max-Age", "600");
        request->send(res);
    });
  

    server.on("/timer/rssiStart", HTTP_POST, [this](AsyncWebServerRequest *request) {
        sendRssi = true;
        DEBUG("RSSI streaming START requested\n");
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", "{\"status\": \"OK\"}");
        res->addHeader("Access-Control-Allow-Origin", "*");
        res->addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
        res->addHeader("Access-Control-Max-Age", "600");
        request->send(res);
        led->on(200);
    });


    server.on("/timer/rssiStop", HTTP_POST, [this](AsyncWebServerRequest *request) {
        sendRssi = false;
        DEBUG("RSSI streaming STOP requested\n");
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", "{\"status\": \"OK\"}");
        res->addHeader("Access-Control-Allow-Origin", "*");
        res->addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
        res->addHeader("Access-Control-Max-Age", "600");
        request->send(res);
        led->on(200);
    });

    server.on("/calibration/noise/start", HTTP_POST, [this](AsyncWebServerRequest *request) {
        timer->startCalibrationNoise();
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", "{\"status\": \"OK\"}");
        res->addHeader("Access-Control-Allow-Origin", "*");
        request->send(res);
    });

    server.on("/calibration/noise/stop", HTTP_POST, [this](AsyncWebServerRequest *request) {
        uint8_t maxNoise = timer->stopCalibrationNoise();
        char buf[64];
        snprintf(buf, sizeof(buf), "{\"status\": \"OK\", \"maxNoise\": %u}", maxNoise);
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", buf);
        res->addHeader("Access-Control-Allow-Origin", "*");
        request->send(res);
    });

    server.on("/calibration/crossing/start", HTTP_POST, [this](AsyncWebServerRequest *request) {
        timer->startCalibrationCrossing();
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", "{\"status\": \"OK\"}");
        res->addHeader("Access-Control-Allow-Origin", "*");
        request->send(res);
    });

    server.on("/calibration/crossing/stop", HTTP_POST, [this](AsyncWebServerRequest *request) {
        uint8_t maxPeak = timer->stopCalibrationCrossing();
        // Here we can fetch the previously measured noise from somewhere, 
        // or just return the peak and let frontend handle it.
        // For simplicity, let's just return the peak.
        // Or if we want to be stateless, we could pass noise as param, but keeping state in Timer is easier.
        // Let's assume frontend will do the calculation or we can do it here if we stored noise.
        // We stored maxNoise in timer? No, we reset it. 
        // Wait, timer->calibrationMaxNoise is member variable, but it gets reset on startCalibrationNoise.
        // So as long as we don't call startCalibrationNoise again, it holds the value?
        // Actually, let's check laptimer implementation.
        // startCalibrationNoise resets calibrationMaxNoise = 0.
        // So if we run noise calib -> stop -> crossing calib -> stop, calibrationMaxNoise holds the value.
        // Correct.
        
        // Let's implement simple logic here based on RotorHazard:
        // EnterAt < Peak (we use maxPeak)
        // EnterAt > Noise (we need maxNoise)
        // ExitAt < EnterAt
        // ExitAt > Noise

        // Simple Heuristic:
        // EnterAt = Noise + (Peak - Noise) * 0.6
        // ExitAt = Noise + (Peak - Noise) * 0.3
        
        // We need to access maxNoise. We should probably add a getter or just make them public, 
        // or just return peak and let frontend do math. 
        // Let's return peak and let frontend do math to be flexible.
        
        char buf[64];
        snprintf(buf, sizeof(buf), "{\"status\": \"OK\", \"maxPeak\": %u}", maxPeak);
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", buf);
        res->addHeader("Access-Control-Allow-Origin", "*");
        request->send(res);
    });

    server.on("/save_and_restart", HTTP_POST, [this](AsyncWebServerRequest *request) {
        conf->write();
        AsyncWebServerResponse* res = request->beginResponse(200, "application/json", "{\"status\": \"OK\"}");
        res->addHeader("Access-Control-Allow-Origin", "*");
        res->addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
        res->addHeader("Access-Control-Max-Age", "600");
        request->send(res);
        delay(500);
        ESP.restart();
    });

    server.on("/config", HTTP_GET, [this](AsyncWebServerRequest *request) {
        AsyncResponseStream *response = request->beginResponseStream("application/json");
        response->addHeader("Access-Control-Allow-Origin", "*");
        response->addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        response->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
        response->addHeader("Access-Control-Max-Age", "600");
        conf->toJson(*response);
        request->send(response);
        led->on(200);
    });
    // server.on("/update", HTTP_OPTIONS, [](AsyncWebServerRequest *request) {
    //     AsyncWebServerResponse *preflight = request->beginResponse(204);
    //     preflight->addHeader("Access-Control-Allow-Origin", "*");
    //     preflight->addHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    //     preflight->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
    //     preflight->addHeader("Access-Control-Max-Age", "600");
    //     request->send(preflight);
    // });
    server.on(
        "/update", HTTP_POST,
        [](AsyncWebServerRequest *request) {
            bool ok = !Update.hasError();
            AsyncWebServerResponse *res = request->beginResponse(ok ? 200 : 500, "application/json", ok ? "{\"status\":\"OK\"}" : "{\"status\":\"FAIL\"}");
            res->addHeader("Access-Control-Allow-Origin", "*");
            res->addHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
            res->addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Origin");
            res->addHeader("Access-Control-Max-Age", "600");
            request->send(res);
            if (ok) ESP.restart();
        },
        [](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
            if (!index) {
                Update.begin(UPDATE_SIZE_UNKNOWN);
            }
            Update.write(data, len);
            if (final) {
                Update.end(true);
            }
        });
    

    AsyncCallbackJsonWebHandler *configJsonHandler = new AsyncCallbackJsonWebHandler("/config", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        JsonObject jsonObj = json.as<JsonObject>();
#ifdef DEBUG_OUT
        serializeJsonPretty(jsonObj, DEBUG_OUT);
        DEBUG("\n");
#endif
        conf->fromJson(jsonObj);
        request->send(200, "application/json", "{\"status\": \"OK\"}");
        led->on(200);
    });

    server.serveStatic("/", LittleFS, "/").setCacheControl("max-age=600");

    events.onConnect([this](AsyncEventSourceClient *client) {
        if (client->lastId()) {
            DEBUG("Client reconnected! Last message ID that it got is: %u\n", client->lastId());
        }
        client->send("start", NULL, millis(), 1000);
        led->on(200);
    });

    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
    DefaultHeaders::Instance().addHeader("Access-Control-Max-Age", "600");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "*");

    server.onNotFound(handleNotFound);

    server.addHandler(&events);
    server.addHandler(configJsonHandler);

    ElegantOTA.setAutoReboot(true);
    ElegantOTA.begin(&server);

    server.begin();

    dnsServer.start(DNS_PORT, "*", ipAddress);
    dnsServer.setErrorReplyCode(DNSReplyCode::NoError);

    startMDNS();

    servicesStarted = true;
}
