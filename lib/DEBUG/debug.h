#pragma once

#include <Arduino.h>

#define SERIAL_BAUD 115200
#define DEBUG_OUT Serial

// 格式化时间戳 (毫秒 -> HH:MM:SS.mmm)
#define TIMESTAMP() do { \
  unsigned long ms = millis(); \
  unsigned long s = ms / 1000; \
  unsigned long m = s / 60; \
  unsigned long h = m / 60; \
  ms %= 1000; \
  s %= 60; \
  m %= 60; \
  h %= 24; \
  DEBUG_OUT.printf("[%02lu:%02lu:%02lu.%03lu] ", h, m, s, ms); \
} while(0)

#ifdef DEBUG_OUT
#define DEBUG_INIT DEBUG_OUT.begin(SERIAL_BAUD);
#define DEBUG(...) do { \
  TIMESTAMP(); \
  DEBUG_OUT.printf(__VA_ARGS__); \
} while(0)
#else
#define DEBUG_INIT
#define DEBUG(...)
#endif