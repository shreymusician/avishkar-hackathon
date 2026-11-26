# AgriVision

**Team CropX.** A six-wheel agricultural rover on three ESP32 boards, with a web field console: live driving,
camera, field sensors, obstacle distances, a 3D view of the rover, weather and farmer support.

```
browser (React)  <--ws-->  server (Hono, Node)  <--ws-->  ESP32 #1  four motors (front and middle axles)
                                |      |         <--ws-->  ESP32 #2  rear motors, flame, light, lamps, soil, rain, camera servo
               MongoDB Atlas ---+      |         <--ws-->  ESP32 #3  ultrasonic x4, MPU-6050 tilt sensor, GPS
                                       +--- USB webcam on the server computer (read by ffmpeg)
```

Driving never waits on the database. If `MONGODB_URI` is empty or unreachable the app
runs normally, keeps accounts in a local file and records no run history.

## Run it

```bash
npm install
cp .env.example .env      # then fill in MONGODB_URI and ACCESS_KEY
npm run dev               # server :5000, web :5173 (proxies /api and /ws)
npm run sim               # in another terminal: a simulated rover, no hardware needed
npm test                  # server tests
```

Production-style: `npm start` builds the web app and serves it from the server on `:5000`.

## Firmware (`firmware/new_6wd/`)

| Sketch | Board | Server role |
| --- | --- | --- |
| `first_esp32_ws` | ESP32 #1: front and middle axles | `rover` |
| `second_esp32_ws` | ESP32 #2: rear axle and field sensors | `motor` and `sensor` |
| `third_esp32_ws` | ESP32 #3: distances, tilt and position | `sonar` |

1. In each sketch folder copy `secrets.example.h` to `secrets.h` and fill in the WiFi, the server computer's
   address and the access key (`ROVER_KEY` must match `ACCESS_KEY` in `.env`). `secrets.h` is git-ignored.
2. Arduino IDE: board **ESP32 Dev Module** (esp32 core 3.x). Libraries: `WebSockets` (Markus Sattler) and
   `ArduinoJson` v7.
3. Flash each board. The Serial Monitor (115200 baud) reports WiFi, a server reachability probe, registration
   and a state line every few seconds.

Motors use TB6612FNG drivers: STBY and VCC to 3.3 V, VM to battery +, all grounds joined. Motor power is set to
50 percent (`MOTOR_POWER`). The motors stop 500 ms after the last command and on any disconnect.

### ESP32 #1: four motors

| Driver | PWMA | AIN1 | AIN2 | BIN1 | BIN2 | PWMB |
| --- | --- | --- | --- | --- | --- | --- |
| 1 (front axle) | 32 | 25 | 33 | 26 | 27 | 14 |
| 2 (middle axle) | 4 | 17 | 16 | 18 | 19 | 21 |

### ESP32 #2: rear motors and field sensors

| Part | GPIO |
| --- | --- |
| Rear motor driver | PWMA 32, AIN1 25, AIN2 33, BIN1 26, BIN2 27, PWMB 14 |
| Flame sensor D1 to D5 | 18, 19, 21, 22, 23 |
| Light sensor (DO) | 5 |
| Headlights (front, rear) | 16, 17 |
| Camera pan servo | 13 (power the servo from its own 5 V supply) |
| Soil moisture (AO) | 35 |
| Rain sensor (AO) | 34 |

### ESP32 #3: distances, tilt and position

| Part | GPIO |
| --- | --- |
| Ultrasonic front (Trig, Echo) | 23, 22 |
| Ultrasonic left | 21, 19 |
| Ultrasonic right | 18, 5 |
| Ultrasonic back | 17, 16 |
| MPU-6050 (SDA, SCL) | 32, 33 |
| NEO GPS (module TX, module RX) | 26, 27 |

An HC-SR04's Echo pin is 5 V and ESP32 pins take 3.3 V only: put a divider (1 kΩ and 2 kΩ) on each Echo line, or
use 3.3 V modules. Mount the MPU-6050 flat with its X arrow forward and keep the rover still for the first three
seconds after power-up.

## What the console shows

- **Rover control:** drive stick, live camera with pan buttons, and distances on all four sides.
- **3D rover view:** the rover tilting and turning with the real one, nearby obstacles, and the GPS track. Heading
  comes from the gyro alone (no compass), so it drifts; **Facing north now** resets it.
- **Headlights:** automatic from the light sensor, or manual.
- **Field sensors:** soil moisture, rain and five flame channels. Calibrate soil and rain with the `*_DRY_RAW` and
  `*_WET_RAW` values in `second_esp32_ws.ino`.
- **Live environmental data:** weather, soil forecast and air quality for the rover's position.
- **Farmer support:** mandi prices (needs a free data.gov.in key in `DATA_GOV_API_KEY`), government schemes and news.

### Live camera

Plug the rover's USB webcam into the computer running the server and install
[ffmpeg](https://ffmpeg.org/) (Windows, DirectShow). The server picks the USB camera; `.env.example` lists the
camera settings.

**Link quality.** Every 2 s the dashboard sends a probe that travels dashboard, server, rover and back. The
app bar shows four signal bars with the round-trip time, and **Rover status** shows the server and rover
latency, the average, the share of probes lost, and the rover's own WiFi strength, with advice in words. While
you drive, a warning appears if the link is weak, or if the rover's reported motion does not match your key
for about a second ("The rover is not following your commands").

The header pill and a badge on the banner show whether the rover is **active** (reporting in) or
**inactive**. Without hardware, `npm run sim` simulates a rover and `node server/scripts/sim-fire.js` a flame
sensor.

## Field conditions (Live environmental data)

The **server** works out where the field is and fetches the data; the browser only asks it
(`GET /api/environment`) and never calls third parties. The position is chosen in this order:

1. **Rover GPS (precise, live).** With the NEO GPS on ESP32 #3, the weather, soil and forecast follow the rover.
2. **Phone location.** Used when the rover has no fix and the browser shares its position (needs https).
3. **Network location (approximate).** Otherwise the server looks up the network address: city level at best.

Weather, soil (surface and root zone), next rain, sunrise and sunset, a 3-day forecast, air quality and
plain farm prompts (rain coming, good spraying window, heat, wind, frost, fungal weather) come from free,
key-less APIs: Open-Meteo, BigDataCloud (place name) and ipwho.is. Results are cached on the server for
10 minutes per ~100 m cell, so many dashboards cost one lookup. In `npm run sim`, `SIM_GPS=1` (or `g` +
Enter) gives the simulated rover a GPS fix.

## App layout (mobile first)

The dashboard is built like an Android app. A coloured **app bar** with a **menu button** (three lines)
opens a **navigation drawer** with pages for **Rover control, 3D rover view, Headlights, Field sensors, Live environmental data,
Farmer support, Rover status** (which also holds Field runs) and **Account**. Only one page shows at a
time, so there is no long scroll. Swipe in from the left edge to open the drawer, or swipe left / tap the
dim area / press Esc to close it; the address bar (`#/navigation` and so on) and the browser's back button
move between pages. **Arm** and **Stop** stay pinned to the bottom on phones and tablets, on every page.
Buttons have a touch ripple, controls are at least 44 px, and safe-area insets are respected. From 1060 px
the drawer becomes a permanent sidebar.

It can be installed like an app: open it on a phone and choose **Add to Home screen** (Chrome) or **Share >
Add to Home Screen** (Safari). It then opens full-screen with its own icon. That needs the https address
(`npm run dev:https`) on most phones.

**Pictures on a weak WiFi.** The rover photo (about 134 KB) and the AgriVision logo (about 10 KB) are small on
purpose, and every picture retries itself up to three times with a fresh address if a request fails (a dropped
packet on a hotspot, a server that was restarting). If it still cannot load, the logo becomes a plain
"AgriVision" text mark and the photo a green panel, never a broken-image icon. After the server has been
restarted, hard-refresh a phone's page (or close and reopen the tab) so it drops anything it cached. For a phone,
the lighter option is the built copy: `npm run build` then `npm start`, and open `http://<laptop-ip>:5000`.
That serves one small bundle instead of the many separate files `npm run dev` sends.

## Landing page and accounts

Visitors who are not signed in see a landing page (`/`) with pictures and a description of the project, and **Log in** / **Sign up** buttons (`#/login`, `#/signup`). Everything else, the field console and its live link, needs an account.

- **Sign up** asks for name, gender (male or female), phone number, type of farm, farm location (village optional, district, state; a button can suggest them from the network location) and a password entered twice.
- **Log in** uses the phone number and password. Phone numbers are Indian mobile numbers; `+91`, spaces and dashes are ignored.
- The first account created is the admin; later ones are farmers.
- Passwords are hashed with scrypt (a salt per user) and never returned or logged. A session is an HttpOnly cookie signed with a secret (`AUTH_SECRET`, or one generated into `server/data/auth-secret`), valid for 7 days. Failed logins are limited to 8 per phone number per 10 minutes.
- Accounts live in the `users` collection of MongoDB when `MONGODB_URI` is set, otherwise in `server/data/users.json`. Both are git-ignored.
- The ESP32 boards are not people: they still connect with `ROVER_KEY` / `ACCESS_KEY` and never need an account.
- **Demo login:** the login page has a **Demo login** button that signs in to a shared demo account (`Demo Farmer`, phone 9000000000) with no password, so anyone can look around. It is a normal signed-in session, so it can also drive the rover: set `DEMO_LOGIN=0` in `.env` to remove the button and the endpoint. The demo account never becomes the admin and has no password to change.
- **Change password:** the **Account** page in the menu shows your details and lets you change your own password (current password, new password twice). It ends every other session, so a lost phone is locked out, and keeps you signed in here. Failed attempts are limited to 8 per 10 minutes per account.
- To run without accounts (a private bench setup), start the server with `AUTH_REQUIRED=0`.
- There is no "forgot password" reset (no email or SMS service). If someone forgets it, delete their document in the `users` collection and have them sign up again.

## Language and theme

The header switches between **English** (default), **ಕನ್ನಡ** and **हिन्दी**, and between **Light**
(default) and **Dark**. Both choices are remembered in the browser. All UI text lives in
`web/src/i18n.js`; add a language by adding a dictionary there and an entry in `LANGUAGES`.

## Driving

The **drive stick** on the Rover control page works like a game controller: drag the knob away from the
centre and the dashboard keeps sending that direction ten times a second (the green light pulses while it
does); drag to another direction to change it, and let go, drag back to the middle, or press **Stop** to
halt. The rover moves in four directions at full speed, so the stick picks the dominant axis (with a little
stickiness near diagonals so a wobbling thumb does not flip-flop). The keyboard still works: `W A S D` or the
arrow keys, `Space` to stop.

## Safety

- The drive stick is locked until you press **ARM**; losing the rover or the link disarms.
- Space stops. Leaving the tab, closing it, or losing the link stops the rover.
- The firmware stops the motors 500 ms after the last command, and on any disconnect.
- Set `ACCESS_KEY` on anything other than a private hotspot.
