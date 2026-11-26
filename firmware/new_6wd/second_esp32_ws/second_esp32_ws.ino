/*
  AgriVision 6WD: SECOND ESP32 (rear axle, one TB6612FNG driver, one left + one right motor): WebSocket version.

  Connects to  ws://<laptop>:5000/ws?role=motor  as an extra motor board. The server copies every
  drive command (forward / backward / left / right / stop) to it, so the rear wheels move with the others.
  Start the first ESP32 (first_esp32_ws) as well: it is the board the dashboard shows as "the rover".
  This server needs the motor-board role (added in server/src/hub.js): restart the server after updating it.

  Motor power is fixed at 50 percent (MOTOR_POWER below). Change it there.

    PA GPIO 32  PWM   motor A = LEFT rear
    A1 GPIO 25  direction A
    A2 GPIO 33  direction A
    B1 GPIO 26  direction B
    B2 GPIO 27  direction B
    PB GPIO 14  PWM   motor B = RIGHT rear
  Board: STBY and VCC to 3.3 V, VM to battery +, GND shared with battery - and this ESP32.

  Light sensor: digital output (DO) on GPIO 5; power it from 3.3 V. The dashboard's Status page shows dark / bright.

  Headlights: front GPIO 16, rear GPIO 17. Automatic from the light sensor; the dashboard can override.

  Soil moisture sensor: analog output (AO) on GPIO 35. Rain sensor: analog output (AO) on GPIO 34.
  Power both from 3.3 V (the pins must never see more than 3.3 V). The dashboard's Field sensors page shows them.

  Camera pan servo: signal on GPIO 13 (the dashboard's Left / Right camera buttons). 5 V supply, common ground.

  Flame sensor (5 channels): D1 GPIO 18, D2 GPIO 19, D3 GPIO 21, D4 GPIO 22, D5 GPIO 23.
  It connects as its own device (?role=sensor) so the dashboard's fire card works as before.
  Set FIRE_ACTIVE_LOW below if your module pulls the pin LOW when it sees flame.

  Libraries (Library Manager): "WebSockets" by Markus Sattler, "ArduinoJson" v7. Board package: esp32 3.x.
  WiFi and server settings: copy secrets.example.h to secrets.h in this folder and fill it in.

  Safety: the motors stop if no drive command arrives for COMMAND_TIMEOUT_MS (the dashboard repeats the
  command while a key is held), and whenever the WebSocket or WiFi drops.
*/

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

#include "secrets.h"

// ---- pins (exactly as specified for the third driver set) ------------------
const int PIN_PA = 32, PIN_A1 = 25, PIN_A2 = 33;
const int PIN_B1 = 26, PIN_B2 = 27, PIN_PB = 14;

const bool INVERT_LEFT  = false;   // flip if that wheel turns the wrong way for "forward"
const bool INVERT_RIGHT = false;

// ---- camera pan servo -----------------------------------------------------
// GPIO 13 drives a hobby servo that turns the camera left and right. The dashboard's Left / Right buttons send
// camera_pan steps; each one moves the servo SERVO_STEP_DEG degrees. Power the servo from 5 V (not the ESP32's
// 3.3 V pin) and join its ground to this board's ground.
const int PIN_SERVO = 13;
const int SERVO_CENTER_DEG = 90;                  // where it points at power-up
const int SERVO_MIN_DEG = 0;                      // keep the camera cable from being pulled: narrow these if it binds
const int SERVO_MAX_DEG = 180;
const int SERVO_STEP_DEG = 4;                     // per command; the dashboard repeats while a button is held
const int SERVO_MIN_US = 500;                     // pulse width at 0 degrees
const int SERVO_MAX_US = 2400;                    // pulse width at 180 degrees
const bool SERVO_REVERSED = false;                // true if "Left" turns the camera to the right
const int SERVO_PWM_FREQ = 50;                    // standard servo frame: 20 ms
const int SERVO_PWM_BITS = 16;

// ---- light sensor ----------------------------------------------------------
// The module's digital output (DO) on GPIO 5. GPIO 5 is read at boot by the chip, but only for a setting this
// board does not use, so a sensor holding it either way does not stop it starting.
const int PIN_LIGHT = 5;
const bool DARK_IS_LOW = false;                   // true if your module outputs LOW in darkness
const unsigned long LIGHT_CHECK_MS = 100;
const unsigned long LIGHT_STABLE_MS = 800;        // a new reading must hold this long (ignores flicker and shadows)

// ---- headlights ------------------------------------------------------------
// Automatic by default: on when the light sensor says DARK, off when it says BRIGHT. The dashboard's Lights page
// can take over (any lamp change switches to manual) or hand control back to AUTO. Auto keeps working with no WiFi.
// A GPIO can only drive a small LED (with a resistor): switch bigger headlights with a transistor or MOSFET module.
const int PIN_LAMP_FRONT = 16;
const int PIN_LAMP_REAR = 17;
const int LAMP_PWM_FREQ = 5000;
const int LAMP_PWM_BITS = 8;
const int LAMP_AUTO_PERCENT = 100;                // brightness when auto switches them on

// ---- soil moisture and rain sensors (analog) --------------------------------
// GPIO 34 and 35 are input-only pins on ADC1, which keeps working while WiFi is on. Calibration: the "STATE field"
// line in the Serial Monitor prints the raw readings (0..4095). Put the reading for a DRY sensor in *_DRY_RAW and
// the reading for a WET one in *_WET_RAW. A pin with nothing connected floats and shows random values.
const int PIN_SOIL = 35;
const int PIN_RAIN = 34;
const int SOIL_DRY_RAW = 3200;                    // probe in air / dry soil
const int SOIL_WET_RAW = 1400;                    // probe in water / soaked soil
const int RAIN_DRY_RAW = 4095;                    // dry plate
const int RAIN_WET_RAW = 1500;                    // wet plate
const unsigned long FIELD_SAMPLE_MS = 500;
const int FIELD_REPORT_STEP = 3;                  // percent: smaller changes are ADC jitter

// ---- tunables -------------------------------------------------------------
const int MOTOR_POWER = 128;                    // 0..255 duty: 128 = 50 percent
const int PWM_FREQ = 20000;
const int PWM_BITS = 8;
const unsigned long COMMAND_TIMEOUT_MS = 500;
const unsigned long STATUS_INTERVAL_MS = 2000;    // heartbeat; the server drops a silent board after 6 s

struct Motor {
  int pwm, in1, in2;
  bool invert;
};

Motor leftMotor  = {PIN_PA, PIN_A1, PIN_A2, INVERT_LEFT};
Motor rightMotor = {PIN_PB, PIN_B1, PIN_B2, INVERT_RIGHT};

WebSocketsClient ws;
const char* motion = "stop";
bool registered = false;
unsigned long lastCommandMs = 0;
unsigned long lastStatusMs = 0;

// ---- serial debugging (115200 baud) -----------------------------------------
// Every line starts with the seconds since boot. What to look for:
//   "WiFi: got IP"                  the board joined your WiFi
//   "TCP probe ... REACHABLE"       the laptop's server port answers: WS_HOST and the firewall are right
//   "websocket OPEN"                the WebSocket handshake worked
//   "registered with the server"    the server accepted this board: the dashboard shows "Rear motor board: online"
//   "STATE ..." every 5 s           one-line summary: WiFi, WebSocket, motion, message counts
unsigned long txCount = 0, rxCount = 0, wsDrops = 0, lastDebugMs = 0, lastProbeMs = 0;
bool wsOpen = false;

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

void debugLine() {
  stamp();
  Serial.printf("STATE wifi %s %d dBm | ws %s%s | motion %s | tx %lu rx %lu drops %lu\n",
                WiFi.status() == WL_CONNECTED ? "UP" : "DOWN", WiFi.RSSI(), wsOpen ? "open" : "CLOSED",
                registered ? "+registered" : "", motion, txCount, rxCount, wsDrops);
}

// ---- five-channel flame sensor (D1..D5) -------------------------------------
// Reported to the server as its own device (ws://<laptop>:5000/ws?role=sensor), so the dashboard's fire card
// lights up exactly as it did with the separate fire-sensor board.
const int FIRE_CHANNELS = 5;
const int FIRE_PINS[FIRE_CHANNELS] = {18, 19, 21, 22, 23};   // D1, D2, D3, D4, D5
const bool FIRE_ACTIVE_LOW = false;                          // false: the module's pin goes HIGH on flame (as the old fire board). true: LOW on flame.
const unsigned long FIRE_SAMPLE_MS = 20;
const unsigned long FIRE_CONFIRM_MS = 150;                   // a flame must hold this long to count
const unsigned long FIRE_CLEAR_MS = 600;                     // and be gone this long to clear

WebSocketsClient fireWs;
bool fireOpen = false, fireRegistered = false;
bool fire[FIRE_CHANNELS] = {false, false, false, false, false};
bool rawSeen[FIRE_CHANNELS] = {false, false, false, false, false};
unsigned long changedAt[FIRE_CHANNELS] = {0, 0, 0, 0, 0};
unsigned long lastSampleMs = 0, lastFireStatusMs = 0;

int fireCount() {
  int n = 0;
  for (int i = 0; i < FIRE_CHANNELS; i++) n += fire[i] ? 1 : 0;
  return n;
}

void sendFireStatus() {
  if (!fireRegistered) return;
  JsonDocument doc;
  doc["type"] = "fire_status";
  JsonArray d = doc["d"].to<JsonArray>();
  for (int i = 0; i < FIRE_CHANNELS; i++) d.add(fire[i] ? 1 : 0);
  doc["rssi"] = WiFi.RSSI();
  String out;
  serializeJson(doc, out);
  fireWs.sendTXT(out);
  lastFireStatusMs = millis();
  stamp();
  Serial.printf("TX fire_status | D1..D5 = %c %c %c %c %c | %d of %d see fire\n", fire[0] ? 'X' : '-', fire[1] ? 'X' : '-',
                fire[2] ? 'X' : '-', fire[3] ? 'X' : '-', fire[4] ? 'X' : '-', fireCount(), FIRE_CHANNELS);
}

// Sample every channel, debounce it, and report a change at once.
void updateFire() {
  unsigned long now = millis();
  if (now - lastSampleMs < FIRE_SAMPLE_MS) return;
  lastSampleMs = now;
  bool changed = false;
  for (int i = 0; i < FIRE_CHANNELS; i++) {
    bool r = digitalRead(FIRE_PINS[i]) == (FIRE_ACTIVE_LOW ? LOW : HIGH);
    if (r != rawSeen[i]) {
      rawSeen[i] = r;
      changedAt[i] = now;
      stamp();
      Serial.printf("PIN D%d (GPIO %d) reads %s -> %s\n", i + 1, FIRE_PINS[i], digitalRead(FIRE_PINS[i]) ? "HIGH" : "LOW", r ? "flame" : "no flame");
    }
    unsigned long hold = rawSeen[i] ? FIRE_CONFIRM_MS : FIRE_CLEAR_MS;
    if (fire[i] != rawSeen[i] && now - changedAt[i] >= hold) {
      fire[i] = rawSeen[i];
      changed = true;
      stamp();
      Serial.printf("FIRE D%d %s (%d of %d channels now see fire)\n", i + 1, fire[i] ? "DETECTED" : "cleared", fireCount(), FIRE_CHANNELS);
    }
  }
  if (changed) sendFireStatus();
}

void onFireEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      fireOpen = true;
      stamp();
      Serial.println("fire websocket OPEN, registering the flame sensor");
      JsonDocument doc;
      doc["type"] = "device_register";
      doc["deviceId"] = String(DEVICE_ID) + "-FIRE";
      doc["key"] = ROVER_KEY;
      String out;
      serializeJson(doc, out);
      fireWs.sendTXT(out);
      break;
    }
    case WStype_DISCONNECTED:
      if (fireOpen) {
        stamp();
        Serial.println("fire websocket CLOSED, retrying");
      }
      fireOpen = false;
      fireRegistered = false;
      break;
    case WStype_TEXT: {
      JsonDocument doc;
      if (deserializeJson(doc, (const char*)payload)) return;
      const char* t = doc["type"] | "";
      if (strcmp(t, "register_ack") == 0) {
        fireRegistered = true;
        stamp();
        Serial.println("flame sensor registered: the dashboard fire card should now show ONLINE");
        sendFireStatus();
      } else if (strcmp(t, "error") == 0) {
        stamp();
        Serial.printf("fire server ERROR: %s\n", (const char*)(doc["error"] | "?"));
      }
      break;
    }
    default:
      break;
  }
}

// speed -255..255: positive forward, negative reverse, 0 stop
void setMotor(const Motor& m, int speed) {
  if (m.invert) speed = -speed;
  digitalWrite(m.in1, speed > 0 ? HIGH : LOW);
  digitalWrite(m.in2, speed < 0 ? HIGH : LOW);
  ledcWrite(m.pwm, abs(speed));
}

void drive(int left, int right) {
  setMotor(leftMotor, left);
  setMotor(rightMotor, right);
}

int panDeg = SERVO_CENTER_DEG;
bool dark = false, rawDark = false;
unsigned long lastLightCheckMs = 0, rawDarkSinceMs = 0;

bool readDark() {
  bool high = digitalRead(PIN_LIGHT) == HIGH;
  return DARK_IS_LOW ? !high : high;
}

bool autoLights = true;
int frontPercent = 0, rearPercent = 0;

void writeLamps() {
  ledcWrite(PIN_LAMP_FRONT, map(frontPercent, 0, 100, 0, 255));
  ledcWrite(PIN_LAMP_REAR, map(rearPercent, 0, 100, 0, 255));
}

// Auto mode: the light sensor decides both lamps.
void applyAutoLights() {
  if (!autoLights) return;
  frontPercent = rearPercent = dark ? LAMP_AUTO_PERCENT : 0;
  writeLamps();
}

// Point the servo at an angle: a pulse of SERVO_MIN_US..SERVO_MAX_US every 20 ms.
void servoWrite(int deg) {
  deg = constrain(deg, SERVO_MIN_DEG, SERVO_MAX_DEG);
  panDeg = deg;
  long us = SERVO_MIN_US + (long)(SERVO_MAX_US - SERVO_MIN_US) * deg / 180;
  uint32_t duty = (uint32_t)((uint64_t)us * ((1UL << SERVO_PWM_BITS) - 1) / (1000000UL / SERVO_PWM_FREQ));
  ledcWrite(PIN_SERVO, duty);
}

void panCamera(const char* direction) {
  int sign = strcmp(direction, "left") == 0 ? -1 : strcmp(direction, "right") == 0 ? 1 : 0;
  if (sign == 0) return;
  if (SERVO_REVERSED) sign = -sign;
  int before = panDeg;
  servoWrite(panDeg + sign * SERVO_STEP_DEG);
  stamp();
  Serial.printf("camera pan %s: %d -> %d deg%s\n", direction, before, panDeg, panDeg == before ? " (end of travel)" : "");
}

void setupMotor(const Motor& m) {
  pinMode(m.in1, OUTPUT);
  pinMode(m.in2, OUTPUT);
  digitalWrite(m.in1, LOW);
  digitalWrite(m.in2, LOW);
  ledcAttach(m.pwm, PWM_FREQ, PWM_BITS);
  ledcWrite(m.pwm, 0);
}

// Soil and rain: raw ADC readings and the wetness last reported, 0 = dry .. 100 = wet.
int soilRaw = 0, rainRaw = 0;
int soilPct = 0, rainPct = 0;
unsigned long lastFieldMs = 0;

// Mean of several reads, to flatten ADC noise.
int readAnalog(int pin) {
  long sum = 0;
  for (int i = 0; i < 8; i++) sum += analogRead(pin);
  return (int)(sum / 8);
}

// Scale a raw reading between the dry and wet calibration points.
int toWetness(int raw, int dryRaw, int wetRaw) {
  return constrain((int)map(raw, dryRaw, wetRaw, 0, 100), 0, 100);
}

void readFieldSensors(int& soil, int& rain) {
  soilRaw = readAnalog(PIN_SOIL);
  rainRaw = readAnalog(PIN_RAIN);
  soil = toWetness(soilRaw, SOIL_DRY_RAW, SOIL_WET_RAW);
  rain = toWetness(rainRaw, RAIN_DRY_RAW, RAIN_WET_RAW);
}

void sendStatus() {
  if (!registered) return;
  JsonDocument doc;
  doc["type"] = "motor_status";
  doc["motion"] = motion;
  doc["pan"] = panDeg;
  doc["dark"] = dark;
  doc["front"] = frontPercent;
  doc["rear"] = rearPercent;
  doc["auto"] = autoLights;
  doc["soil"] = soilPct;
  doc["rain"] = rainPct;
  doc["rssi"] = WiFi.RSSI();
  String out;
  serializeJson(doc, out);
  ws.sendTXT(out);
  txCount++;
  lastStatusMs = millis();
}

// Sample the light sensor, ignore flicker, and report a real change at once.
void updateLight() {
  unsigned long now = millis();
  if (now - lastLightCheckMs < LIGHT_CHECK_MS) return;
  lastLightCheckMs = now;
  bool reading = readDark();
  if (reading != rawDark) {
    rawDark = reading;
    rawDarkSinceMs = now;
  }
  if (rawDark != dark && now - rawDarkSinceMs >= LIGHT_STABLE_MS) {
    dark = rawDark;
    stamp();
    Serial.printf("light: now %s (pin %d reads %s)\n", dark ? "DARK" : "BRIGHT", PIN_LIGHT, digitalRead(PIN_LIGHT) ? "HIGH" : "LOW");
    applyAutoLights();
    if (autoLights) {
      stamp();
      Serial.printf("headlights (auto) %s\n", dark ? "ON" : "OFF");
    }
    sendStatus();
  }
}

// Sample soil and rain, and report a real change at once (the heartbeat carries them otherwise).
void updateFieldSensors() {
  unsigned long now = millis();
  if (now - lastFieldMs < FIELD_SAMPLE_MS) return;
  lastFieldMs = now;
  int soil, rain;
  readFieldSensors(soil, rain);
  if (abs(soil - soilPct) < FIELD_REPORT_STEP && abs(rain - rainPct) < FIELD_REPORT_STEP) return;
  soilPct = soil;
  rainPct = rain;
  stamp();
  Serial.printf("field: soil %d%% wet (raw %d) | rain %d%% wet (raw %d)\n", soilPct, soilRaw, rainPct, rainRaw);
  sendStatus();
}

void setMotion(const char* next) {
  bool changed = strcmp(next, motion) != 0;
  motion = next;
  if (strcmp(next, "forward") == 0)       drive( MOTOR_POWER,  MOTOR_POWER);
  else if (strcmp(next, "backward") == 0) drive(-MOTOR_POWER, -MOTOR_POWER);
  else if (strcmp(next, "left") == 0)     drive(-MOTOR_POWER,  MOTOR_POWER);
  else if (strcmp(next, "right") == 0)    drive( MOTOR_POWER, -MOTOR_POWER);
  else { motion = "stop"; drive(0, 0); }
  if (changed) {
    stamp();
    Serial.printf("motion -> %s\n", motion);
    sendStatus();
  }
}

void onMessage(const char* text) {
  JsonDocument doc;
  if (deserializeJson(doc, text)) {
    stamp();
    Serial.printf("RX not JSON: %.80s\n", text);
    return;
  }
  rxCount++;
  const char* type = doc["type"] | "";
  if (strcmp(type, "register_ack") == 0) {
    registered = true;
    stamp();
    Serial.println("registered with the server: the dashboard should show REAR MOTOR BOARD online");
    sendStatus();
  } else if (strcmp(type, "rover_command") == 0) {
    lastCommandMs = millis();
    setMotion(doc["command"] | "stop");
  } else if (strcmp(type, "rover_light_command") == 0) {
    const char* light = doc["light"] | "";
    int level = constrain((int)(doc["level"] | 0), 0, 100);
    if (strcmp(light, "front") == 0) frontPercent = level;
    else if (strcmp(light, "rear") == 0) rearPercent = level;
    else return;
    autoLights = false;  // a manual change takes over from the sensor
    writeLamps();
    stamp();
    Serial.printf("headlight %s -> %d%% (manual)\n", light, level);
    sendStatus();
  } else if (strcmp(type, "rover_light_mode") == 0) {
    autoLights = strcmp(doc["mode"] | "", "auto") == 0;
    applyAutoLights();
    stamp();
    Serial.printf("headlights -> %s\n", autoLights ? "AUTO (follow the light sensor)" : "manual");
    sendStatus();
  } else if (strcmp(type, "camera_pan") == 0) {
    panCamera(doc["direction"] | "");
  } else if (strcmp(type, "error") == 0) {
    stamp();
    Serial.printf("server ERROR: %s  (\"bad key\" = ROVER_KEY differs from ACCESS_KEY in .env)\n", (const char*)(doc["error"] | "?"));
  }
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
        Serial.println("websocket CLOSED: motors stopped, retrying every 2 s");
      } else {
        Serial.printf("websocket could not connect to %s:%d, retrying (WiFi %s)\n", WS_HOST, WS_PORT,
                      WiFi.status() == WL_CONNECTED ? "is up: see the TCP probe" : "is DOWN");
      }
      wsOpen = false;
      registered = false;
      setMotion("stop");
      break;
    case WStype_ERROR:
      stamp();
      Serial.printf("websocket ERROR %.60s\n", length ? (const char*)payload : "");
      break;
    case WStype_TEXT:
      onMessage((const char*)payload);
      break;
    default:
      break;
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  setupMotor(leftMotor);
  setupMotor(rightMotor);
  Serial.println("\nAgriVision 6WD - SECOND ESP32 (WebSocket, rear axle, 50% power)");
  pinMode(PIN_LIGHT, INPUT);
  dark = rawDark = readDark();
  Serial.printf("light sensor DO on GPIO %d: %s now (dark = %s on the pin)\n", PIN_LIGHT, dark ? "DARK" : "BRIGHT", DARK_IS_LOW ? "LOW" : "HIGH");
  ledcAttach(PIN_LAMP_FRONT, LAMP_PWM_FREQ, LAMP_PWM_BITS);
  ledcAttach(PIN_LAMP_REAR, LAMP_PWM_FREQ, LAMP_PWM_BITS);
  applyAutoLights();
  Serial.printf("headlights front GPIO %d, rear GPIO %d: AUTO, now %s\n", PIN_LAMP_FRONT, PIN_LAMP_REAR, dark ? "ON" : "OFF");
  pinMode(PIN_SOIL, INPUT);
  pinMode(PIN_RAIN, INPUT);
  readFieldSensors(soilPct, rainPct);
  Serial.printf("soil sensor GPIO %d: %d%% wet (raw %d) | rain sensor GPIO %d: %d%% wet (raw %d)\n", PIN_SOIL, soilPct, soilRaw,
                PIN_RAIN, rainPct, rainRaw);
  ledcAttach(PIN_SERVO, SERVO_PWM_FREQ, SERVO_PWM_BITS);
  servoWrite(SERVO_CENTER_DEG);
  Serial.printf("camera servo on GPIO %d, centred at %d deg (range %d..%d, %d deg per step)\n", PIN_SERVO, SERVO_CENTER_DEG,
                SERVO_MIN_DEG, SERVO_MAX_DEG, SERVO_STEP_DEG);

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
  } else {
    Serial.println("\nWiFi not connected yet (2.4 GHz only): will keep trying");
  }

  if (WiFi.status() == WL_CONNECTED) {
    IPAddress host;
    if (host.fromString(WS_HOST) && ((uint32_t)host & (uint32_t)WiFi.subnetMask()) != ((uint32_t)WiFi.localIP() & (uint32_t)WiFi.subnetMask())) {
      Serial.printf("WARNING: WS_HOST %s is on a different network from this board (%s, mask %s): use the laptop's address on THIS WiFi\n",
                    WS_HOST, WiFi.localIP().toString().c_str(), WiFi.subnetMask().toString().c_str());
    }
    probeServer();
  }
  Serial.printf("server ws://%s:%d/ws?role=motor as %s\n", WS_HOST, WS_PORT, DEVICE_ID);
  ws.begin(WS_HOST, WS_PORT, "/ws?role=motor");
  ws.onEvent(onEvent);
  ws.setReconnectInterval(2000);
  ws.enableHeartbeat(15000, 3000, 2);

  // The flame sensor: its own input pins and its own connection (role=sensor).
  for (int i = 0; i < FIRE_CHANNELS; i++) pinMode(FIRE_PINS[i], FIRE_ACTIVE_LOW ? INPUT_PULLUP : INPUT_PULLDOWN);
  Serial.printf("flame sensor D1..D5 -> GPIO %d %d %d %d %d, flame = %s on the pin\n", FIRE_PINS[0], FIRE_PINS[1], FIRE_PINS[2],
                FIRE_PINS[3], FIRE_PINS[4], FIRE_ACTIVE_LOW ? "LOW" : "HIGH");
  fireWs.begin(WS_HOST, WS_PORT, "/ws?role=sensor");
  fireWs.onEvent(onFireEvent);
  fireWs.setReconnectInterval(2000);
  fireWs.enableHeartbeat(15000, 3000, 2);
}

void loop() {
  ws.loop();
  fireWs.loop();
  updateFire();
  updateLight();
  updateFieldSensors();
  unsigned long now = millis();
  if (fireRegistered && now - lastFireStatusMs >= STATUS_INTERVAL_MS) sendFireStatus();  // heartbeat
  if (strcmp(motion, "stop") != 0 && now - lastCommandMs > COMMAND_TIMEOUT_MS) {
    stamp();
    Serial.println("no command for 0.5 s: failsafe stop");
    setMotion("stop");
  }
  if (registered && now - lastStatusMs >= STATUS_INTERVAL_MS) sendStatus();
  if (now - lastDebugMs >= 5000) {
    lastDebugMs = now;
    debugLine();
    stamp();
    Serial.printf("STATE field soil %d%% (raw %d) | rain %d%% (raw %d)\n", soilPct, soilRaw, rainPct, rainRaw);
    stamp();
    Serial.printf("STATE fire ws %s%s | D1..D5 = %c %c %c %c %c\n", fireOpen ? "open" : "CLOSED", fireRegistered ? "+registered" : "",
                  fire[0] ? 'X' : '-', fire[1] ? 'X' : '-', fire[2] ? 'X' : '-', fire[3] ? 'X' : '-', fire[4] ? 'X' : '-');
  }
  // WiFi is up but the WebSocket is not: probe the server port again so the cause is visible.
  if (!wsOpen && WiFi.status() == WL_CONNECTED && now - lastProbeMs >= 15000) probeServer();
}
