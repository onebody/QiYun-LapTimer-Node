#include "config.h"

#include <EEPROM.h>

#include "debug.h"

void Config::init(void) {
    if (sizeof(laptimer_config_t) > EEPROM_RESERVED_SIZE) {
        DEBUG("Config size too big, adjust reserved EEPROM size\n");
        return;
    }

    EEPROM.begin(EEPROM_RESERVED_SIZE);  // Size of EEPROM
    load();                              // Override default settings from EEPROM

    checkTimeMs = millis();

    DEBUG("EEPROM Init Successful\n");
}

void Config::load(void) {
    modified = false;
    EEPROM.get(0, conf);

    uint32_t version = 0xFFFFFFFF;
    if ((conf.version & CONFIG_MAGIC_MASK) == CONFIG_MAGIC) {
        version = conf.version & ~CONFIG_MAGIC_MASK;
    }

    if (version == 1) {
        conf.version = CONFIG_VERSION | CONFIG_MAGIC;
        if (conf.droneSize != 2 && conf.droneSize != 5) {
            conf.droneSize = 5;
        }
        if (conf.calibSamples < 10 || conf.calibSamples > 200) {
            conf.calibSamples = 20;
        }
        modified = true;
        write();
        return;
    }

    // If version is not current, reset to defaults
    if (version != CONFIG_VERSION) {
        setDefaults();
    }
}

void Config::write(void) {
    if (!modified) return;

    DEBUG("Writing to EEPROM\n");

    EEPROM.put(0, conf);
    EEPROM.commit();

    DEBUG("Writing to EEPROM done\n");

    modified = false;
}

void Config::toJson(AsyncResponseStream& destination) {
    // Use https://arduinojson.org/v6/assistant to estimate memory
    DynamicJsonDocument config(320);
    config["freq"] = conf.frequency;
    config["minLap"] = conf.minLap;
    config["alarm"] = conf.alarm;
    config["anType"] = conf.announcerType;
    config["anRate"] = conf.announcerRate;
    config["enterRssi"] = conf.enterRssi;
    config["exitRssi"] = conf.exitRssi;
    config["droneSize"] = conf.droneSize;
    config["gateDiameterMm"] = getGateDiameterMm();
    config["calibSamples"] = conf.calibSamples;
    config["name"] = conf.pilotName;
    config["ssid"] = conf.ssid;
    config["pwd"] = conf.password;
    serializeJson(config, destination);
}

void Config::toJsonString(char* buf) {
    DynamicJsonDocument config(320);
    config["freq"] = conf.frequency;
    config["minLap"] = conf.minLap;
    config["alarm"] = conf.alarm;
    config["anType"] = conf.announcerType;
    config["anRate"] = conf.announcerRate;
    config["enterRssi"] = conf.enterRssi;
    config["exitRssi"] = conf.exitRssi;
    config["droneSize"] = conf.droneSize;
    config["gateDiameterMm"] = getGateDiameterMm();
    config["calibSamples"] = conf.calibSamples;
    config["name"] = conf.pilotName;
    config["ssid"] = conf.ssid;
    config["pwd"] = conf.password;
    serializeJsonPretty(config, buf, 320);
}

void Config::fromJson(JsonObject source) {
    if (source["freq"] != conf.frequency) {
        conf.frequency = source["freq"];
        modified = true;
    }
    if (source["minLap"] != conf.minLap) {
        conf.minLap = source["minLap"];
        modified = true;
    }
    if (source["alarm"] != conf.alarm) {
        conf.alarm = source["alarm"];
        modified = true;
    }
    if (source["anType"] != conf.announcerType) {
        conf.announcerType = source["anType"];
        modified = true;
    }
    if (source["anRate"] != conf.announcerRate) {
        conf.announcerRate = source["anRate"];
        modified = true;
    }
    if (source["enterRssi"] != conf.enterRssi) {
        conf.enterRssi = source["enterRssi"];
        modified = true;
    }
    if (source["exitRssi"] != conf.exitRssi) {
        conf.exitRssi = source["exitRssi"];
        modified = true;
    }
    if (source.containsKey("droneSize")) {
        uint8_t ds = source["droneSize"];
        if (ds != 2 && ds != 5) ds = 5;
        if (ds != conf.droneSize) {
            conf.droneSize = ds;
            modified = true;
        }
    }
    if (source.containsKey("calibSamples")) {
        uint16_t cs = source["calibSamples"];
        if (cs < 10) cs = 10;
        if (cs > 200) cs = 200;
        if (cs != conf.calibSamples) {
            conf.calibSamples = cs;
            modified = true;
        }
    }
    if (source["name"] != conf.pilotName) {
        strlcpy(conf.pilotName, source["name"] | "", sizeof(conf.pilotName));
        modified = true;
    }
    if (source["ssid"] != conf.ssid) {
        strlcpy(conf.ssid, source["ssid"] | "", sizeof(conf.ssid));
        modified = true;
    }
    if (source["pwd"] != conf.password) {
        strlcpy(conf.password, source["pwd"] | "", sizeof(conf.password));
        modified = true;
    }
}

uint16_t Config::getFrequency() {
    return conf.frequency;
}

uint32_t Config::getMinLapMs() {
    return conf.minLap * 100;
}

uint8_t Config::getAlarmThreshold() {
    return conf.alarm;
}

uint8_t Config::getEnterRssi() {
    return conf.enterRssi;
}

uint8_t Config::getExitRssi() {
    return conf.exitRssi;
}

uint8_t Config::getDroneSize() {
    if (conf.droneSize != 2 && conf.droneSize != 5) return 5;
    return conf.droneSize;
}

uint16_t Config::getGateDiameterMm() {
    return getDroneSize() == 2 ? 1500 : 3000;
}

uint16_t Config::getCalibrationSamples() {
    if (conf.calibSamples < 10) return 10;
    if (conf.calibSamples > 200) return 200;
    return conf.calibSamples;
}

char* Config::getSsid() {
    return conf.ssid;
}

char* Config::getPassword() {
    return conf.password;
}

void Config::setDefaults(void) {
    DEBUG("Setting EEPROM defaults\n");
    // Reset everything to 0/false and then just set anything that zero is not appropriate
    memset(&conf, 0, sizeof(conf));
    conf.version = CONFIG_VERSION | CONFIG_MAGIC;
    conf.frequency = 1111;
    conf.minLap = 100;
    conf.alarm = 36;
    conf.announcerType = 2;
    conf.announcerRate = 10;
    conf.enterRssi = 120;
    conf.exitRssi = 100;
    conf.droneSize = 5;
    conf.calibSamples = 20;
    // strlcpy(conf.ssid, "FCJLY", sizeof(conf.ssid));
    // strlcpy(conf.password, "fcj8949008ly", sizeof(conf.password));

    // strlcpy(conf.ssid, "ccclubs", sizeof(conf.ssid));
    // strlcpy(conf.password, "88190338", sizeof(conf.password));

    strlcpy(conf.pilotName, "", sizeof(conf.pilotName));
    modified = true;
    write();
}

void Config::handleEeprom(uint32_t currentTimeMs) {
    if (modified && ((currentTimeMs - checkTimeMs) > EEPROM_CHECK_TIME_MS)) {
        checkTimeMs = currentTimeMs;
        write();
    }
}
