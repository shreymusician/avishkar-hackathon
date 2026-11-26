/*
  AgriVision 6WD: FIRST ESP32 (front + middle axles, two TB6612FNG drivers, four motors): WebSocket version.

  This board is THE rover as far as the server and dashboard are concerned: it connects to
      ws://<laptop>:5000/ws?role=rover
  registers, obeys rover_command (forward / backward / left / right / stop) and reports a status heartbeat.
  The second ESP32 (second_esp32_ws) connects separately and receives the same drive commands.

  Motor power is fixed at 50 percent (MOTOR_POWER below). Change it there.

  Driver 1 (front axle)                       Driver 2 (middle axle)
    PA GPIO 32  PWM   A = left front            PA GPIO 4   PWM   A = left middle
    A1 GPIO 25                                  A1 GPIO 17
    A2 GPIO 33                                  A2 GPIO 16
    B1 GPIO 26                                  B1 GPIO 18
    B2 GPIO 27                                  B2 GPIO 19
    PB GPIO 14  PWM   B = right front           PB GPIO 21  PWM   B = right middle

  Both boards: STBY and VCC to 3.3 V, VM to battery +, GND shared with battery - and this ESP32.

  Libraries (Library Manager): "WebSockets" by Markus Sattler, "ArduinoJson" v7. Board package: esp32 3.x.
  WiFi and server settings: copy secrets.example.h to secrets.h in this folder and fill it in.

  Safety: the motors stop if no drive command arrives for COMMAND_TIMEOUT_MS (the dashboard repeats the
  command while a key is held), and whenever the WebSocket or WiFi drops.
*/

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

#include "secrets.h"

// ---- pins -----------------------------------------------------------------
const int D1_PA = 32, D1_A1 = 25, D1_A2 = 33;
const int D1_B1 = 26, D1_B2 = 27, D1_PB = 14;
const int D2_PA = 4,  D2_A1 = 17, D2_A2 = 16;
const int D2_B1 = 18, D2_B2 = 19, D2_PB = 21;

// Flip a flag if that wheel turns the wrong way for "forward" (or swap its two motor wires).
const bool INVERT_LEFT_FRONT   = false;
const bool INVERT_RIGHT_FRONT  = false;
const bool INVERT_LEFT_MIDDLE  = false;
const bool INVERT_RIGHT_MIDDLE = false;

// ---- tunables -------------------------------------------------------------
const int MOTOR_POWER = 128;                      // 0..255 duty: 128 = 50 percent
const int PWM_FREQ = 20000;                       // 20 kHz
const int PWM_BITS = 8;
const unsigned long COMMAND_TIMEOUT_MS = 500;     // stop if the commands stop coming
const unsigned long STATUS_INTERVAL_MS = 2000;    // heartbeat; the server drops a silent board after 6 s

struct Motor {
  int pwm, in1, in2;
  bool invert;
};

Motor leftFront   = {D1_PA, D1_A1, D1_A2, INVERT_LEFT_FRONT};
Motor rightFront  = {D1_PB, D1_B1, D1_B2, INVERT_RIGHT_FRONT};
Motor leftMiddle  = {D2_PA, D2_A1, D2_A2, INVERT_LEFT_MIDDLE};
Motor rightMiddle = {D2_PB, D2_B1, D2_B2, INVERT_RIGHT_MIDDLE};

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
//   "registered with the server"    the server accepted this board: the dashboard shows the rover online
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

// speed -255..255: positive forward, negative reverse, 0 stop
void setMotor(const Motor& m, int speed) {
  if (m.invert) speed = -speed;
  digitalWrite(m.in1, speed > 0 ? HIGH : LOW);
  digitalWrite(m.in2, speed < 0 ? HIGH : LOW);
  ledcWrite(m.pwm, abs(speed));
}

void drive(int left, int right) {
  setMotor(leftFront, left);
  setMotor(leftMiddle, left);
  setMotor(rightFront, right);
  setMotor(rightMiddle, right);
}

void setupMotor(const Motor& m) {
  pinMode(m.in1, OUTPUT);
  pinMode(m.in2, OUTPUT);
  digitalWrite(m.in1, LOW);
  digitalWrite(m.in2, LOW);
  ledcAttach(m.pwm, PWM_FREQ, PWM_BITS);
  ledcWrite(m.pwm, 0);
}

void sendStatus() {
  if (!registered) return;
  JsonDocument doc;
  doc["type"] = "status";
  doc["motion"] = motion;
  doc["front"] = 0;   // no headlights on this board
  doc["rear"] = 0;
  doc["rssi"] = WiFi.RSSI();
  String out;
  serializeJson(doc, out);
  ws.sendTXT(out);
  txCount++;
  lastStatusMs = millis();
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
    Serial.println("registered with the server: the dashboard should now show this rover ONLINE");
    sendStatus();
  } else if (strcmp(type, "rover_command") == 0) {
    lastCommandMs = millis();
    setMotion(doc["command"] | "stop");
  } else if (strcmp(type, "rover_ping") == 0) {
    JsonDocument pong;
    pong["type"] = "pong";
    pong["id"] = doc["id"] | 0;
    String out;
    serializeJson(pong, out);
    ws.sendTXT(out);
    txCount++;
  } else if (strcmp(type, "error") == 0) {
    stamp();
    Serial.printf("server ERROR: %s  (\"bad key\" = ROVER_KEY differs from ACCESS_KEY in .env)\n", (const char*)(doc["error"] | "?"));
  }
  // lights, nav mode, horn and the rest do not apply to this board: ignored
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
  setupMotor(leftFront);
  setupMotor(rightFront);
  setupMotor(leftMiddle);
  setupMotor(rightMiddle);
  Serial.println("\nAgriVision 6WD - FIRST ESP32 (WebSocket, 4 motors, 50% power)");

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
  Serial.printf("server ws://%s:%d/ws?role=rover as %s\n", WS_HOST, WS_PORT, DEVICE_ID);
  ws.begin(WS_HOST, WS_PORT, "/ws?role=rover");
  ws.onEvent(onEvent);
  ws.setReconnectInterval(2000);
  ws.enableHeartbeat(15000, 3000, 2);
}

void loop() {
  ws.loop();
  unsigned long now = millis();
  if (strcmp(motion, "stop") != 0 && now - lastCommandMs > COMMAND_TIMEOUT_MS) {
    stamp();
    Serial.println("no command for 0.5 s: failsafe stop");
    setMotion("stop");
  }
  if (registered && now - lastStatusMs >= STATUS_INTERVAL_MS) sendStatus();
  if (now - lastDebugMs >= 5000) {
    lastDebugMs = now;
    debugLine();
  }
  // WiFi is up but the WebSocket is not: probe the server port again so the cause is visible.
  if (!wsOpen && WiFi.status() == WL_CONNECTED && now - lastProbeMs >= 15000) probeServer();
}
