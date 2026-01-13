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
const pwdInput = document.getElementById("pwd");
const minLapInput = document.getElementById("minLap");
const alarmThreshold = document.getElementById("alarmThreshold");

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

// 自动校准逻辑
let calibMaxNoise = 0;
let calibMaxPeak = 0;
let calibPollInterval = null;

function startCalibNoise() {
  document.getElementById("calibStep1").style.display = "none";
  document.getElementById("calibStep2").style.display = "block";
  calibMaxNoise = 0;
  
  fetch(esp32BaseUrl + "/calibration/noise/start", { method: "POST" })
    .then(r => r.json())
    .then(data => {
      console.log("Started noise calibration");
      // Poll current RSSI to show progress
      calibPollInterval = setInterval(() => {
        document.getElementById("calibNoiseVal").innerText = rssiValue;
      }, 200);
    });
}

function stopCalibNoise() {
  clearInterval(calibPollInterval);
  fetch(esp32BaseUrl + "/calibration/noise/stop", { method: "POST" })
    .then(r => r.json())
    .then(data => {
      calibMaxNoise = data.maxNoise;
      console.log("Stopped noise calibration, maxNoise:", calibMaxNoise);
      document.getElementById("calibStep2").style.display = "none";
      document.getElementById("calibStep3").style.display = "block";
    });
}

function startCalibCrossing() {
  document.getElementById("calibStep3").style.display = "none";
  document.getElementById("calibStep4").style.display = "block";
  calibMaxPeak = 0;

  fetch(esp32BaseUrl + "/calibration/crossing/start", { method: "POST" })
    .then(r => r.json())
    .then(data => {
      console.log("Started crossing calibration");
      calibPollInterval = setInterval(() => {
        document.getElementById("calibPeakVal").innerText = rssiValue;
      }, 200);
    });
}

function stopCalibCrossing() {
  clearInterval(calibPollInterval);
  fetch(esp32BaseUrl + "/calibration/crossing/stop", { method: "POST" })
    .then(r => r.json())
    .then(data => {
      calibMaxPeak = data.maxPeak;
      console.log("Stopped crossing calibration, maxPeak:", calibMaxPeak);
      
      // Calculation Logic
      // EnterAt = Noise + (Peak - Noise) * 0.6
      // ExitAt = Noise + (Peak - Noise) * 0.3
      // Ensure values are within 0-255 and logical
      
      let recEnter = Math.round(calibMaxNoise + (calibMaxPeak - calibMaxNoise) * 0.60);
      let recExit = Math.round(calibMaxNoise + (calibMaxPeak - calibMaxNoise) * 0.30);
      
      // Basic sanity check
      if (calibMaxPeak <= calibMaxNoise + 10) {
        alert("信号峰值与底噪太接近，校准可能不准确！");
      }
      
      if (recEnter > 255) recEnter = 255;
      if (recExit < 0) recExit = 0;
      if (recEnter <= recExit) recEnter = recExit + 5;

      document.getElementById("resNoise").innerText = calibMaxNoise;
      document.getElementById("resPeak").innerText = calibMaxPeak;
      document.getElementById("recEnter").innerText = recEnter;
      document.getElementById("recExit").innerText = recExit;
      
      // Store for apply
      document.getElementById("recEnter").dataset.val = recEnter;
      document.getElementById("recExit").dataset.val = recExit;

      document.getElementById("calibStep4").style.display = "none";
      document.getElementById("calibStep5").style.display = "block";
    });
}

function applyCalib() {
  let enter = parseInt(document.getElementById("recEnter").dataset.val);
  let exit = parseInt(document.getElementById("recExit").dataset.val);
  
  enterRssiInput.value = enter;
  updateEnterRssi(enterRssiInput, enter);
  
  exitRssiInput.value = exit;
  updateExitRssi(exitRssiInput, exit);
  
  saveConfig().then(() => {
    alert("校准参数已应用并保存！");
    resetCalib();
  });
}

function resetCalib() {
  document.getElementById("calibStep1").style.display = "block";
  document.getElementById("calibStep2").style.display = "none";
  document.getElementById("calibStep3").style.display = "none";
  document.getElementById("calibStep4").style.display = "none";
  document.getElementById("calibStep5").style.display = "none";
  if (calibPollInterval) clearInterval(calibPollInterval);
}

// 创建错误显示区域
document.addEventListener('DOMContentLoaded', function() {
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
    otaIframe.addEventListener('load', function() {
      console.log('OTA iframe loaded');
    });
    
    otaIframe.addEventListener('error', function(e) {
      console.error('OTA iframe error:', e);
    });
  }
  
  // 动态替换 LOGO 为透明背景版本（支持通过 ?logo=URL 指定图片）
  const logoParam = new URLSearchParams(window.location.search).get('logo');
  const logoImgEl = document.getElementById('logo-img');
  const faviconEl = document.querySelector('link[rel=\"icon\"]');
  const sourceLogoUrl = logoParam || null; // 如未提供，保持现有 favicon
  
  function chromaKeyToTransparent(img, threshold=60) {
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
      const r = data[i], g = data[i+1], b = data[i+2];
      const dist = Math.sqrt((r-r0)*(r-r0) + (g-g0)*(g-g0) + (b-b0)*(b-b0));
      if (dist < threshold) {
        data[i+3] = 0; // 透明
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }
  
  if (sourceLogoUrl && logoImgEl) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
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
    img.onerror = function(e) {
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
  const urlParams = new URLSearchParams(window.location.search);
  const esp32Ip = urlParams.get('esp32ip');
  if (esp32Ip) {
    esp32BaseUrl = `http://${esp32Ip}`;
    console.log(`使用ESP32 IP地址: ${esp32BaseUrl}`);
  } else {
    esp32BaseUrl = window.location.origin;
    console.log('未指定esp32ip，使用当前地址:', esp32BaseUrl);
  }
  
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
      announcerSelect.selectedIndex = config.anType;
      announcerRateInput.value = (parseFloat(config.anRate) / 10).toFixed(1);
      updateAnnouncerRate(announcerRateInput, announcerRateInput.value);
      enterRssiInput.value = config.enterRssi;
      updateEnterRssi(enterRssiInput, enterRssiInput.value);
      exitRssiInput.value = config.exitRssi;
      updateExitRssi(exitRssiInput, exitRssiInput.value);
      pilotNameInput.value = config.name;
      ssidInput.value = config.ssid;
      pwdInput.value = config.pwd;
      populateFreqOutput();
      stopRaceButton.disabled = true;
      startRaceButton.disabled = false;
      clearInterval(timerInterval);
      timer.innerHTML = "00:00:00 s";

      console.log("config  esp32BaseUrl：="+esp32BaseUrl);
      clearLaps();
      createRssiChart();
      initEventStream();
    })
    .catch(error => {
      console.error('无法连接到ESP32设备:', error);
      alert('无法连接到ESP32设备。请确保：\n1. 已连接到ESP32的热点（QiYun-FPV_XXXX）\n2. 或者通过URL参数指定IP地址：?esp32ip=33.0.0.1');
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
      name: pilotNameInput.value,
      ssid: ssidInput.value,
      pwd: pwdInput.value,
    }),
  })
    .then((response) => response.json())
    .then((response) => console.log("/config:" + JSON.stringify(response)));
}

function saveAndRestartConfig() {
  saveConfig().then(() => {
    fetch(esp32BaseUrl + "/save_and_restart", {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    })
      .then((response) => response.json())
      .then((response) => {
        console.log("/save_and_restart:" + JSON.stringify(response));
        alert("配置已保存，设备正在重启...");
      })
      .catch((error) => {
        console.error("Error saving config:", error);
        alert("保存配置失败，请重试");
      });
  });
}

function populateFreqOutput() {
  let band = bandSelect.options[bandSelect.selectedIndex].value;
  let chan = channelSelect.options[channelSelect.selectedIndex].value;
  frequency = freqLookup[bandSelect.selectedIndex][channelSelect.selectedIndex];
  freqOutput.textContent = band + chan + " " + frequency;
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

function addLap(lapStr) {
  const pilotName = pilotNameInput.value;
  var last2lapStr = "";
  var last3lapStr = "";
  const newLap = parseFloat(lapStr);
  lapNo += 1;
  const table = document.getElementById("lapTable");
  const row = table.insertRow(lapNo + 1);
  const cell1 = row.insertCell(0);
  const cell2 = row.insertCell(1);
  const cell3 = row.insertCell(2);
  const cell4 = row.insertCell(3);
  cell1.innerHTML = lapNo;
  if (lapNo == 0) {
    cell2.innerHTML = "开圈";
  } else {
    cell2.innerHTML = lapStr + " 秒";
  }
  if (lapTimes.length >= 2 && lapNo != 0) {
    last2lapStr = (newLap + lapTimes[lapTimes.length - 1]).toFixed(2);
    cell3.innerHTML = last2lapStr + " 秒";
  }
  if (lapTimes.length >= 3 && lapNo != 0) {
    last3lapStr = (newLap + lapTimes[lapTimes.length - 2] + lapTimes[lapTimes.length - 1]).toFixed(2);
    cell4.innerHTML = last3lapStr + " 秒";
  }

  switch (announcerSelect.options[announcerSelect.selectedIndex].value) {
    case "beep":
      beep(100, 330, "square");
      break;
    case "1lap":
      if (lapNo == 0) {
        queueSpeak("<p>开圈<p>");
      } else {
        const lapNoStr = pilotName + " 第 " + lapNo + " 圈, ";
        const text = "<p>" + lapNoStr + lapStr.replace(".", ",") + "</p>";
        queueSpeak(text);
      }
      break;
    case "2lap":
      if (lapNo == 0) {
        queueSpeak("<p>Hole Shot<p>");
      } else if (last2lapStr != "") {
        const text2 = "<p>" + pilotName + " 两圈累计 " + last2lapStr.replace(".", ",") + "</p>";
        queueSpeak(text2);
      }
      break;
    case "3lap":
      if (lapNo == 0) {
        queueSpeak("<p>Hole Shot<p>");
      } else if (last3lapStr != "") {
        const text3 = "<p>" + pilotName + " 三圈累计 " + last3lapStr.replace(".", ",") + "</p>";
        queueSpeak(text3);
      }
      break;
    default:
      break;
  }
  lapTimes.push(newLap);
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

function queueSpeak(obj) {
  if (!audioEnabled) {
    return;
  }
  speakObjsQueue.push(obj);
}

async function enableAudioLoop() {
  audioEnabled = true;
  while(audioEnabled) {
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
  queueSpeak('<div>测试语音：车手 ' + pilotName + '</div>');
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
  lapNo = -1;
  lapTimes = [];
}

function initEventStream() {
  console.log("events  esp32BaseUrl：="+esp32BaseUrl);
  if (!window.EventSource || !esp32BaseUrl) return;
  var source = new EventSource(esp32BaseUrl + "/events");

  source.addEventListener(
    "open",
    function (e) {
      console.log("events open esp32BaseUrl：="+esp32BaseUrl);
      console.log("Events Connected");
    },
    false
  );

  source.addEventListener(
    "error",
    function (e) {
      console.log("events error  esp32BaseUrl：="+esp32BaseUrl);
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
