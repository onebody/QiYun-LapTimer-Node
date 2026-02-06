// 延迟初始化DOM元素，避免在某些页面（如OTA页面）中因元素不存在而导致错误
let bcf, bandSelect, channelSelect, freqOutput, announcerSelect, announcerRateInput;
let enterRssiInput, exitRssiInput, enterRssiSpan, exitRssiSpan, droneSizeSelect;
let gateDiameterDisplay, calibSamplesInput, pilotNameInput, ssidInput, pwdInput;
let minLapInput, alarmThreshold;

// 在DOM加载完成后初始化元素
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeDOMElements();
    fetchFirmwareVersion();
  });
} else {
  initializeDOMElements();
  fetchFirmwareVersion();
}

// 获取并显示固件版本号
function fetchFirmwareVersion() {
  // 获取版本号显示元素
  const versionElement = document.getElementById('firmware-version');
  if (!versionElement) return;

  // 发送请求获取版本号
  fetch('/version')
    .then(response => response.json())
    .then(data => {
      if (data && data.version) {
        // 在"杭州骑云"后面显示版本号
        versionElement.textContent = ` v${data.version}`;
      }
    })
    .catch(error => {
      console.error('获取固件版本号失败:', error);
    });
}

function initializeDOMElements() {
  // 确保lapNo和lapTimes有正确的初始值
  window.lapNo = 0;
  window.lapTimes = [];

  bcf = document.getElementById("bandChannelFreq");
  bandSelect = document.getElementById("bandSelect");
  channelSelect = document.getElementById("channelSelect");
  freqOutput = document.getElementById("freqOutput");
  announcerSelect = document.getElementById("announcerSelect");
  announcerRateInput = document.getElementById("rate");
  enterRssiInput = document.getElementById("enter");
  exitRssiInput = document.getElementById("exit");
  enterRssiSpan = document.getElementById("enterSpan");
  exitRssiSpan = document.getElementById("exitSpan");
  droneSizeSelect = document.getElementById("droneSizeSelect");
  gateDiameterDisplay = document.getElementById("gateDiameterDisplay");
  calibSamplesInput = document.getElementById("calibSamples");
  pilotNameInput = document.getElementById("pname");
  pilotIdInput = document.getElementById("pilotId");
  apiAddressInput = document.getElementById("apiAddress");
  ssidInput = document.getElementById("ssid");
  pwdInput = document.getElementById("pwd");
  minLapInput = document.getElementById("minLap");
  alarmThreshold = document.getElementById("alarmThreshold");

  // 添加事件监听器
  if (bcf) {
    bcf.addEventListener("change", function handleChange(event) {
      populateFreqOutput();
    });
  }

  // 添加播报类型和速率的事件监听器
  if (announcerSelect) {
    announcerSelect.addEventListener("change", function handleChange(event) {
      // 保存选择的播报类型到localStorage
      localStorage.setItem("announcerType", announcerSelect.selectedIndex);
      // 如果选择了非关闭的播报类型，自动启用语音功能
      if (announcerSelect.selectedIndex != 0 && !audioEnabled) {
        enableAudioLoop();
      }
    });
  }

  if (announcerRateInput) {
    announcerRateInput.addEventListener("input", function handleInput(event) {
      // 实时更新播报速率变量
      updateAnnouncerRate(announcerRateInput, announcerRateInput.value);
    });
  }
}

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

// 浮窗提示函数
function showToast(message, type = 'info', duration = 3000) {
  const toastContainer = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}

// 全局覆盖alert函数，将所有alert转换为浮窗提示
window.alert = function (message) {
  showToast(message, 'info');
};

var enterRssi = 120,
  exitRssi = 100;
var frequency = 0;
var announcerRate = 1.0;

var lapNo = 0;
var lapTimes = [];

var timerInterval;
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
var maxRssiValue = enterRssi + 10;
var minRssiValue = exitRssi - 10;

var audioEnabled = false;
var speakObjsQueue = [];

// Remember original WiFi settings loaded from device so we can detect changes
let originalSsid = "";
let originalPwd = "";

let calibMaxNoise = 0;
let calibMaxPeak = 0;
let calibPollInterval = null;
let calibNoiseSamples = 0;
let calibCrossingSamples = 0;
let calibTargetSamples = 20;

function getSelectedDroneSize() {
  const v = parseInt(droneSizeSelect?.value || "5");
  return v === 2 ? 2 : 5;
}

function getGateDiameterMm(droneSize) {
  return droneSize === 2 ? 1000 : 2000;
}

function getCalibrationSamplesTarget() {
  let v = parseInt(calibSamplesInput?.value || "20");
  if (!Number.isFinite(v)) v = 20;
  if (v < 10) v = 10;
  if (v > 200) v = 200;
  if (calibSamplesInput) calibSamplesInput.value = String(v);
  return v;
}

function updateGateDiameterUi() {
  const droneSize = getSelectedDroneSize();
  const diameterMm = getGateDiameterMm(droneSize);
  if (gateDiameterDisplay) {
    gateDiameterDisplay.textContent = (diameterMm / 1000).toFixed(1) + " 米";
  }
}

function clamp(v, minV, maxV) {
  if (v < minV) return minV;
  if (v > maxV) return maxV;
  return v;
}

function getCalibrationTuning(droneSize) {
  // 获取用户设置的降低量百分比（默认为30%）
  const dropPercentageEl = document.getElementById('calibDropPercentage');
  const dropPercentage = dropPercentageEl ? parseFloat(dropPercentageEl.value) / 100 : 0.3;

  const diameterM = getGateDiameterMm(droneSize) / 1000;
  const diameterRatio = diameterM / 1.5; // 归一化到标准3米直径

  // 基于用户设置的百分比和计时门直径计算进入和退出比例
  // 计时门直径越小，要求进入和退出比例越高，以确保只有在门内才能检测到信号
  const enterBaseRatio = clamp(1 - dropPercentage * 0.7, 0.55, 0.8);
  const exitBaseRatio = clamp(1 - dropPercentage * 1.3, 0.2, 0.7);

  // 直径校正因子：直径越小，校正因子越大，要求信号强度更高
  const diameterCorrection = 1.0 + (1.0 - diameterRatio) * 0.3;
  const enterRatio = clamp(enterBaseRatio * diameterCorrection, 0.65, 0.9);
  const exitRatio = clamp(exitBaseRatio * diameterCorrection, 0.3, 0.8);

  // 基于计时门直径计算最小RSSI变化量
  // 直径越小，需要的RSSI变化量越大，以确保信号来自门内
  // 降低要求以提高检测灵敏度，与后端保持一致
  const minDelta = clamp(Math.round(25 * (1.5 / diameterM)), 10, 35);
  const estimatedDelta = clamp(minDelta + 15, 20, 50);
  return { enterRatio, exitRatio, minDelta, estimatedDelta };
}

function computeRecommendedEnterExit(noise, peak, droneSize) {
  const tuning = getCalibrationTuning(droneSize);
  const deltaRaw = (peak == null ? tuning.estimatedDelta : Math.max(0, peak - noise));

  // 确保RSSI变化量至少达到与计时门直径相关的最小阈值
  // 只有当信号变化足够大时，才会检测到过线，确保在计时门直径范围内
  const effectiveDelta = Math.max(deltaRaw, tuning.minDelta);

  let recEnter = Math.round(noise + effectiveDelta * tuning.enterRatio);
  let recExit = Math.round(noise + effectiveDelta * tuning.exitRatio);

  recEnter = clamp(recEnter, 0, 255);
  recExit = clamp(recExit, 0, 255);

  // 确保进入阈值大于退出阈值，并保持适当的差距
  if (recEnter <= recExit) {
    recEnter = clamp(recExit + 10, 0, 255);
  }

  return {
    enter: recEnter,
    exit: recExit,
    delta: peak == null ? deltaRaw : peak - noise,
    minDelta: tuning.minDelta,
  };
}

function updateLiveRecommendation(prefix, rec) {
  const enterEl = document.getElementById(prefix === "noise" ? "liveRecEnterNoise" : "liveRecEnterCrossing");
  const exitEl = document.getElementById(prefix === "noise" ? "liveRecExitNoise" : "liveRecExitCrossing");
  if (enterEl) enterEl.textContent = rec.enter;
  if (exitEl) exitEl.textContent = rec.exit;
}

// 更新调节滑块的值
function updateSliderValues(enter, exit) {
  if (enterRssiInput) {
    enterRssiInput.value = enter;
    updateEnterRssi(enterRssiInput, enter);
  }
  if (exitRssiInput) {
    exitRssiInput.value = exit;
    updateExitRssi(exitRssiInput, exit);
  }
}

// 切换高级设置显示
function toggleAdvancedSettings() {
  const advancedConfig = document.getElementById('advancedConfig');
  const toggleIcon = document.getElementById('advancedToggle');
  if (advancedConfig) {
    if (advancedConfig.classList.contains('hidden')) {
      advancedConfig.classList.remove('hidden');
      if (toggleIcon) toggleIcon.textContent = '▲';
    } else {
      advancedConfig.classList.add('hidden');
      if (toggleIcon) toggleIcon.textContent = '▼';
    }
  }
}

// 新的自动校准函数
function startCalib() {
  // 更新当前设置显示
  updateCurrentSettings();

  // 添加元素存在性检查，避免在某些页面中因元素不存在而导致错误
  const calibStep1El = document.getElementById("calibStep1");
  const calibStep2El = document.getElementById("calibStep2");
  const calibNoiseTargetEl = document.getElementById("calibNoiseTarget");
  const calibNoiseSamplesEl = document.getElementById("calibNoiseSamples");
  const liveRecEnterNoiseEl = document.getElementById("liveRecEnterNoise");
  const liveRecExitNoiseEl = document.getElementById("liveRecExitNoise");

  if (calibStep1El) calibStep1El.style.display = "none";
  if (calibStep2El) calibStep2El.style.display = "block";

  calibMaxNoise = 0;
  calibNoiseSamples = 0;
  calibTargetSamples = getCalibrationSamplesTarget();

  if (calibNoiseTargetEl) calibNoiseTargetEl.innerText = calibTargetSamples;
  if (calibNoiseSamplesEl) calibNoiseSamplesEl.innerText = "0";
  if (liveRecEnterNoiseEl) liveRecEnterNoiseEl.innerText = "-";
  if (liveRecExitNoiseEl) liveRecExitNoiseEl.innerText = "-";

  const stopBtn = document.querySelector("#calibStep2 button");
  if (stopBtn) stopBtn.disabled = true;

  console.log("开始自动校准");

  // 发送自动校准请求
  fetch(esp32BaseUrl + "/calibration/noise/start", {
    method: "POST"
  })
    .then((r) => r.json())
    .then(() => {
      // 记录采样的RSSI值，用于后续分析
      const rssiSamples = [];

      calibPollInterval = setInterval(() => {
        const calibNoiseValEl = document.getElementById("calibNoiseVal");
        if (calibNoiseValEl) {
          calibNoiseValEl.innerText = rssiValue;
        }

        // 记录RSSI值
        rssiSamples.push(rssiValue);

        calibNoiseSamples += 1;
        const calibNoiseSamplesEl = document.getElementById("calibNoiseSamples");
        if (calibNoiseSamplesEl) {
          calibNoiseSamplesEl.innerText = calibNoiseSamples;
        }

        // 更新实时推荐值
        if (rssiValue > calibMaxNoise) calibMaxNoise = rssiValue;
        const rec = computeRecommendedEnterExit(calibMaxNoise, rssiValue, getSelectedDroneSize());
        updateLiveRecommendation("noise", rec);

        // 实时更新滑块值
        updateSliderValues(rec.enter, rec.exit);

        if (stopBtn) stopBtn.disabled = calibNoiseSamples < calibTargetSamples;

        // 如果达到目标采样次数，自动停止校准
        if (calibNoiseSamples >= calibTargetSamples) {
          stopCalib(rssiSamples);
        }
      }, 200);
    });
}

// 新的停止校准函数
function stopCalib(rssiSamples) {
  clearInterval(calibPollInterval);

  // 发送停止校准请求
  fetch(esp32BaseUrl + "/calibration/noise/stop", { method: "POST" })
    .then((r) => r.json())
    .then((data) => {
      calibMaxNoise = Number.isFinite(data.maxNoise) ? data.maxNoise : calibMaxNoise;

      // 获取用户设置的参数
      const calibDropPercentageEl = document.getElementById('calibDropPercentage');
      const dropPercentage = calibDropPercentageEl ? parseFloat(calibDropPercentageEl.value) / 100 : 0.3;

      const calibDropDurationEl = document.getElementById('calibDropDuration');
      const dropDuration = calibDropDurationEl ? parseFloat(calibDropDurationEl.value) : 10;

      // 分析采样的RSSI值，优先使用后端返回的samples，如无则使用本地收集的
      const allSamples = (data.samples && Array.isArray(data.samples)) ? data.samples : rssiSamples;

      // 1. 过滤掉异常值（比如特别低的值）
      const filteredSamples = allSamples.filter(val => val > calibMaxNoise + 5);

      // 2. 计算峰值（最大值）和平均峰值
      const maxPeak = Math.max(...filteredSamples);
      const avgPeak = filteredSamples.length > 0 ? Math.round(filteredSamples.reduce((sum, val) => sum + val, 0) / filteredSamples.length) : calibMaxNoise;

      // 3. 计算delta值
      const delta = maxPeak - calibMaxNoise;

      // 4. 获取用户设置的采样次数
      const calibSamplesEl = document.getElementById('calibSamples');
      const userSampleCount = calibSamplesEl ? parseInt(calibSamplesEl.value) : 20;

      // 5. 自动尝试不同的进入和退出RSSI值组合
      const bestCombination = findBestEnterExitCombination(filteredSamples, calibMaxNoise, maxPeak,
        dropPercentage, dropDuration, userSampleCount);

      // 6. 计算最终推荐值（使用找到的最佳组合或默认计算）
      const rec = bestCombination || computeRecommendedEnterExit(calibMaxNoise, maxPeak, getSelectedDroneSize());

      // 实时更新滑块值
      updateSliderValues(rec.enter, rec.exit);

      // 保存校准后的阈值到设备
      saveConfig()
        .then(() => {
          console.log("校准阈值已保存");
          showToast("校准成功，阈值已保存", "success");
        })
        .catch((error) => {
          console.error("保存校准阈值失败:", error);
          showToast("校准成功，但保存阈值失败", "warning");
        });

      // 添加元素存在性检查，避免在某些页面中因元素不存在而导致错误
      const resNoiseEl = document.getElementById("resNoise");
      const resPeakEl = document.getElementById("resPeak");
      const resDeltaEl = document.getElementById("resDelta");
      const resMinDeltaEl = document.getElementById("resMinDelta");
      const recEnterEl = document.getElementById("recEnter");
      const recExitEl = document.getElementById("recExit");
      const calibStep2El = document.getElementById("calibStep2");
      const calibStep5El = document.getElementById("calibStep5");

      if (resNoiseEl) resNoiseEl.innerText = calibMaxNoise;
      if (resPeakEl) resPeakEl.innerText = maxPeak;
      if (resDeltaEl) resDeltaEl.innerText = delta;

      const tuning = getCalibrationTuning(getSelectedDroneSize());
      if (resMinDeltaEl) resMinDeltaEl.innerText = tuning.minDelta;

      if (recEnterEl) {
        recEnterEl.innerText = rec.enter;
        recEnterEl.dataset.val = rec.enter;
      }
      if (recExitEl) {
        recExitEl.innerText = rec.exit;
        recExitEl.dataset.val = rec.exit;
      }
      if (calibStep2El) calibStep2El.style.display = "none";
      // 修改为显示步骤3（结果确认）
      const calibStep3El = document.getElementById("calibStep3");
      if (calibStep3El) calibStep3El.style.display = "block";
      if (calibStep5El) calibStep5El.style.display = "none";

      // 已在步骤5中显示校准确认选项，无需弹出对话框
    });
}

// 查找最佳的进入和退出RSSI值组合
function findBestEnterExitCombination(rssiSamples, noise, peak, dropPercentage, dropDuration, sampleCount) {
  // 如果没有足够的样本，直接返回null
  if (rssiSamples.length < sampleCount) {
    return null;
  }

  const delta = peak - noise;
  const baseEnter = Math.round(noise + delta * 0.7);
  const baseExit = Math.round(noise + delta * 0.4);

  // 生成要尝试的进入/退出组合
  const combinations = [];
  const testCount = Math.min(sampleCount, 20); // 限制最大尝试次数

  for (let i = 0; i < testCount; i++) {
    // 根据用户设置的降低量百分比调整组合
    const percentageAdjustment = (i - Math.floor(testCount / 2)) * 0.05;
    const adjustedDropPercentage = Math.max(0.1, Math.min(0.9, dropPercentage + percentageAdjustment));

    // 计算进入和退出值
    const enterValue = Math.round(noise + delta * (1 - adjustedDropPercentage * 0.7));
    const exitValue = Math.round(noise + delta * (1 - adjustedDropPercentage * 1.3));

    combinations.push({ enter: enterValue, exit: exitValue, dropPercentage: adjustedDropPercentage });
  }

  // 评估每个组合
  let bestCombination = null;
  let bestScore = 0;

  combinations.forEach(comb => {
    // 计算组合的得分
    const score = evaluateCombination(rssiSamples, comb.enter, comb.exit, dropDuration);

    if (score > bestScore) {
      bestScore = score;
      bestCombination = comb;
    }
  });

  return bestCombination;
}

// 评估进入/退出组合的得分
function evaluateCombination(rssiSamples, enter, exit, dropDuration) {
  // 简单的评估逻辑：
  // 1. 检查进入阈值是否在合理范围内
  // 2. 检查退出阈值是否在合理范围内
  // 3. 检查进入阈值是否大于退出阈值
  // 4. 检查RSSI值在退出阈值以下的持续时间是否符合要求

  let score = 0;

  // 基本合理性检查
  if (enter > exit) score += 10;
  if (enter > -100 && enter < 0) score += 5;
  if (exit > -100 && exit < 0) score += 5;

  // 检查退出持续时间
  let consecutiveBelowExit = 0;
  let maxConsecutive = 0;

  for (let i = 0; i < rssiSamples.length; i++) {
    if (rssiSamples[i] < exit) {
      consecutiveBelowExit++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveBelowExit);
    } else {
      consecutiveBelowExit = 0;
    }
  }

  // 计算采样率（假设每200ms采样一次）
  const sampleRate = 5; // 每秒5个样本
  const requiredSamples = dropDuration * sampleRate;

  // 根据持续时间接近要求来调整得分
  if (maxConsecutive >= requiredSamples) {
    score += 15;
  } else if (maxConsecutive >= requiredSamples * 0.8) {
    score += 10;
  } else if (maxConsecutive >= requiredSamples * 0.5) {
    score += 5;
  }

  return score;
}

function startCalibCrossing() {
  // 添加元素存在性检查，避免在某些页面中因元素不存在而导致错误
  const calibStep3El = document.getElementById("calibStep3");
  const calibStep4El = document.getElementById("calibStep4");
  const calibCrossingTargetEl = document.getElementById("calibCrossingTarget");
  const calibCrossingSamplesEl = document.getElementById("calibCrossingSamples");
  const liveRecEnterCrossingEl = document.getElementById("liveRecEnterCrossing");
  const liveRecExitCrossingEl = document.getElementById("liveRecExitCrossing");

  if (calibStep3El) calibStep3El.style.display = "none";
  if (calibStep4El) calibStep4El.style.display = "block";

  calibMaxPeak = 0;
  calibCrossingSamples = 0;
  calibTargetSamples = getCalibrationSamplesTarget();

  if (calibCrossingTargetEl) calibCrossingTargetEl.innerText = calibTargetSamples;
  if (calibCrossingSamplesEl) calibCrossingSamplesEl.innerText = "0";
  if (liveRecEnterCrossingEl) liveRecEnterCrossingEl.innerText = "-";
  if (liveRecExitCrossingEl) liveRecExitCrossingEl.innerText = "-";
  const stopBtn = document.querySelector("#calibStep4 button");
  if (stopBtn) stopBtn.disabled = true;

  fetch(esp32BaseUrl + "/calibration/crossing/start", { method: "POST" })
    .then((r) => r.json())
    .then(() => {
      calibPollInterval = setInterval(() => {
        const calibPeakValEl = document.getElementById("calibPeakVal");
        if (calibPeakValEl) {
          calibPeakValEl.innerText = rssiValue;
        }
        calibCrossingSamples += 1;
        const calibCrossingSamplesEl = document.getElementById("calibCrossingSamples");
        if (calibCrossingSamplesEl) {
          calibCrossingSamplesEl.innerText = calibCrossingSamples;
        }
        if (rssiValue > calibMaxPeak) calibMaxPeak = rssiValue;
        updateLiveRecommendation("crossing", computeRecommendedEnterExit(calibMaxNoise, calibMaxPeak, getSelectedDroneSize()));
        if (stopBtn) stopBtn.disabled = calibCrossingSamples < calibTargetSamples;
      }, 200);
    });
}

function stopCalibCrossing() {
  if (calibCrossingSamples < calibTargetSamples) {
    showToast("过门采样次数不足，请至少采样 " + calibTargetSamples + " 次", 'warning');
    return;
  }
  clearInterval(calibPollInterval);
  fetch(esp32BaseUrl + "/calibration/crossing/stop", { method: "POST" })
    .then((r) => r.json())
    .then((data) => {
      calibMaxPeak = Number.isFinite(data.maxPeak) ? data.maxPeak : calibMaxPeak;
      calibMaxNoise = Number.isFinite(data.maxNoise) ? data.maxNoise : calibMaxNoise;

      const rec = {
        enter: Number.isFinite(data.recEnter) ? data.recEnter : computeRecommendedEnterExit(calibMaxNoise, calibMaxPeak, getSelectedDroneSize()).enter,
        exit: Number.isFinite(data.recExit) ? data.recExit : computeRecommendedEnterExit(calibMaxNoise, calibMaxPeak, getSelectedDroneSize()).exit,
      };

      // 更新滑块值
      updateSliderValues(rec.enter, rec.exit);

      // 保存校准后的阈值到设备
      saveConfig()
        .then(() => {
          console.log("校准阈值已保存");
          showToast("校准成功，阈值已保存", "success");
        })
        .catch((error) => {
          console.error("保存校准阈值失败:", error);
          showToast("校准成功，但保存阈值失败", "warning");
        });

      // 添加元素存在性检查，避免在某些页面中因元素不存在而导致错误
      const resNoiseEl = document.getElementById("resNoise");
      const resPeakEl = document.getElementById("resPeak");
      const resDeltaEl = document.getElementById("resDelta");
      const resMinDeltaEl = document.getElementById("resMinDelta");
      const recEnterEl = document.getElementById("recEnter");
      const recExitEl = document.getElementById("recExit");
      const calibStep4El = document.getElementById("calibStep4");
      const calibStep5El = document.getElementById("calibStep5");

      if (resNoiseEl) resNoiseEl.innerText = calibMaxNoise;
      if (resPeakEl) resPeakEl.innerText = calibMaxPeak;

      const delta = Number.isFinite(data.delta) ? data.delta : calibMaxPeak - calibMaxNoise;
      const minDelta = Number.isFinite(data.minDelta) ? data.minDelta : computeRecommendedEnterExit(calibMaxNoise, calibMaxPeak, getSelectedDroneSize()).minDelta;

      if (resDeltaEl) resDeltaEl.innerText = delta;
      if (resMinDeltaEl) resMinDeltaEl.innerText = minDelta;

      if (recEnterEl) {
        recEnterEl.innerText = rec.enter;
        recEnterEl.dataset.val = rec.enter;
      }
      if (recExitEl) {
        recExitEl.innerText = rec.exit;
        recExitEl.dataset.val = rec.exit;
      }

      if (data.ok === false || data.snrOk === false) {
        showToast("校准信号与底噪差距偏小（delta=" + delta + "，要求≥" + minDelta + "），建议调整门位置/天线或重新校准", 'warning');
      }

      if (calibStep4El) calibStep4El.style.display = "none";
      // 修改为显示步骤3（结果确认）
      const calibStep3El = document.getElementById("calibStep3");
      if (calibStep3El) calibStep3El.style.display = "block";
      if (calibStep5El) calibStep5El.style.display = "none";
    });
}

function applyCalib() {
  const recEnterEl = document.getElementById("recEnter");
  const recExitEl = document.getElementById("recExit");

  if (!recEnterEl || !recExitEl) {
    console.warn("Calibration elements not found, cannot apply calibration");
    return;
  }

  let enter = parseInt(recEnterEl.dataset.val);
  let exit = parseInt(recExitEl.dataset.val);

  // 确保全局变量存在且已初始化
  if (enterRssiInput && exitRssiInput) {
    enterRssiInput.value = enter;
    updateEnterRssi(enterRssiInput, enter);

    exitRssiInput.value = exit;
    updateExitRssi(exitRssiInput, exit);

    saveConfig().then(() => {
      showToast("校准参数已应用并保存！", 'success');
      resetCalib();
    });
  }
}

function resetCalib() {
  // 添加元素存在性检查，避免在某些页面中因元素不存在而导致错误
  const calibStep1El = document.getElementById("calibStep1");
  const calibStep2El = document.getElementById("calibStep2");
  const calibStep3El = document.getElementById("calibStep3");
  const calibStep4El = document.getElementById("calibStep4");
  const calibStep5El = document.getElementById("calibStep5");

  if (calibStep1El) calibStep1El.style.display = "block";
  if (calibStep2El) calibStep2El.style.display = "none";
  if (calibStep3El) calibStep3El.style.display = "none";
  if (calibStep4El) calibStep4El.style.display = "none";
  if (calibStep5El) calibStep5El.style.display = "none";

  if (calibPollInterval) clearInterval(calibPollInterval);
}

// 更新当前设置显示
function updateCurrentSettings() {
  const currentBandEl = document.getElementById('currentBand');
  const currentChannelEl = document.getElementById('currentChannel');
  const currentFreqEl = document.getElementById('currentFreq');
  const currentDroneSizeEl = document.getElementById('currentDroneSize');
  const currentGateDiameterEl = document.getElementById('currentGateDiameter');

  if (currentBandEl) currentBandEl.innerText = bandSelect?.value || '-';
  if (currentChannelEl) currentChannelEl.innerText = channelSelect?.value || '-';
  if (currentFreqEl) currentFreqEl.innerText = frequency || '-';

  const droneSize = getSelectedDroneSize();
  if (currentDroneSizeEl) currentDroneSizeEl.innerText = droneSize + ' 寸';

  const gateDiameter = getGateDiameterMm(droneSize) / 10;
  if (currentGateDiameterEl) currentGateDiameterEl.innerText = gateDiameter;
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
  // if (esp32Ip) {
  //   esp32BaseUrl = `http://${esp32Ip}`;
  //   console.log(`使用ESP32 IP地址: ${esp32BaseUrl}`);
  // } else {
  esp32BaseUrl = window.location.origin;
  //   console.log('未指定esp32ip，使用当前地址:', esp32BaseUrl);
  // }

  // 设置 OTA iframe 的地址为 esp32BaseUrl/update
  const otaIframeElem = document.getElementById('ota-iframe');
  if (otaIframeElem && esp32BaseUrl) {
    otaIframeElem.src = esp32BaseUrl + "/update";
  }

  fetch(esp32BaseUrl + "/config")
    .then((response) => response.json())
    .then((config) => {
      console.log(config);
      setBandChannelIndex(config.freq);
      minLapInput.value = (parseFloat(config.minLap) / 10).toFixed(1);
      updateMinLap(minLapInput, minLapInput.value);
      alarmThreshold.value = (parseFloat(config.alarm) / 10).toFixed(1);
      updateAlarmThreshold(alarmThreshold, alarmThreshold.value);

      // 优先从localStorage恢复播报类型设置
      const savedAnnouncerType = localStorage.getItem("announcerType");
      if (savedAnnouncerType !== null) {
        announcerSelect.selectedIndex = parseInt(savedAnnouncerType);
      } else {
        announcerSelect.selectedIndex = config.anType;
      }

      announcerRateInput.value = (parseFloat(config.anRate) / 10).toFixed(1);
      updateAnnouncerRate(announcerRateInput, announcerRateInput.value);
      announcerRate = parseFloat(announcerRateInput.value); // 更新变量值
      enterRssiInput.value = config.enterRssi;
      updateEnterRssi(enterRssiInput, enterRssiInput.value);
      exitRssiInput.value = config.exitRssi;
      updateExitRssi(exitRssiInput, exitRssiInput.value);
      if (droneSizeSelect) {
        const ds = parseInt(config.droneSize);
        droneSizeSelect.value = ds === 2 ? "2" : "5";
      }
      if (calibSamplesInput) {
        const cs = parseInt(config.calibSamples);
        calibSamplesInput.value = String(Number.isFinite(cs) && cs >= 10 ? cs : 20);
      }
      pilotNameInput.value = config.name;
      pilotIdInput.value = config.pilotId || "";
      apiAddressInput.value = config.apiAddress || "http://192.168.31.136:8888/api";
      ssidInput.value = config.ssid;
      pwdInput.value = config.pwd;
      // store original wifi values to detect if they changed when saving
      originalSsid = ssidInput.value || "";
      originalPwd = pwdInput.value || "";
      populateFreqOutput();
      stopRaceButton.disabled = true;
      startRaceButton.disabled = false;
      clearInterval(timerInterval);
      timer.innerHTML = "00:00:00 s";

      console.log("config  esp32BaseUrl：=" + esp32BaseUrl);
      clearLaps();
      createRssiChart();
      initEventStream();
      updateGateDiameterUi();
      if (droneSizeSelect) {
        droneSizeSelect.addEventListener("change", () => {
          updateGateDiameterUi();
        });
      }
    })
    .catch(error => {
      console.error('无法连接到ESP32设备:', error);
      showToast('无法连接到ESP32设备。请确保：\n1. 已连接到ESP32的热点（QiYun-FPV_XXXX）\n2. 或者通过URL参数指定IP地址：?esp32ip=33.0.0.1', 'error');
    });
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
      } else if (!crossing && rssiValue > enterRssi) {
        crossing = true;
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
    if (crossing) {
      rssiCrossingSeries.append(now, 256);
    } else {
      rssiCrossingSeries.append(now, -10);
    }
  } else {
    if (rssiChart && typeof rssiChart.stop === 'function') {
      rssiChart.stop();
    }
    maxRssiValue = enterRssi + 10;
    minRssiValue = exitRssi - 10;
  }
}

setInterval(addRssiPoint, 200);

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
  rssiChart.streamTo(document.getElementById("rssiChart"), 200);
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

  // if event comes from calibration tab, signal to start sending RSSI events
  if (tabName === "calib" && !rssiSending) {
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
  enterRssiSpan.textContent = enterRssi;
  if (enterRssi <= exitRssi) {
    exitRssi = Math.max(0, enterRssi - 1);
    exitRssiInput.value = exitRssi;
    exitRssiSpan.textContent = exitRssi;
  }
}

function updateExitRssi(obj, value) {
  exitRssi = parseInt(value);
  exitRssiSpan.textContent = exitRssi;
  if (exitRssi >= enterRssi) {
    enterRssi = Math.min(255, exitRssi + 1);
    enterRssiInput.value = enterRssi;
    enterRssiSpan.textContent = enterRssi;
  }
}

function saveConfig() {
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
      droneSize: getSelectedDroneSize(),
      calibSamples: getCalibrationSamplesTarget(),
      name: pilotNameInput.value,
      pilotId: pilotIdInput.value,
      apiAddress: apiAddressInput.value,
      ssid: ssidInput.value,
      pwd: pwdInput.value,
    }),
  })
    .then((response) => response.json())
    .then((response) => {
      console.log("/config:" + JSON.stringify(response));
      // Check if critical network config changed (simple heuristic or flag from server?)
      // Since we don't know old values here easily without storing them, 
      // we rely on user action. 
      // But if user just clicks "Save Config", it only updates RAM/EEPROM but doesn't trigger restart/reconnect.
      // We should probably prompt user if they want to restart if they changed WiFi.
      return response;
    });
}

function saveAndRestartConfig() {
  // Always save first, then restart
  // Note: /save_and_restart in C++ calls conf->write() then ESP.restart()
  // But our saveConfig() also calls /config (which updates RAM)
  // We should just call /save_and_restart directly if we want to save-to-eeprom AND restart.
  // Actually /config endpoint just updates the Config object in RAM (and maybe writes to EEPROM if modified? No, Config::handleEeprom does that periodically or on demand).
  // Let's check firmware: /config handler calls conf->fromJson(jsonObj). 
  // /save_and_restart calls conf->write() then ESP.restart().
  // So we MUST call saveConfig() (to send JSON to update RAM object) FIRST, 
  // THEN call /save_and_restart (to commit to EEPROM and reboot).

  saveConfig().then(() => {
    // 仅当 SSID 或 密码 发生变化时才重启设备；否则只保存配置即可
    const newSsid = ssidInput.value || "";
    const newPwd = pwdInput.value || "";
    if (newSsid !== originalSsid || newPwd !== originalPwd) {
      fetch(esp32BaseUrl + "/save_and_restart", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      })
        .then((response) => response.json())
        .then((response) => {
          console.log("/save_and_restart:" + JSON.stringify(response));
          showToast("WiFi 配置已改变，设备正在重启以应用新网络设置。请在几秒后重新连接WiFi。", 'info');
        })
        .catch((error) => {
          console.error("Error saving config:", error);
          showToast("重启指令发送失败，请检查连接。尝试再次保存。", 'error');
        });
    } else {
      // No wifi change — config was posted and device will commit to EEPROM shortly
      originalSsid = newSsid;
      originalPwd = newPwd;
      showToast("配置已保存（WiFi 未更改），无需重启。", 'success');
    }
  });
}

function populateFreqOutput() {
  // 添加元素存在性检查，避免在某些页面（如OTA页面）中因元素不存在而导致错误
  if (bandSelect && channelSelect && freqOutput) {
    let band = bandSelect.options[bandSelect.selectedIndex].value;
    let chan = channelSelect.options[channelSelect.selectedIndex].value;
    frequency = freqLookup[bandSelect.selectedIndex][channelSelect.selectedIndex];
    freqOutput.textContent = band + chan + " " + frequency;
  }
}

// 这个事件监听器将在initializeDOMElements函数中添加

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

function addLap(lapStr) {
  const pilotName = pilotNameInput.value;
  var cumulativeTimeStr = "";
  const newLap = parseFloat(lapStr);

  // 计算当前圈数（第0圈为开圈）
  const currentLapNo = lapNo;
  lapNo += 1;

  const table = document.getElementById("lapTable");
  const row = table.insertRow(currentLapNo + 1);
  const cell1 = row.insertCell(0);
  const cell2 = row.insertCell(1);
  const cell3 = row.insertCell(2);

  // 显示当前圈数
  if (currentLapNo == 0) {
    cell1.innerHTML = "开圈";
    cell2.innerHTML = "";
  } else {
    cell1.innerHTML = currentLapNo;
    cell2.innerHTML = lapStr + " 秒";
  }

  // 计算累计用时（从第1圈到当前圈的总时间）
  if (currentLapNo != 0) {
    // 计算总时间：lapTimes数组中所有已完成的圈数加上当前圈
    let cumulativeTime = newLap;
    // lapTimes数组中已经包含了之前所有完成的圈数
    for (let i = 0; i < lapTimes.length; i++) {
      cumulativeTime += lapTimes[i];
    }

    cumulativeTimeStr = cumulativeTime.toFixed(2);
    cell3.innerHTML = cumulativeTimeStr + " 秒";
  }

  switch (announcerSelect.selectedIndex) {
    case 1:
      beep(100, 330, "square");
      break;
    case 2:
      if (currentLapNo == 0) {
        queueSpeak("<p>开圈<p>");
      } else {
        const lapNoStr = pilotName + " 第 " + currentLapNo + " 圈, ";
        const text = "<p>" + lapNoStr + lapStr.replace(".", ",") + "</p>";
        queueSpeak(text);
      }
      break;
    case 3:
      if (currentLapNo == 0) {
        queueSpeak("<p>开圈<p>");
      } else if (cumulativeTimeStr != "") {
        // 播报从第1圈到当前圈的总时间
        const text = "<p>" + pilotName + " 累计 " + cumulativeTimeStr.replace(".", ",") + "</p>";
        queueSpeak(text);
      }
      break;
    default:
      break;
  }

  // 只有非开圈时间（即实际完成的圈数）才添加到lapTimes数组中
  if (currentLapNo > 0) {
    lapTimes.push(newLap);
  }
}

function startTimer() {
  var millis = 0;
  var seconds = 0;
  var minutes = 0;
  timerInterval = setInterval(function () {
    millis += 1;

    if (millis == 100) {
      millis = 0;
      seconds++;

      if (seconds == 60) {
        seconds = 0;
        minutes++;

        if (minutes == 60) {
          minutes = 0;
        }
      }
    }

    
    let m = minutes < 10 ? "0" + minutes : minutes;
    let s = seconds < 10 ? "0" + seconds : seconds;
    let ms = millis < 10 ? "0" + millis : millis;
    timer.innerHTML = `${m}:${s}:${ms} s`;
  }, 10);

  fetch(esp32BaseUrl + "/timer/start", {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
  })
    .then((response) => response.json())
    .then((response) => console.log("/timer/start:" + JSON.stringify(response)));
}

function queueSpeak(htmlStr) {
  if (!audioEnabled) {
    console.log('语音未启用，无法播放:', htmlStr);
    return;
  }
  console.log('添加到语音队列:', htmlStr);
  speakObjsQueue.push(htmlStr);
}

async function enableAudioLoop() {
  audioEnabled = true;
  console.log('语音循环已启用');
  while (audioEnabled) {
    if (speakObjsQueue.length > 0) {
      // 检查是否正在说话
      let isSpeakingFlag = false;
      try {
        isSpeakingFlag = $().articulate('isSpeaking');
      } catch (e) {
        console.error('检查说话状态时出错:', e);
      }
      
      if (!isSpeakingFlag) {
        let htmlStr = speakObjsQueue.shift();
        console.log('开始播放语音:', htmlStr);
        doSpeak(htmlStr);
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
    console.log('语音未启用，无法测试');
    // 自动启用语音
    enableAudioLoop();
    // 延迟一下确保语音循环启动
    setTimeout(() => {
      generateAudio();
    }, 200);
    return;
  }

  const pilotName = pilotNameInput.value;
  queueSpeak('<div>测试语音：车手 ' + pilotName + '</div>');
  for (let i = 1; i <= 3; i++) {
    queueSpeak('<div>' + i + '</div>')
  }
}

function doSpeak(htmlStr) {
  try {
    // 创建一个临时DOM元素来容纳HTML内容
    const tempElement = document.createElement('div');
    tempElement.innerHTML = htmlStr;
    // 添加到DOM中（有些浏览器需要元素在DOM中才能播放）
    tempElement.style.position = 'absolute';
    tempElement.style.left = '-9999px';
    document.body.appendChild(tempElement);
    
    // 检查articulate插件是否可用
    if ($().articulate) {
      console.log('articulate插件可用');
      
      // 检查可用语音
      const voices = $().articulate('getVoices');
      console.log('可用语音数量:', voices.length);
      
      // 确保设置了语音
      if (!window.articulateVoice) {
        // 默认使用第一个中文语音
        for (let i = 0; i < voices.length; i++) {
          if (voices[i].language.includes('zh')) {
            window.articulateVoice = voices[i].name;
            $().articulate('setVoice', 'name', window.articulateVoice);
            console.log('选择中文语音:', window.articulateVoice);
            break;
          }
        }
        
        // 如果没有中文语音，使用第一个可用语音
        if (!window.articulateVoice && voices.length > 0) {
          window.articulateVoice = voices[0].name;
          $().articulate('setVoice', 'name', window.articulateVoice);
          console.log('选择默认语音:', window.articulateVoice);
        }
      }
      
      // 设置语音速率
      console.log('设置语音速率:', announcerRate);
      $().articulate('rate', announcerRate);
      
      // 使用articulate插件的speak方法播放语音
      $(tempElement).articulate('speak');
      
      // 设置定时器检查播放是否完成
      const checkSpeaking = setInterval(() => {
        if (!$().articulate('isSpeaking')) {
          clearInterval(checkSpeaking);
          console.log('语音播放完成');
          // 移除临时元素
          document.body.removeChild(tempElement);
        }
      }, 200);
      
    } else {
      console.error('articulate插件不可用');
      // 降级方案：使用浏览器的Web Speech API
      const text = tempElement.textContent;
      if ('speechSynthesis' in window) {
        console.log('使用Web Speech API播放:', text);
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = announcerRate;
        
        // 尝试使用中文语音
        const voices = speechSynthesis.getVoices();
        for (let i = 0; i < voices.length; i++) {
          if (voices[i].language.includes('zh')) {
            utterance.voice = voices[i];
            break;
          }
        }
        
        utterance.onend = () => {
          console.log('Web Speech API播放完成');
          document.body.removeChild(tempElement);
        };
        
        speechSynthesis.speak(utterance);
      } else {
        console.error('浏览器不支持语音合成');
        document.body.removeChild(tempElement);
      }
    }
  } catch (e) {
    console.error('播放语音时出错:', e);
    // 确保移除临时元素
    if (tempElement && tempElement.parentNode) {
      document.body.removeChild(tempElement);
    }
  }
}

async function startRace() {
  // 初始化比赛状态
  lapNo = 0;
  lapTimes = [];

  startRaceButton.disabled = true;
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
  timer.innerHTML = "00:00:00 秒";

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

function clearLaps() {
  var tableHeaderRowCount = 1;
  var rowCount = lapTable.rows.length;
  for (var i = tableHeaderRowCount; i < rowCount; i++) {
    lapTable.deleteRow(tableHeaderRowCount);
  }
  lapNo = 0;
  lapTimes = [];
}

// 确保clearLapsButton在页面加载时可用
document.addEventListener('DOMContentLoaded', function () {
  const clearLapsButton = document.getElementById('clearLapsButton');
  if (clearLapsButton) {
    clearLapsButton.disabled = false;
  }
});

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
      var lap = (parseFloat(e.data) / 1000).toFixed(2);
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

// OTA更新相关功能
window.addEventListener('load', function() {
  // 固件更新表单处理
  const otaForm = document.getElementById('otaForm');
  const otaBtn = document.getElementById('btn');
  const otaMsg = document.getElementById('msg');
  const versionSpan = document.querySelector('#version span');
  
  // 网页更新表单处理
  const webUpdateForm = document.getElementById('webUpdateForm');
  const webBtn = document.getElementById('webBtn');
  const webMsg = document.getElementById('webMsg');
  
  // 获取并显示当前固件版本号
  if (versionSpan) {
    fetch('/version')
      .then(response => response.json())
      .then(data => {
        versionSpan.textContent = data.version;
      })
      .catch(error => {
        versionSpan.textContent = '无法获取版本信息';
      });
  }
  
  // 固件更新表单提交处理
  if (otaForm && otaBtn && otaMsg) {
    otaForm.addEventListener('submit', function(ev) {
      otaBtn.disabled = true;
      otaMsg.textContent = '正在上传固件，请稍候...';
    });
  }
  
  // 网页更新表单提交处理
  if (webUpdateForm && webBtn && webMsg) {
    webUpdateForm.addEventListener('submit', function(ev) {
      webBtn.disabled = true;
      webMsg.textContent = '正在上传网页更新包，请稍候...';
    });
  }
});