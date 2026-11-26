/*
  AgriVision 6WD: THIRD ESP32 (ultrasonic sensors and MPU-6050 tilt sensor): WebSocket version.

  Connects to  ws://<laptop>:5000/ws?role=sonar  and sends the distance seen on each side. The dashboard shows
  them on the Rover control page. This board only measures: it does not drive or stop any motor.
  This server needs the sonar role (added in server/src/hub.js): restart the server after updating it.

    Sensor   Trig (output)   Echo (input)
    Front    GPIO 23         GPIO 22
    Left     GPIO 21         GPIO 19
    Right    GPIO 18         GPIO 5
    Back     GPIO 17         GPIO 16

  Wiring: VCC to 5 V, GND shared with this ESP32. A 5 V sensor (HC-SR04) drives Echo at 5 V, so put a divider on
  EVERY Echo line:  Echo --[1k]--+-- ESP32 pin,  and  +--[2k]-- GND.  (HC-SR04P / RCWL-1601 on 3.3 V need none.)
  GPIO 16 and 17 are free on WROOM boards; WROVER boards use them for their extra memory.

  The sensors fire one at a time so that one does not hear another's ping.

  MPU-6050 (GY-521):  VCC 3.3 V, GND, SDA GPIO 32, SCL GPIO 33. XDA, XCL, AD0, INT not connected.
    Mount it flat with its printed X arrow pointing FORWARD. Keep the rover still for the first 3 seconds after
    power-up: the gyro zeroes itself then. Heading is relative (no compass) and drifts slowly.


  Libraries (Library Manager): "WebSockets" by Markus Sattler, "ArduinoJson" v7. Board package: esp32 3.x.
  WiFi and server settings: copy secrets.example.h to secrets.h in this folder and fill it in.
*/

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Wire.h>

#include "secrets.h"

// ---- sensors ----------------------------------------------------------------
struct Sonar {
  const char* name;      // also the field name sent to the server
  int trig, echo;
  int history[3];        // last three raw readings, for the median
  int cm;                // smoothed distance, -1 = no echo
};

const int SONARS = 4;
Sonar sonars[SONARS] = {
  {"front", 23, 22, {-1, -1, -1}, -1},
  {"left",  21, 19, {-1, -1, -1}, -1},
  {"right", 18,  5, {-1, -1, -1}, -1},
  {"back",  17, 16, {-1, -1, -1}, -1},
};

// ---- tunables -------------------------------------------------------------
const int MIN_CM = 2;                              // closer than this the sensor cannot measure
const int MAX_CM = 400;                            // farther than this counts as no echo
const unsigned long ECHO_TIMEOUT_US = 25000;       // about 4.3 m there and back
const unsigned long PING_GAP_MS = 40;              // one sensor every 40 ms: all four about 6 times a second
const unsigned long REPORT_MIN_GAP_MS = 250;       // changes are sent at most this often
const int REPORT_STEP_CM = 3;                      // smaller changes are sensor jitter
const unsigned long STATUS_INTERVAL_MS = 2000;     // heartbeat; the server drops a silent board after 6 s

// ---- MPU-6050 tilt sensor (I2C) ----------------------------------------------
const int PIN_SDA = 32, PIN_SCL = 33;
const uint8_t MPU_ADDR = 0x68;                     // AD0 unconnected
const float ACCEL_LSB_PER_G = 16384.0;             // +-2 g
const float GYRO_LSB_PER_DPS = 65.5;               // +-500 deg/s
const float FILTER_TAU_S = 0.5;                    // tilt follows the gyro over this long, then settles to gravity
const float GYRO_DEADBAND_DPS = 0.4;               // ignore this much turning noise, so the heading creeps less
const unsigned long IMU_SAMPLE_MS = 10;
const unsigned long IMU_RETRY_MS = 3000;

// Angles in degrees. roll: + right side down. pitch: + nose up. yaw: heading, clockwise, 0..360, 0 at power-up.
bool imuOk = false;
float roll = 0, pitch = 0, yaw = 0;
float gyroBias[3] = {0, 0, 0};
unsigned long lastImuUs = 0, lastImuMs = 0, lastImuTryMs = 0;

// ---- pose reporting ------------------------------------------------------------
const unsigned long POSE_MIN_GAP_MS = 100;         // at most 10 updates a second
const unsigned long POSE_MAX_GAP_MS = 1000;        // and at least one
const float POSE_STEP_DEG = 0.5;
float sentRoll = 0, sentPitch = 0, sentYaw = 0;
unsigned long lastPoseMs = 0;

WebSocketsClient ws;
bool wsOpen = false, registered = false;
int reported[SONARS] = {-1, -1, -1, -1};
int nextSonar = 0;
unsigned long lastPingMs = 0, lastStatusMs = 0;

// ---- serial debugging (115200 baud) -----------------------------------------
// Every line starts with the seconds since boot. What to look for:
//   "DIST ..." every second          what each sensor measures now ("--" = no echo)
//   "TCP probe ... REACHABLE"        the laptop's server port answers: WS_HOST and the firewall are right
//   "registered with the server"     the dashboard shows the distance sensors online
unsigned long txCount = 0, wsDrops = 0, lastDebugMs = 0, lastDistMs = 0, lastProbeMs = 0;

void stamp() { Serial.printf("[%7.1fs] ", millis() / 1000.0); }

void probeServer() {
  WiFiClient probe;
  stamp();
  Serial.printf("TCP probe %s:%d ... ", WS_HOST, WS_PORT);
  bool ok = probe.connect(WS_HOST, WS_PORT, 1500);
  Serial.println(ok ? "REACHABLE" : "UNREACHABLE");
  if (ok) {
    probe.stop();
  } else {
    Serial.println("   check: (1) WS_HOST is the laptop's address on THIS WiFi (run ipconfig)");
    Serial.println("          (2) the server is running (npm run dev)   (3) Windows Firewall allows port 5000");
    Serial.println("          (4) the router/hotspot does not isolate WiFi clients   (5) the ESP32 is on 2.4 GHz");
  }
  lastProbeMs = millis();
}

void onWifiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_CONNECTED:
      stamp();
      Serial.println("WiFi: joined the access point");
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      stamp();
      Serial.printf("WiFi: got IP %s (gateway %s)\n", WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str());
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      stamp();
      Serial.printf("WiFi: DISCONNECTED, reason %d (wrong password = 15 or 202, network not found = 201)\n", info.wifi_sta_disconnected.reason);
      break;
    default:
      break;
  }
}

// One measurement in whole centimetres, or -1 when nothing echoes back in range.
int measure(const Sonar& s) {
  digitalWrite(s.trig, LOW);
  delayMicroseconds(3);
  digitalWrite(s.trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(s.trig, LOW);
  unsigned long us = pulseIn(s.echo, HIGH, ECHO_TIMEOUT_US);
  if (us == 0) return -1;
  int cm = (int)(us / 58);                         // sound: about 58 microseconds per cm, there and back
  return (cm < MIN_CM || cm > MAX_CM) ? -1 : cm;
}

// The middle of the last three readings: one stray echo or one miss does not show. "No echo" sorts as farthest.
int median3(const int h[3]) {
  int a = h[0] < 0 ? 9999 : h[0], b = h[1] < 0 ? 9999 : h[1], c = h[2] < 0 ? 9999 : h[2];
  int mid = max(min(a, b), min(max(a, b), c));
  return mid == 9999 ? -1 : mid;
}

void sendStatus() {
  if (!registered) return;
  JsonDocument doc;
  doc["type"] = "sonar_status";
  for (int i = 0; i < SONARS; i++) {
    doc[sonars[i].name] = sonars[i].cm;
    reported[i] = sonars[i].cm;
  }
  doc["rssi"] = WiFi.RSSI();
  String out;
  serializeJson(doc, out);
  ws.sendTXT(out);
  txCount++;
  lastStatusMs = millis();
}

// Ping the next sensor in turn.
void updateSonars() {
  unsigned long now = millis();
  if (now - lastPingMs < PING_GAP_MS) return;
  lastPingMs = now;
  Sonar& s = sonars[nextSonar];
  s.history[2] = s.history[1];
  s.history[1] = s.history[0];
  s.history[0] = measure(s);
  s.cm = median3(s.history);
  nextSonar = (nextSonar + 1) % SONARS;
}

bool distancesChanged() {
  for (int i = 0; i < SONARS; i++) {
    int now = sonars[i].cm, before = reported[i];
    if ((now < 0) != (before < 0) || abs(now - before) >= REPORT_STEP_CM) return true;
  }
  return false;
}

void printDistances() {
  stamp();
  Serial.print("DIST");
  for (int i = 0; i < SONARS; i++) {
    if (sonars[i].cm < 0) Serial.printf("  %s --", sonars[i].name);
    else Serial.printf("  %s %d cm", sonars[i].name, sonars[i].cm);
  }
  Serial.println();
}

bool mpuWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

// Acceleration (x, y, z) and rotation (x, y, z) as raw counts.
bool mpuRead(int16_t accel[3], int16_t gyro[3]) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)MPU_ADDR, 14) != 14) return false;
  int16_t v[7];
  for (int i = 0; i < 7; i++) {
    int high = Wire.read();
    v[i] = (int16_t)((high << 8) | Wire.read());
  }
  for (int i = 0; i < 3; i++) {
    accel[i] = v[i];
    gyro[i] = v[4 + i];                            // v[3] is the temperature
  }
  return true;
}

void tiltFromGravity(const int16_t a[3], float& r, float& p) {
  float ax = a[0] / ACCEL_LSB_PER_G, ay = a[1] / ACCEL_LSB_PER_G, az = a[2] / ACCEL_LSB_PER_G;
  r = atan2(ay, az) * RAD_TO_DEG;
  p = atan2(ax, sqrt(ay * ay + az * az)) * RAD_TO_DEG;
}

// Wake the sensor, then measure the gyro's resting offset. Call while the rover is still.
void startImu() {
  lastImuTryMs = millis();
  imuOk = false;
  if (!mpuWrite(0x6B, 0x00)) {
    stamp();
    Serial.println("MPU-6050 not found: check VCC, GND, SDA on GPIO 32 and SCL on GPIO 33");
    return;
  }
  delay(50);
  mpuWrite(0x1A, 0x03);                            // 44 Hz low-pass: rides out motor vibration
  mpuWrite(0x1B, 0x08);                            // gyro +-500 deg/s
  mpuWrite(0x1C, 0x00);                            // accelerometer +-2 g
  delay(50);
  stamp();
  Serial.println("MPU-6050 found: zeroing the gyro, keep the rover still...");
  long sum[3] = {0, 0, 0};
  int good = 0;
  int16_t a[3], g[3], lastA[3] = {0, 0, 0};
  for (int n = 0; n < 400; n++) {
    if (mpuRead(a, g)) {
      for (int i = 0; i < 3; i++) {
        sum[i] += g[i];
        lastA[i] = a[i];
      }
      good++;
    }
    delay(3);
  }
  if (good < 200) {
    stamp();
    Serial.println("MPU-6050 answers badly: check the wires, will retry");
    return;
  }
  for (int i = 0; i < 3; i++) gyroBias[i] = (float)sum[i] / good;
  tiltFromGravity(lastA, roll, pitch);
  lastImuUs = micros();
  imuOk = true;
  stamp();
  Serial.printf("MPU-6050 ready: roll %.1f, pitch %.1f deg\n", roll, pitch);
}

// Complementary filter: the gyro gives quick movement, gravity stops the tilt drifting.
void updateImu() {
  unsigned long now = millis();
  if (!imuOk) {
    if (now - lastImuTryMs >= IMU_RETRY_MS) startImu();
    return;
  }
  if (now - lastImuMs < IMU_SAMPLE_MS) return;
  lastImuMs = now;
  int16_t a[3], g[3];
  if (!mpuRead(a, g)) {
    imuOk = false;
    lastImuTryMs = now;
    stamp();
    Serial.println("MPU-6050 stopped answering");
    return;
  }
  unsigned long us = micros();
  float dt = (us - lastImuUs) / 1e6;
  lastImuUs = us;
  if (dt > 0.2) dt = 0.2;                          // after a long stall, do not integrate a guess
  float rate[3];
  for (int i = 0; i < 3; i++) rate[i] = (g[i] - gyroBias[i]) / GYRO_LSB_PER_DPS;
  float accelRoll, accelPitch;
  tiltFromGravity(a, accelRoll, accelPitch);
  float k = FILTER_TAU_S / (FILTER_TAU_S + dt);
  roll = k * (roll + rate[0] * dt) + (1 - k) * accelRoll;
  pitch = k * (pitch - rate[1] * dt) + (1 - k) * accelPitch;
  if (fabs(rate[2]) > GYRO_DEADBAND_DPS) {
    yaw -= rate[2] * dt;                           // clockwise positive, like a compass
    while (yaw < 0) yaw += 360;
    while (yaw >= 360) yaw -= 360;
  }
}

void sendPose() {
  if (!registered) return;
  JsonDocument doc;
  doc["type"] = "pose_status";
  doc["imu"] = imuOk;
  if (imuOk) {
    doc["roll"] = round(roll * 10) / 10.0;
    doc["pitch"] = round(pitch * 10) / 10.0;
    doc["yaw"] = round(yaw * 10) / 10.0;
  }
  String out;
  serializeJson(doc, out);
  ws.sendTXT(out);
  txCount++;
  sentRoll = roll;
  sentPitch = pitch;
  sentYaw = yaw;
  lastPoseMs = millis();
}

bool poseChanged() {
  return imuOk && (fabs(roll - sentRoll) >= POSE_STEP_DEG || fabs(pitch - sentPitch) >= POSE_STEP_DEG ||
                   fabs(yaw - sentYaw) >= POSE_STEP_DEG);
}

void printPose() {
  stamp();
  if (imuOk) Serial.printf("POSE roll %.1f  pitch %.1f  heading %.1f deg", roll, pitch, yaw);
  else Serial.print("POSE tilt sensor not available");
  Serial.println();
}

void onEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      wsOpen = true;
      stamp();
      Serial.printf("websocket OPEN to %s:%d, registering as %s\n", WS_HOST, WS_PORT, DEVICE_ID);
      JsonDocument doc;
      doc["type"] = "device_register";
      doc["deviceId"] = DEVICE_ID;
      doc["key"] = ROVER_KEY;
      String out;
      serializeJson(doc, out);
      ws.sendTXT(out);
      txCount++;
      break;
    }
    case WStype_DISCONNECTED:
      stamp();
      if (wsOpen) {
        wsDrops++;
        Serial.println("websocket CLOSED, retrying every 2 s");
      } else {
        Serial.printf("websocket could not connect to %s:%d, retrying (WiFi %s)\n", WS_HOST, WS_PORT,
                      WiFi.status() == WL_CONNECTED ? "is up: see the TCP probe" : "is DOWN");
      }
      wsOpen = false;
      registered = false;
      break;
    case WStype_ERROR:
      stamp();
      Serial.printf("websocket ERROR %.60s\n", length ? (const char*)payload : "");
      break;
    case WStype_TEXT: {
      JsonDocument doc;
      if (deserializeJson(doc, (const char*)payload)) return;
      const char* t = doc["type"] | "";
      if (strcmp(t, "register_ack") == 0) {
        registered = true;
        stamp();
        Serial.println("registered with the server: the dashboard should show the distance sensors online");
        sendStatus();
        sendPose();
      } else if (strcmp(t, "error") == 0) {
        stamp();
        Serial.printf("server ERROR: %s  (\"bad key\" = ROVER_KEY differs from ACCESS_KEY in .env)\n", (const char*)(doc["error"] | "?"));
      }
      break;
    }
    default:
      break;
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\nAgriVision 6WD - THIRD ESP32 (WebSocket, four ultrasonic sensors)");
  for (int i = 0; i < SONARS; i++) {
    pinMode(sonars[i].trig, OUTPUT);
    digitalWrite(sonars[i].trig, LOW);
    pinMode(sonars[i].echo, INPUT_PULLDOWN);       // an unplugged sensor reads "no echo" instead of noise
    Serial.printf("sensor %-5s Trig GPIO %2d, Echo GPIO %2d\n", sonars[i].name, sonars[i].trig, sonars[i].echo);
  }

  Wire.begin(PIN_SDA, PIN_SCL, 400000);
  Wire.setTimeOut(20);
  startImu();

  WiFi.onEvent(onWifiEvent);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("connecting to WiFi \"%s\"", WIFI_SSID);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(300);
    Serial.print('.');
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nWiFi connected, ip %s, rssi %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    IPAddress host;
    if (host.fromString(WS_HOST) && ((uint32_t)host & (uint32_t)WiFi.subnetMask()) != ((uint32_t)WiFi.localIP() & (uint32_t)WiFi.subnetMask())) {
      Serial.printf("WARNING: WS_HOST %s is on a different network from this board (%s, mask %s): use the laptop's address on THIS WiFi\n",
                    WS_HOST, WiFi.localIP().toString().c_str(), WiFi.subnetMask().toString().c_str());
    }
    probeServer();
  } else {
    Serial.println("\nWiFi not connected yet (2.4 GHz only): will keep trying");
  }
  Serial.printf("server ws://%s:%d/ws?role=sonar as %s\n", WS_HOST, WS_PORT, DEVICE_ID);
  ws.begin(WS_HOST, WS_PORT, "/ws?role=sonar");
  ws.onEvent(onEvent);
  ws.setReconnectInterval(2000);
  ws.enableHeartbeat(15000, 3000, 2);
}

void loop() {
  ws.loop();
  updateImu();
  updateSonars();
  unsigned long now = millis();
  if (registered && ((now - lastPoseMs >= POSE_MIN_GAP_MS && poseChanged()) || now - lastPoseMs >= POSE_MAX_GAP_MS)) sendPose();
  if (registered && now - lastStatusMs >= REPORT_MIN_GAP_MS && distancesChanged()) sendStatus();
  if (registered && now - lastStatusMs >= STATUS_INTERVAL_MS) sendStatus();  // heartbeat
  if (now - lastDistMs >= 1000) {
    lastDistMs = now;
    printDistances();
    printPose();
  }
  if (now - lastDebugMs >= 5000) {
    lastDebugMs = now;
    stamp();
    Serial.printf("STATE wifi %s %d dBm | ws %s%s | tx %lu drops %lu\n", WiFi.status() == WL_CONNECTED ? "UP" : "DOWN", WiFi.RSSI(),
                  wsOpen ? "open" : "CLOSED", registered ? "+registered" : "", txCount, wsDrops);
  }
  // WiFi is up but the WebSocket is not: probe the server port again so the cause is visible.
  if (!wsOpen && WiFi.status() == WL_CONNECTED && now - lastProbeMs >= 15000) probeServer();
}
