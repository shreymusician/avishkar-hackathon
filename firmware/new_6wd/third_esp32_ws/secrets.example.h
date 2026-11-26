// Copy to secrets.h (git-ignored) in THIS folder and fill in. Never commit secrets.h.

#define WIFI_SSID     "your-network"
#define WIFI_PASSWORD "your-password"

// The laptop running the server, on the network this board joins (not "localhost").
// On a Windows Mobile Hotspot it is usually 192.168.137.1; otherwise find it with `ipconfig`.
#define WS_HOST "192.168.137.1"
#define WS_PORT 5000

#define DEVICE_ID "AGRIROVER-SONAR"

// Must match ACCESS_KEY in the server's .env. Leave "" if the server runs open.
#define ROVER_KEY ""
