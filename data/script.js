const bcf = document.getElementById("bandChannelFreq");
const bandSelect = document.getElementById("bandSelect");
const channelSelect = document.getElementById("channelSelect");
const freqOutput = document.getElementById("freqOutput");
const announcerSelect = document.getElementById("announcerSelect");
const announcerRateInput = document.getElementById("rate");
const enterRssiInput = document.getElementById("enter");
const exitRssiInput = document.getElementById("exit");
const enterRssiSpan = document.getElementById("enterSpan");
const exitRssiSpan = document.getElementById("exitSpan");
const pilotNameInput = document.getElementById("pname");
const ssidInput = document.getElementById("ssid");
const pwdInput = document.getElementById("pwd")

const lap_driver_name = document.getElementById("lapdrivername");
const lap_driver_name1 = document.getElementById("lapdrivername1");
const laprssifeq = document.getElementById("laprssifeq");

// 存储原始WiFi配置
let originalSsid = "";
let originalPwd = "";
const minLapInput = document.getElementById("minLap");
const alarmThreshold = document.getElementById("alarmThreshold");
const droneSizeSelect = document.getElementById("droneSize");

// ESP32设备的基础URL
// 默认使用相对路径（当从ESP32设备本身提供服务时）
// 如果从本地开发服务器运行，可以通过URL参数覆盖：?esp32ip=20.0.0.1
let esp32BaseUrl = '';

const freqLookup = [
  [5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725],
  [5733, 5752, 5771, 5790, 5809, 5828, 5847, 5866],
  [5705, 5685, 5665, 5645, 5885, 5905, 5925, 5945],
  [5740, 5760, 5780, 5800, 5820, 5840, 5860, 5880],
  [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917],
  [5362, 5399, 5436, 5473, 5510, 5547, 5584, 5621],
];

const config = document.getElementById("config");
const race = document.getElementById("race");
const calib = document.getElementById("calib");
const ota = document.getElementById("ota");

var enterRssi = 120,
  exitRssi = 100;
var frequency = 0;
var announcerRate = 1.0;

var lapNo = -1;
var lapTimes = [];

var timerInterval;
var timerStart = null;
const timer = document.getElementById("timer");
const startRaceButton = document.getElementById("startRaceButton");
const stopRaceButton = document.getElementById("stopRaceButton");

const rssiBuffer = [];
var rssiValue = 0;
var rssiSending = false;
var rssiChart;
var crossing = false;
var rssiSeries = new TimeSeries();
var rssiCrossingSeries = new TimeSeries();
var r1Series = new TimeSeries();
var maxRssiValue = enterRssi + 10;
var minRssiValue = exitRssi - 10;
var r1Chart = null;
var lastEnterTime = null; // seconds since race start of the last 'enter'

var audioEnabled = false;
var speakObjsQueue = [];

// 自动校准逻辑
let calibMaxNoise = 0;
let calibMaxPeak = 0;
let calibPollInterval = null;
let autoCalibrationInProgress = false;
let calibLiveMaxNoise = 0;
let autoCalibrationMeasuring = false;
let autoCalibrationStopTimeout = null;

function pushNotice(message, kind = "info", timeoutMs = 2500) {
  let container = document.getElementById("global-error-display");
  if (!container) {
    container = document.createElement("div");
    container.id = "global-error-display";
    container.style.position = "fixed";
    container.style.top = "10px";
    container.style.right = "10px";
    container.style.zIndex = "9999";
    container.style.maxWidth = "400px";
    document.body.appendChild(container);
  }

  const colors = {
    info: { bg: "#1e3a8a", fg: "#ffffff" },
    success: { bg: "#166534", fg: "#ffffff" },
    warn: { bg: "#92400e", fg: "#ffffff" },
    error: { bg: "#991b1b", fg: "#ffffff" },
  };
  const c = colors[kind] || colors.info;

  const el = document.createElement("div");
  el.textContent = message;
  el.style.background = c.bg;
  el.style.color = c.fg;
  el.style.padding = "10px 12px";
  el.style.marginTop = "8px";
  el.style.borderRadius = "8px";
  el.style.boxShadow = "0 6px 18px rgba(0,0,0,0.18)";
  el.style.fontSize = "14px";
  el.style.lineHeight = "18px";
  el.style.wordBreak = "break-word";
  container.appendChild(el);

  if (timeoutMs > 0) {
    window.setTimeout(() => {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }, timeoutMs);
  }
}

function computeRecommendedEnterExit(maxNoise) {
  const droneSize = parseInt(droneSizeSelect.value);
  const enterRatio = droneSize === 1 ? 0.5 : 0.6;
  const exitRatio = droneSize === 1 ? 0.2 : 0.3;

  const estimatedPeak = maxNoise + 40;
  let recEnter = Math.round(maxNoise + (estimatedPeak - maxNoise) * enterRatio);
  let recExit = Math.round(maxNoise + (estimatedPeak - maxNoise) * exitRatio);

  if (recEnter > 255) recEnter = 255;
  if (recExit < 0) recExit = 0;
  if (recEnter <= recExit) {
    if (recExit >= 250) {
      recEnter = 255;
      recExit = 250;
    } else {
      recEnter = recExit + 5;
    }
  }

  return { recEnter, recExit };
}

function applyEnterExitToUi(enter, exit) {
  if (exitRssiInput) exitRssiInput.value = exit;
  updateExitRssi(exitRssiInput, exit);

  if (enterRssiInput) enterRssiInput.value = enter;
  updateEnterRssi(enterRssiInput, enter);
}

// 自动校准函数
window.startAutoCalibration = function () {
  if (autoCalibrationInProgress || autoCalibrationMeasuring) {
    pushNotice("校准正在进行中，请稍候…", "warn");
    return;
  }

  autoCalibrationInProgress = true;
  autoCalibrationMeasuring = true;
  document.getElementById("calibStep1").style.display = "none";
  document.getElementById("calibStep2").style.display = "block";
  document.getElementById("calibStep3").style.display = "none";
  calibMaxNoise = 0;
  calibLiveMaxNoise = 0;

  // 更新校准步骤中的飞机大小信息
  updateCalibDroneSizeInfo();

  console.log("开始自动校准...");
  const startAutoCalibBtn = document.getElementById("startAutoCalibBtn");
  if (startAutoCalibBtn) startAutoCalibBtn.disabled = true;
  // update calib control states
  if (typeof setCalibButtonsState === 'function') setCalibButtonsState('measuring');

  // 开始测量底噪
  fetch(esp32BaseUrl + "/calibration/noise/start", { method: "POST" })
    .then(r => r.json())
    .then(data => {
      console.log("开始测量底噪");
      // Poll current RSSI to show progress
      calibPollInterval = setInterval(() => {
        document.getElementById("calibNoiseVal").innerText = rssiValue;
        calibLiveMaxNoise = Math.max(calibLiveMaxNoise, rssiValue);
        const { recEnter, recExit } = computeRecommendedEnterExit(calibLiveMaxNoise);
        applyEnterExitToUi(recEnter, recExit);

        const resNoiseElement = document.getElementById("resNoise");
        const recEnterElement = document.getElementById("recEnter");
        const recExitElement = document.getElementById("recExit");
        if (resNoiseElement) resNoiseElement.innerText = calibLiveMaxNoise;
        if (recEnterElement) {
          recEnterElement.innerText = recEnter;
          recEnterElement.dataset.val = recEnter;
        }
        if (recExitElement) {
          recExitElement.innerText = recExit;
          recExitElement.dataset.val = recExit;
        }
      }, 100);

      // 等待5秒后自动停止测量底噪
      if (autoCalibrationStopTimeout) window.clearTimeout(autoCalibrationStopTimeout);
      autoCalibrationStopTimeout = window.setTimeout(() => {
        window.stopAutoCalibration();
      }, 5000);
    })
    .catch(error => {
      console.error("开始测量底噪失败:", error);
      pushNotice("开始测量底噪失败，请检查设备连接", "error", 5000);
      resetCalib();
      autoCalibrationInProgress = false;
      autoCalibrationMeasuring = false;
      const startAutoCalibBtn = document.getElementById("startAutoCalibBtn");
      if (startAutoCalibBtn) startAutoCalibBtn.disabled = false;
    });
}

window.stopAutoCalibration = function () {
  if (!autoCalibrationMeasuring) return;
  autoCalibrationMeasuring = false;
  clearInterval(calibPollInterval);
  if (autoCalibrationStopTimeout) {
    window.clearTimeout(autoCalibrationStopTimeout);
    autoCalibrationStopTimeout = null;
  }

  // 停止测量底噪
  fetch(esp32BaseUrl + "/calibration/noise/stop", { method: "POST" })
    .then(r => r.json())
    .then(data => {
      calibMaxNoise = data.maxNoise;
      console.log("底噪测量完成，maxNoise:", calibMaxNoise);

      const { recEnter, recExit } = computeRecommendedEnterExit(calibMaxNoise);

      // 显示校准结果和飞机大小信息
      const resNoiseElement = document.getElementById("resNoise");
      const recEnterElement = document.getElementById("recEnter");
      const recExitElement = document.getElementById("recExit");
      if (resNoiseElement) resNoiseElement.innerText = calibMaxNoise;
      if (recEnterElement) recEnterElement.innerText = recEnter;
      if (recExitElement) recExitElement.innerText = recExit;

      // 显示飞机大小和计时门直径信息
      const calibResultInfoElement = document.getElementById("calibResultInfo");
      if (calibResultInfoElement) {
        const droneSize = parseInt(droneSizeSelect.value);
        const sizeText = droneSize === 1 ? "大飞机 (4米计时门)" : "小飞机 (2米计时门)";
        calibResultInfoElement.innerHTML = `
          <p>当前设置: ${sizeText}</p>
          <p>底噪: ${calibMaxNoise}</p>
          <p>推荐进入阈值: ${recEnter}</p>
          <p>推荐退出阈值: ${recExit}</p>
          <p style="color: #ffa500;">注意：此校准仅基于环境底噪，建议在实际飞行中微调阈值</p>
        `;
      }

      // Store for apply
      if (recEnterElement) recEnterElement.dataset.val = recEnter;
      if (recExitElement) recExitElement.dataset.val = recExit;

      document.getElementById("calibStep2").style.display = "none";
      document.getElementById("calibStep3").style.display = "block";
      pushNotice("底噪测量完成，可直接点击“应用并保存”", "success", 3500);
      autoCalibrationInProgress = false;
      const startAutoCalibBtn = document.getElementById("startAutoCalibBtn");
      if (startAutoCalibBtn) startAutoCalibBtn.disabled = false;
      if (typeof setCalibButtonsState === 'function') setCalibButtonsState('done');
    })
    .catch(error => {
      console.error("停止测量底噪失败:", error);
      pushNotice("测量底噪失败，请重试", "error", 5000);
      resetCalib();
      autoCalibrationInProgress = false;
      const startAutoCalibBtn = document.getElementById("startAutoCalibBtn");
      if (startAutoCalibBtn) startAutoCalibBtn.disabled = false;
    });
}

window.applyAutoCalibration = function (enter, exit) {
  enterRssiInput.value = enter;
  updateEnterRssi(enterRssiInput, enter);

  exitRssiInput.value = exit;
  updateExitRssi(exitRssiInput, exit);

  saveConfig().then(() => {
    pushNotice("校准参数已应用并保存", "success", 3000);
    resetCalib();
    autoCalibrationInProgress = false;
    autoCalibrationMeasuring = false;
    const startAutoCalibBtn = document.getElementById("startAutoCalibBtn");
    if (startAutoCalibBtn) startAutoCalibBtn.disabled = false;
    if (typeof setCalibButtonsState === 'function') setCalibButtonsState('idle');
  }).catch(error => {
    console.error("保存配置失败:", error);
    pushNotice("保存配置失败，请重试", "error", 5000);
    autoCalibrationInProgress = false;
    autoCalibrationMeasuring = false;
    const startAutoCalibBtn = document.getElementById("startAutoCalibBtn");
    if (startAutoCalibBtn) startAutoCalibBtn.disabled = false;
    if (typeof setCalibButtonsState === 'function') setCalibButtonsState('idle');
  });
}

function startCalibNoise() {
  window.startAutoCalibration();
}

function stopCalibNoise() {
  window.stopAutoCalibration();
}

function applyCalib() {
  let enter = parseInt(document.getElementById("recEnter").dataset.val);
  let exit = parseInt(document.getElementById("recExit").dataset.val);
  window.applyAutoCalibration(enter, exit);
}

function updateCalibDroneSizeInfo() {
  const droneSize = parseInt(droneSizeSelect.value);
  const sizeText = droneSize === 1 ? "大飞机 (4米计时门)" : "小飞机 (2米计时门)";

  // 更新所有校准步骤中的飞机大小信息
  document.getElementById("currentDroneSize").innerText = sizeText;
  document.getElementById("currentDroneSize2").innerText = sizeText;
}

function resetCalib() {
  document.getElementById("calibStep1").style.display = "block";
  document.getElementById("calibStep2").style.display = "none";
  document.getElementById("calibStep3").style.display = "none";
  if (calibPollInterval) clearInterval(calibPollInterval);
  calibLiveMaxNoise = 0;
  autoCalibrationMeasuring = false;
  if (autoCalibrationStopTimeout) {
    window.clearTimeout(autoCalibrationStopTimeout);
    autoCalibrationStopTimeout = null;
  }
  const startAutoCalibBtn = document.getElementById("startAutoCalibBtn");
  if (startAutoCalibBtn) startAutoCalibBtn.disabled = false;

  // 重置自动校准状态
  autoCalibrationInProgress = false;

  // 重置时更新飞机大小信息
  updateCalibDroneSizeInfo();
  // reset calib button states
  if (typeof setCalibButtonsState === 'function') setCalibButtonsState('idle');
}

// Manage calibration control buttons' enabled state
function setCalibButtonsState(state) {
  const startBtn = document.getElementById('startAutoCalibBtn');
  const applyBtn = document.getElementById('applyCalibBtn');
  const cancelBtn = document.getElementById('cancelCalibBtn');

  if (state === 'idle') {
    if (startBtn) startBtn.disabled = false;
    if (applyBtn) applyBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
  } else if (state === 'measuring') {
    if (startBtn) startBtn.disabled = true;
    if (applyBtn) applyBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
  } else if (state === 'done') {
    if (startBtn) startBtn.disabled = true;
    if (applyBtn) applyBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  }
}

// 创建错误显示区域
document.addEventListener('DOMContentLoaded', function () {
  if (!document.getElementById('global-error-display')) {
    const errorDiv = document.createElement('div');
    errorDiv.id = 'global-error-display';
    errorDiv.style.position = 'fixed';
    errorDiv.style.top = '10px';
    errorDiv.style.right = '10px';
    errorDiv.style.zIndex = '9999';
    errorDiv.style.maxWidth = '400px';
    document.body.appendChild(errorDiv);
  }

  // 为自动校准按钮添加事件监听器
  const startAutoCalibBtn = document.getElementById('startAutoCalibBtn');
  if (startAutoCalibBtn) {
    startAutoCalibBtn.addEventListener('click', function () {
      console.log('自动校准按钮被点击');
      window.startAutoCalibration();
    });
  }

  // wire apply and cancel controls next to start
  const applyCalibBtn = document.getElementById('applyCalibBtn');
  const cancelCalibBtn = document.getElementById('cancelCalibBtn');
  if (applyCalibBtn) applyCalibBtn.addEventListener('click', function () {
    applyCalib();
  });
  if (cancelCalibBtn) cancelCalibBtn.addEventListener('click', function () {
    resetCalib();
  });

  // initial calib button state
  if (typeof setCalibButtonsState === 'function') setCalibButtonsState('idle');

  // 为OTA iframe添加错误处理
  const otaIframe = document.querySelector('#ota iframe');
  if (otaIframe) {
    otaIframe.addEventListener('load', function () {
      console.log('OTA iframe loaded');
    });

    otaIframe.addEventListener('error', function (e) {
      console.error('OTA iframe error:', e);
    });
  }

  // 动态替换 LOGO 为透明背景版本（支持通过 ?logo=URL 指定图片）
  const logoParam = new URLSearchParams(window.location.search).get('logo');
  const logoImgEl = document.getElementById('logo-img');
  const faviconEl = document.querySelector('link[rel=\"icon\"]');
  const sourceLogoUrl = logoParam || null; // 如未提供，保持现有 favicon

  function chromaKeyToTransparent(img, threshold = 60) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    // 以左上角像素作为背景色
    const r0 = data[0], g0 = data[1], b0 = data[2];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const dist = Math.sqrt((r - r0) * (r - r0) + (g - g0) * (g - g0) + (b - b0) * (b - b0));
      if (dist < threshold) {
        data[i + 3] = 0; // 透明
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  if (sourceLogoUrl && logoImgEl) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        const transparentDataUrl = chromaKeyToTransparent(img, 70);
        logoImgEl.src = transparentDataUrl;
        if (faviconEl) {
          faviconEl.href = transparentDataUrl;
        } else {
          const link = document.createElement('link');
          link.rel = 'icon';
          link.type = 'image/png';
          link.href = transparentDataUrl;
          document.head.appendChild(link);
        }
      } catch (e) {
        console.error('LOGO 透明化失败:', e);
      }
    };
    img.onerror = function (e) {
      console.error('LOGO 加载失败:', e);
    };
    img.src = sourceLogoUrl;
  }
});

window.onload = function (e) {
  config.style.display = "block";
  race.style.display = "none";
  calib.style.display = "none";
  ota.style.display = "none";

  // 检查URL参数中是否有ESP32 IP地址
  // const urlParams = new URLSearchParams(window.location.search);
  // const esp32Ip = urlParams.get('esp32ip');
  esp32BaseUrl = window.location.origin;
  // if (esp32Ip) {
  //   esp32BaseUrl = `http://${esp32Ip}`;
  //   console.log(`使用ESP32 IP地址: ${esp32BaseUrl}`);
  // } else {
  //   esp32BaseUrl = window.location.origin;
  //   console.log('未指定esp32ip，使用当前地址:', esp32BaseUrl);
  // }

  // 设置 OTA iframe 的地址为 esp32BaseUrl/update
  // const otaIframeElem = document.getElementById('ota-iframe');
  // if (otaIframeElem && esp32BaseUrl) {
  //   otaIframeElem.src = esp32BaseUrl + "/update";
  // }

  fetch(esp32BaseUrl + "/config")
    .then((response) => response.json())
    .then((config) => {
      console.log(config);
      setBandChannelIndex(config.freq);
      minLapInput.value = (parseFloat(config.minLap) / 10).toFixed(1);
      updateMinLap(minLapInput, minLapInput.value);
      alarmThreshold.value = (parseFloat(config.alarm) / 10).toFixed(1);
      updateAlarmThreshold(alarmThreshold, alarmThreshold.value);
      announcerSelect.selectedIndex = config.anType;
      announcerRateInput.value = (parseFloat(config.anRate) / 10).toFixed(1);
      updateAnnouncerRate(announcerRateInput, announcerRateInput.value);
      enterRssiInput.value = config.enterRssi;
      updateEnterRssi(enterRssiInput, enterRssiInput.value);
      exitRssiInput.value = config.exitRssi;
      updateExitRssi(exitRssiInput, exitRssiInput.value);
      droneSizeSelect.value = config.droneSize || 0; // 默认小飞机
      pilotNameInput.value = config.name;
      ssidInput.value = config.ssid;
      pwdInput.value = config.pwd;

      // 保存原始WiFi配置
      originalSsid = config.ssid;
      originalPwd = config.pwd;
      populateFreqOutput();
      stopRaceButton.disabled = true;
      startRaceButton.disabled = false;
      clearInterval(timerInterval);
      timer.innerHTML = "00:00:00.000";

      // console.log("config  esp32BaseUrl：="+esp32BaseUrl);
      clearLaps();
      createRssiChart();
      createMiniRssiChart();
      initEventStream();
    })
    .catch(error => {
      console.error('无法连接到ESP32设备:', error);
    });
  // Ensure a default pilot and UI values for quick demo
  if (!pilotNameInput.value || pilotNameInput.value.trim() === "") {
    pilotNameInput.value = "QiYun";
  }
  // If frequency not set by config, default to 5658
  if (!frequency || frequency === 0) {
    frequency = 5658;
    const freqEl = document.getElementById('freqOutput');
    if (freqEl) freqEl.textContent = getBandChannel() + ' ' + frequency;
    const lapRssi = document.getElementById('laprssifeq');
    if (lapRssi) lapRssi.textContent = frequency;
    const r1freq = document.getElementById('r1-frequency');
    if (r1freq) r1freq.innerText = frequency;
  }

  // Ensure pilot row exists in table
  try {
    const pilotKey = `${pilotNameInput.value} - ${getBandChannel()}`;
    if (!pilotData[pilotKey]) {
      pilotData[pilotKey] = { laps: 0, times: [], total: 0, avg: 0, fastest: Infinity, consecutive: 0 };
    }
    updateRaceTable();
  } catch (e) {
    // ignore if DOM not ready
  }
};

function addRssiPoint() {
  if (calib.style.display != "none") {
    if (!rssiChart) {
      createRssiChart();
    }
    if (rssiChart && typeof rssiChart.start === 'function') {
      rssiChart.start();
    }
    if (rssiBuffer.length > 0) {
      rssiValue = parseInt(rssiBuffer.shift());
      if (crossing && rssiValue < exitRssi) {
        crossing = false;
        // 更新过线状态显示
        const crossingStatus = document.getElementById("crossingStatus");
        if (crossingStatus) {
          crossingStatus.innerText = "退出";
        }
        // const r1enter = document.getElementById('r1-enter');
        // if (r1enter) r1enter.innerText = '退出';
      } else if (!crossing && rssiValue > enterRssi) {
        crossing = true;
        // 更新过线状态显示
        const crossingStatus = document.getElementById("crossingStatus");
        if (crossingStatus) {
          crossingStatus.innerText = "进入";
        }
        // const r1enter = document.getElementById('r1-enter');
        // if (r1enter) r1enter.innerText = '进入';
        // 检测到过线，添加语音播报
        if (race.style.display != "none" && audioEnabled) {
          const pilotName = pilotNameInput.value;
          const channel = channelSelect.options[channelSelect.selectedIndex].text;
          const pilotKey = `${pilotName} - ${channel}`;
          queueSpeak(`<p>${pilotKey} 通过</p>`);
        }
      }
      maxRssiValue = Math.max(maxRssiValue, rssiValue);
      minRssiValue = Math.min(minRssiValue, rssiValue);
    }

    // update horizontal lines and min max values
    if (rssiChart && rssiChart.options) {
      rssiChart.options.horizontalLines = [
        { color: "hsl(8.2, 86.5%, 53.7%)", lineWidth: 1.7, value: enterRssi }, // red
        { color: "hsl(25, 85%, 55%)", lineWidth: 1.7, value: exitRssi }, // orange
      ];

      rssiChart.options.maxValue = Math.max(maxRssiValue, enterRssi + 10);

      rssiChart.options.minValue = Math.max(0, Math.min(minRssiValue, exitRssi - 10));
    }

    var now = Date.now();
    rssiSeries.append(now, rssiValue);
    r1Series.append(now, rssiValue);
    if (crossing) {
      rssiCrossingSeries.append(now, 256);
    } else {
      rssiCrossingSeries.append(now, -10);
    }

    // // 更新小图数值显示（race 页面）
    // const r1ValEl = document.getElementById('r1-value');
    // if (r1ValEl) r1ValEl.innerText = rssiValue;

    // 当检测到进入（由 crossing 切换为 true）时，记录圈次逻辑
    if (crossing) {
      handleCrossingEnter();
    }
  } else {
    if (rssiChart && typeof rssiChart.stop === 'function') {
      rssiChart.stop();
    }
    maxRssiValue = enterRssi + 10;
    minRssiValue = exitRssi - 10;
  }
}

setInterval(addRssiPoint, 100);

function createRssiChart() {
  rssiChart = new SmoothieChart({
    responsive: true,
    millisPerPixel: 50,
    grid: {
      strokeStyle: "rgba(255,255,255,0.25)",
      sharpLines: true,
      verticalSections: 0,
      borderVisible: false,
    },
    labels: {
      precision: 0,
    },
    maxValue: 1,
    minValue: 0,
  });
  rssiChart.addTimeSeries(rssiSeries, {
    lineWidth: 1.7,
    strokeStyle: "hsl(214, 53%, 60%)",
    fillStyle: "hsla(214, 53%, 60%, 0.4)",
  });
  rssiChart.addTimeSeries(rssiCrossingSeries, {
    lineWidth: 1.7,
    strokeStyle: "none",
    fillStyle: "hsla(136, 71%, 70%, 0.3)",
  });
  rssiChart.streamTo(document.getElementById("rssiChart"), 100);
}

function createMiniRssiChart() {
  try {
    r1Chart = new SmoothieChart({
      responsive: true,
      millisPerPixel: 40,
      grid: { strokeStyle: "rgba(255,255,255,0.12)", sharpLines: true, verticalSections: 0, borderVisible: false },
      labels: { precision: 0 },
      maxValue: 255,
      minValue: 0,
    });
    r1Chart.addTimeSeries(r1Series, { lineWidth: 2, strokeStyle: "hsl(14,85%,55%)", fillStyle: "rgba(255,120,0,0.15)" });
    r1Chart.streamTo(document.getElementById('r1Chart'), 100);
  } catch (e) {
    console.error('createMiniRssiChart error', e);
  }
}

function handleCrossingEnter() {
  // Only count when race started
  if (!timerStart) return;
  const nowSecs = parseTimerToSeconds(timer.innerHTML);
  
  if (lastEnterTime === null) {
    // first enter -> mark as lap 0 and record it immediately (no minLap restriction)
    lastEnterTime = nowSecs;
    lapNo = 0;
    // Record the initial lap time as lap 0 when race is running
    if (startRaceButton.disabled) {
      addLap(nowSecs.toFixed(3));
    }
    // show informational notice briefly
    pushNotice('首次进入 (第0圈)', 'info', 1200);
    return;
  }
  // subsequent enters -> compute delta to previous enter
  const delta = nowSecs - lastEnterTime;
  lastEnterTime = nowSecs;
  lapNo = (lapNo === -1) ? 1 : lapNo + 1;
  // 只在计时进行时才记录成绩
  if (startRaceButton.disabled) {
    addLap(delta.toFixed(3));
  }
}

function refreshNodes() {
  const listEl = document.getElementById("nodes-list");
  if (!listEl) return;
  fetch(esp32BaseUrl + "/nodes")
    .then(r => r.json())
    .then(data => {
      const arr = data.nodes || [];
      listEl.innerHTML = arr.map(n => {
        const host = n.host || '';
        const ip = n.ip || '';
        const product = n.product || '';
        const mac = n.mac || '';
        return `<div>${product} ${host} (${ip}) ${mac}</div>`;
      }).join('') || '<div>未发现设备</div>';
    })
    .catch(e => {
      listEl.innerHTML = '<div>节点读取失败</div>';
      console.error(e);
    });
}

function openTab(evt, tabName) {
  // Declare all variables
  var i, tabcontent, tablinks;

  // Get all elements with class="tabcontent" and hide them
  tabcontent = document.getElementsByClassName("tabcontent");
  for (i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = "none";
  }

  // Get all elements with class="tablinks" and remove the class "active"
  tablinks = document.getElementsByClassName("tablinks");
  for (i = 0; i < tablinks.length; i++) {
    tablinks[i].className = tablinks[i].className.replace(" active", "");
  }

  // Show the current tab, and add an "active" class to the button that opened the tab
  document.getElementById(tabName).style.display = "block";
  evt.currentTarget.className += " active";

  // if event comes from calibration or race tab, signal to start sending RSSI events
  if ((tabName === "calib" || tabName === "race") && !rssiSending) {
    fetch(esp32BaseUrl + "/timer/rssiStart", {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    })
      .then((response) => {
        if (response.ok) rssiSending = true;
        return response.json();
      })
      .then((response) => console.log("/timer/rssiStart:" + JSON.stringify(response)));
  } else if (rssiSending) {
    fetch(esp32BaseUrl + "/timer/rssiStop", {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    })
      .then((response) => {
        if (response.ok) rssiSending = false;
        return response.json();
      })
      .then((response) => console.log("/timer/rssiStop:" + JSON.stringify(response)));
  }
}

function updateEnterRssi(obj, value) {
  enterRssi = parseInt(value);
  if (enterRssiSpan) {
    enterRssiSpan.textContent = enterRssi;
  }
  if (enterRssi <= exitRssi) {
    exitRssi = Math.max(0, enterRssi - 1);
    if (exitRssiInput) {
      exitRssiInput.value = exitRssi;
    }
    if (exitRssiSpan) {
      exitRssiSpan.textContent = exitRssi;
    }
  }
}

function updateExitRssi(obj, value) {
  exitRssi = parseInt(value);
  if (exitRssiSpan) {
    exitRssiSpan.textContent = exitRssi;
  }
  if (exitRssi >= enterRssi) {
    enterRssi = Math.min(255, exitRssi + 1);
    if (enterRssiInput) {
      enterRssiInput.value = enterRssi;
    }
    if (enterRssiSpan) {
      enterRssiSpan.textContent = enterRssi;
    }
  }
}

function saveConfig() {
  const currentSsid = ssidInput.value;
  const currentPwd = pwdInput.value;
  const wifiChanged = currentSsid !== originalSsid || currentPwd !== originalPwd;

  if (startRaceButton.disabled) {
    stopRace();
    clearLaps();
  }

  return fetch(esp32BaseUrl + "/config", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      freq: frequency,
      minLap: parseInt(minLapInput.value * 10),
      alarm: parseInt(alarmThreshold.value * 10),
      anType: announcerSelect.selectedIndex,
      anRate: parseInt(announcerRate * 10),
      enterRssi: enterRssi,
      exitRssi: exitRssi,
      droneSize: parseInt(droneSizeSelect.value),
      name: pilotNameInput.value,
      ssid: currentSsid,
      pwd: currentPwd,
    }),
  })
    .then((response) => response.json())
    .then((response) => {
      console.log("/config:" + JSON.stringify(response));

      // 更新原始WiFi配置
      originalSsid = currentSsid;
      originalPwd = currentPwd;

      // const lap_rssi_feq = document.getElementById("laprssifeq");
      // if (lap_rssi_feq) {
      //   lap_rssi_feq.innerText = frequency;
      // }


      // 如果WiFi设置已更改，提示设备将自动重启
      if (wifiChanged) {
        pushNotice("配置已保存，设备将自动重启以应用新的WiFi设置。", "warn", 8000);

        // 发送重启请求
        fetch(esp32BaseUrl + "/save_and_restart", {
          method: "POST",
          headers: {
            Accept: "application/json",
          },
        });
      } else {
        pushNotice("配置已保存", "success", 2500);
      }


    })
    .catch((error) => {
      console.error("Error saving config:", error);
      pushNotice("保存配置失败，请重试", "error", 5000);
    });
}

// 移除saveAndRestartConfig函数，不再需要

function populateFreqOutput() {
  let band = bandSelect.options[bandSelect.selectedIndex].value;
  let chan = channelSelect.options[channelSelect.selectedIndex].value;
  frequency = freqLookup[bandSelect.selectedIndex][channelSelect.selectedIndex];
  freqOutput.textContent = band + chan + " " + frequency;

  lap_driver_name.textContent = band + chan;
  laprssifeq.textContent = frequency;

  lap_driver_name1.textContent = band + chan;
  // update R1 frequency display if present
  // const r1freq = document.getElementById('r1-frequency');
  // if (r1freq) r1freq.innerText = frequency;

}

function getFreqOutput() {
  return freqOutput.textContent;
}

function getBandChannel() {
  let band = bandSelect.options[bandSelect.selectedIndex].value;
  let chan = channelSelect.options[channelSelect.selectedIndex].value;
  return band + chan;
}

bcf.addEventListener("change", function handleChange(event) {
  populateFreqOutput();
});

function updateAnnouncerRate(obj, value) {
  announcerRate = parseFloat(value);
  $(obj).parent().find("span").text(announcerRate.toFixed(1));
}

function updateMinLap(obj, value) {
  $(obj).parent().find("span").text(parseFloat(value).toFixed(1) + "秒");
}

function updateAlarmThreshold(obj, value) {
  $(obj).parent().find("span").text(parseFloat(value).toFixed(1) + "伏");
}

// function getAnnouncerVoices() {
//   $().articulate("getVoices", "#voiceSelect", "System Default Announcer Voice");
// }

function beep(duration, frequency, type) {
  var context = new AudioContext();
  var oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  oscillator.connect(context.destination);
  oscillator.start();
  // Beep for 500 milliseconds
  setTimeout(function () {
    oscillator.stop();
  }, duration);
}

// 车手数据对象
let pilotData = {
  // "- - -": { laps: 0, times: [], total: 0, avg: 0, fastest: Infinity, consecutive: 0 }
};

function addLap(lapStr) {
  const pilotName = pilotNameInput.value || "-";
  const band = bandSelect.options[bandSelect.selectedIndex].text || "-";
  const channel = channelSelect.options[channelSelect.selectedIndex].text || "-";
  const pilotKey = `${pilotName} - ${band}${channel}`;

  const newLap = parseFloat(lapStr);

  // 确保车手数据存在
  if (!pilotData[pilotKey]) {
    pilotData[pilotKey] = { laps: 0, times: [], total: 0, avg: 0, fastest: Infinity, consecutive: 0 };
  }

  const pilot = pilotData[pilotKey];
  pilot.laps += 1;
  pilot.times.push(newLap);
  pilot.total += newLap;
  pilot.avg = (pilot.total / pilot.laps).toFixed(3);

  // 更新最快圈速
  if (newLap < pilot.fastest) {
    pilot.fastest = newLap;
  }

  // 更新连续圈数
  pilot.consecutive += 1;

  // 更新统计表格
  updateRaceTable();

  // 添加到每圈成绩列表
  addLapToUI(newLap);

  // 语音播报
  switch (announcerSelect.options[announcerSelect.selectedIndex].value) {
    case "beep":
      beep(100, 330, "square");
      break;
    case "1lap":
      const lapNoStr = pilotKey + " 第 " + pilot.laps + " 圈, ";
      const text = "<p>" + lapNoStr + lapStr.replace(".", ",") + "秒</p>";
      queueSpeak(text);
      break;
    case "2lap":
      if (pilot.laps >= 2) {
        const last2lap = (pilot.times[pilot.times.length - 1] + pilot.times[pilot.times.length - 2]).toFixed(3);
        const text2 = "<p>" + pilotKey + " 两圈累计 " + last2lap.replace(".", ",") + "秒</p>";
        queueSpeak(text2);
      }
      break;
    case "3lap":
      if (pilot.laps >= 3) {
        const last3lap = (pilot.times[pilot.times.length - 1] + pilot.times[pilot.times.length - 2] + pilot.times[pilot.times.length - 3]).toFixed(3);
        const text3 = "<p>" + pilotKey + " 三圈累计 " + last3lap.replace(".", ",") + "秒</p>";
        queueSpeak(text3);
      }
      break;
    default:
      break;
  }
}

// 添加圈数到UI
function addLapToUI(lapTime) {
  const lapTimesList = document.getElementById("lapTimesList");
  if (!lapTimesList) return;

  // 创建新的圈数项
  const lapItem = document.createElement("div");
  lapItem.className = "lap-time-item";

  // 格式化时间为mm:ss.xxx格式
  const minutes = Math.floor(lapTime / 60);
  const seconds = Math.floor(lapTime % 60);
  const milliseconds = Math.floor((lapTime * 1000) % 1000);
  const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;

  lapItem.innerHTML = `
    <div class="time">${formattedTime}</div>
    <button class="remove-btn" onclick="removeLap(this)">×</button>
  `;

  // 添加到列表末尾
  lapTimesList.appendChild(lapItem);

  // 自动滚动到新添加的圈数（平滑滚动）
  try {
    lapItem.scrollIntoView({ behavior: 'smooth', block: 'end' });
  } catch (e) {
    // fallback: set scrollTop
    lapTimesList.scrollTop = lapTimesList.scrollHeight;
  }
}

// 手动添加圈数
function addManualLap() {
  // 这里可以根据实际情况获取当前圈速，这里简单使用模拟值
  if (startRaceButton.disabled) {
    const secs = parseTimerToSeconds(timer.innerHTML);
    if (!isNaN(secs)) {
      addLap(secs.toFixed(3));
    }
  }
}

// parse timer text like HH:MM:SS.mmm or MM:SS.mmm to seconds (float)
function parseTimerToSeconds(text) {
  if (!text || typeof text !== 'string') return NaN;
  // remove any trailing non-digit characters
  text = text.trim();
  // expected formats: HH:MM:SS.mmm or MM:SS.mmm
  const parts = text.split(':');
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const s = parseFloat(parts[2]) || 0;
    return h * 3600 + m * 60 + s;
  } else if (parts.length === 2) {
    const m = parseInt(parts[0], 10) || 0;
    const s = parseFloat(parts[1]) || 0;
    return m * 60 + s;
  }
  // fallback: try parseFloat
  const f = parseFloat(text);
  return isNaN(f) ? NaN : f;
}
// 移除单个圈数
function removeLap(btn) {
  const lapItem = btn.parentElement;
  const lapTimesList = document.getElementById("lapTimesList");
  if (!lapItem || !lapTimesList) return;

  // 从DOM中移除
  lapTimesList.removeChild(lapItem);

  // 这里应该更新pilotData数据，由于时间格式不同，这里简化处理
  // 在实际应用中，需要解析时间并从pilotData中移除对应数据
}

// 清除所有圈数
function clearLaps() {
  const pilotName = pilotNameInput.value || "-";
  const band = bandSelect.options[bandSelect.selectedIndex].text || "-";
  const channel = channelSelect.options[channelSelect.selectedIndex].text || "-";
  const pilotKey = `${pilotName} - ${band}${channel}`;
  // 重置车手数据
  if (!pilotData[pilotKey]) {
    pilotData[pilotKey] = { laps: 0, times: [], total: 0, avg: 0, fastest: Infinity, consecutive: 0 };
  }

  // 更新统计表格
  updateRaceTable();

  // 清空每圈成绩列表
  const lapTimesList = document.getElementById("lapTimesList");
  if (lapTimesList) {
    lapTimesList.innerHTML = "";
  }

  // 重置圈数变量
  lapNo = -1;
  lapTimes = [];
  lastEnterTime = null;
}

// 清空所有比赛结果（包括所有飞手数据）
function clearAllResults() {
  pilotData = {};
  const lapTimesList = document.getElementById("lapTimesList");
  if (lapTimesList) lapTimesList.innerHTML = "";
  lapNo = -1;
  lapTimes = [];
  lastEnterTime = null;
  updateRaceTable();
}

function updateRaceTable() {
  const table = document.getElementById("lapTable");
  const tbody = table.querySelector("tbody");

  // 清空表格内容（保留表头）
  while (tbody.firstChild) {
    tbody.removeChild(tbody.firstChild);
  }

  // 仅显示当前选中的飞手（根据输入的姓名和频段/频道）
  const pilotName = pilotNameInput.value || "-";
  const bandchan = getBandChannel();
  const currentKey = `${pilotName} - ${bandchan}`;

  let pilot = pilotData[currentKey];
  // 如果没有当前飞手的数据，显示一行默认空数据
  if (!pilot) {
    pilot = { laps: 0, times: [], total: 0, avg: 0, fastest: Infinity, consecutive: 0 };
  }

  const row = tbody.insertRow();
  const cell1 = row.insertCell(0);
  const cell2 = row.insertCell(1);
  const cell3 = row.insertCell(2);
  const cell4 = row.insertCell(3);
  const cell5 = row.insertCell(4);
  const cell6 = row.insertCell(5);

  cell1.innerHTML = pilotName;
  cell2.innerHTML = pilot.laps;
  cell3.innerHTML = pilot.total > 0 ? pilot.total.toFixed(3) + " 秒" : "-";
  cell4.innerHTML = pilot.avg > 0 ? pilot.avg + " 秒" : "-";
  if (pilot.fastest !== Infinity) {
    cell5.innerHTML = pilot.fastest.toFixed(3) + " 秒";
    cell5.classList.add("fastest-lap");
  } else {
    cell5.innerHTML = "-";
  }
  cell6.innerHTML = pilot.consecutive;
}

function startTimer() {
  // Use real elapsed time based on Date.now()
  timerStart = Date.now();
  timerInterval = setInterval(function () {
    var elapsed = Date.now() - timerStart;
    var ms = Math.floor(elapsed % 1000);
    var seconds = Math.floor((elapsed / 1000) % 60);
    var minutes = Math.floor((elapsed / 60000) % 60);
    var hours = Math.floor(elapsed / 3600000);
    var h = hours < 10 ? "0" + hours : hours;
    var m = minutes < 10 ? "0" + minutes : minutes;
    var s = seconds < 10 ? "0" + seconds : seconds;
    var msStr = ms.toString().padStart(3, "0");
    timer.innerHTML = `${h}:${m}:${s}.${msStr}`;
  }, 50);

  fetch(esp32BaseUrl + "/timer/start", {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
  })
    .then((response) => response.json())
    .then((response) => console.log("/timer/start:" + JSON.stringify(response)));
}

function queueSpeak(obj) {
  if (!audioEnabled) {
    return;
  }
  speakObjsQueue.push(obj);

  enableAudioLoop();
}

async function enableAudioLoop() {
  audioEnabled = true;
  while (audioEnabled) {
    if (speakObjsQueue.length > 0) {
      let isSpeakingFlag = $().articulate('isSpeaking');
      if (!isSpeakingFlag) {
        let obj = speakObjsQueue.shift();
        doSpeak(obj);
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

function disableAudioLoop() {
  audioEnabled = false;
}
function generateAudio() {
  if (!audioEnabled) {
    return;
  }

  const pilotName = pilotNameInput.value;
  const channel = channelSelect.options[channelSelect.selectedIndex].text;
  const pilotKey = `${pilotName} - ${channel}`;
  queueSpeak('<div>测试语音：车手 ' + pilotKey + '</div>');
  for (let i = 1; i <= 3; i++) {
    queueSpeak('<div>' + i + '</div>')
  }
}

function doSpeak(obj) {
  $(obj).articulate("rate", announcerRate).articulate('speak');
}

async function startRace() {
  //stopRace();
  startRaceButton.disabled = true;
  clearLaps();
  lastEnterTime = null;
  queueSpeak('<p>比赛即将开始</p>');
  await new Promise((r) => setTimeout(r, 2000));
  beep(1, 1, "square"); // needed for some reason to make sure we fire the first beep
  beep(100, 440, "square");
  await new Promise((r) => setTimeout(r, 1000));
  beep(100, 440, "square");
  await new Promise((r) => setTimeout(r, 1000));
  beep(500, 880, "square");
  startTimer();
  stopRaceButton.disabled = false;
}

function stopRace() {
  queueSpeak('<p>比赛已结束</p>');
  clearInterval(timerInterval);
  timerStart = null;
  timer.innerHTML = "00:00:00.000";
  lastEnterTime = null;

  fetch(esp32BaseUrl + "/timer/stop", {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
  })
    .then((response) => response.json())
    .then((response) => console.log("/timer/stop:" + JSON.stringify(response)));

  stopRaceButton.disabled = true;
  startRaceButton.disabled = false;
}

function confirmClear() {
  // 确认清空所有成绩
  const ok = confirm("确认清空所有成绩与圈数？此操作不可撤销。");
  if (ok) {
    stopRace();
    clearAllResults();
    pushNotice("所有成绩已清空", "success", 2000);
  }
}



function initEventStream() {
  console.log("events  esp32BaseUrl：=" + esp32BaseUrl);
  if (!window.EventSource || !esp32BaseUrl) return;
  var source = new EventSource(esp32BaseUrl + "/events");

  source.addEventListener(
    "open",
    function (e) {
      console.log("events open esp32BaseUrl：=" + esp32BaseUrl);
      console.log("Events Connected");
    },
    false
  );

  source.addEventListener(
    "error",
    function (e) {
      console.log("events error  esp32BaseUrl：=" + esp32BaseUrl);
      if (e.target.readyState != EventSource.OPEN) {
        console.log("Events Disconnected");
      }
    },
    false
  );

  source.addEventListener(
    "rssi",
    function (e) {
      rssiBuffer.push(e.data);
      if (rssiBuffer.length > 10) {
        rssiBuffer.shift();
      }
      console.log("rssi", e.data, "buffer size", rssiBuffer.length);
    },
    false
  );

  source.addEventListener(
    "lap",
    function (e) {
      var lap = (Number(e.data) / 1000).toFixed(3);
      addLap(lap);
      console.log("lap raw:", e.data, " formatted:", lap);
    },
    false
  );
}

function setBandChannelIndex(freq) {
  for (var i = 0; i < freqLookup.length; i++) {
    for (var j = 0; j < freqLookup[i].length; j++) {
      if (freqLookup[i][j] == freq) {
        bandSelect.selectedIndex = i;
        channelSelect.selectedIndex = j;
      }
    }
  }
}
