// =====================================================
// NODE_NANO_NRF24_V1.ino (Dengan LCD I2C 16x2)
// Arduino Nano/Uno + NRF24L01 + LCD I2C 16x2
// Sensor: Capacitive Soil Moisture Sensor v1.2 (3-pin JST)
// Library yang dibutuhkan:
//  - RF24 by TMRh20 (Library Manager)
//  - LiquidCrystal I2C by Frank de Brabander (Library Manager)
// =====================================================
#include <SPI.h>
#include <RF24.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ---------- PIN NRF24L01 (ARDUINO NANO/UNO) ----------
// SCK  -> 13 (hardware SPI, tetap)
// MISO -> 12 (hardware SPI, tetap)
// MOSI -> 11 (hardware SPI, tetap)
// CSN  -> 10 (dulu LORA_CS)
// CE   -> 9  (dulu LORA_RST)
// IRQ  -> tidak dipakai, boleh dibiarkan mengambang
// VCC  -> WAJIB 3.3V (JANGAN 5V, modul bisa rusak)
// GND  -> GND
#define NRF_CE   9
#define NRF_CSN  10

// ---------- PIN SENSOR: Capacitive Soil Moisture Sensor v1.2 ----------
// Konektor JST 3-pin pada board sensor, urutan dari label PCB: GND - VCC - AOUT
//   GND  -> GND Arduino
//   VCC  -> 3.3V Arduino (disarankan, karena kalibrasi di bawah dipakai di 3.3V;
//           sensor ini toleran 3.3V-5.5V, tapi kalau pakai 5V, WAJIB kalibrasi ulang
//           DRY_VALUE & WET_VALUE karena raw ADC akan jauh lebih tinggi)
//   AOUT -> A1 (pin analog Arduino)
// Catatan arah sensor kapasitif ini: raw value TINGGI = kering, raw value RENDAH = basah
// (kebalikan dari intuisi tegangan, tapi sudah sesuai dengan mapping DRY->WET di bawah)
#define SOIL_PIN  A1   // Sensor soil moisture (AOUT capacitive sensor v1.2)
#define RELAY_PIN 7    // Relay solenoid valve

// ---------- PIN LCD I2C 16x2 (ARDUINO NANO/UNO) ----------
// SDA -> A4
// SCL -> A5
// VCC -> 5V (LCD I2C beda modul dari nRF24, ini boleh 5V)
// GND -> GND
// Kalau layar blank/kotak-kotak semua, coba ganti alamat 0x27 jadi 0x3F di bawah
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ===== SET PER NODE (WAJIB UBAH UNTUK NODE 2, 3, DST) =====
const char* NODE_ID = "NODE01";
const int   NODE_NUM = 1;      // samakan dengan angka di NODE_ID
// ==========================================================

// ===== KALIBRASI SENSOR (WAJIB DISESUAIKAN PER UNIT SENSOR) =====
// Setiap unit Capacitive Soil Moisture v1.2 punya nilai raw yang sedikit berbeda.
// Cara kalibrasi cepat lewat Serial Monitor (9600 baud), lihat nilai "RAW=":
//   1) Sensor di udara kering (belum ditancap tanah)  -> catat RAW, isi ke DRY_VALUE
//   2) Sensor dicelup air / ditancap tanah basah penuh -> catat RAW, isi ke WET_VALUE
// Nilai default di bawah adalah perkiraan untuk VCC 3.3V, GANTI dengan hasil kalibrasimu.
const int DRY_VALUE=444, WET_VALUE=212;   // KALIBRASI sensor tanah!
const unsigned long REPORT_INTERVAL=4000; // kirim tiap 4 detik

// Channel & alamat radio HARUS SAMA PERSIS dengan gateway.ino
const uint8_t RF_CHANNEL = 90;
const byte GATEWAY_ADDR[6] = "GATE1";   // alamat tujuan kirim status (uplink ke gateway)
byte nodeAddr[6];                        // alamat unik node ini untuk terima perintah (downlink)

RF24 radio(NRF_CE, NRF_CSN);

// ---------- Struktur paket (harus sama persis dgn gateway.ino) ----------
struct NodeStatus {
  char nodeId[8];
  int16_t moisture;
  bool valveOpen;
};

struct NodeCmd {
  char nodeId[8];
  bool open; // true=OPEN, false=CLOSE
};

bool valveOpen=false; 
int moisture=0; 
int rawValue=0;   // nilai mentah sensor tanah, buat kalibrasi DRY_VALUE & WET_VALUE
bool led=false;
unsigned long tSensor=0, tHB=0, nextReport=0;

void setup(){
  Serial.begin(9600);   // debug via Serial Monitor

  pinMode(RELAY_PIN,OUTPUT); digitalWrite(RELAY_PIN,LOW);
  pinMode(LED_BUILTIN,OUTPUT);

  lcd.init();
  lcd.backlight();
  lcd.setCursor(0,0);
  lcd.print("Node: "); lcd.print(NODE_ID);
  lcd.setCursor(0,1);
  lcd.print("Starting...");

  Serial.print("Node "); Serial.print(NODE_ID); Serial.println(" starting...");

  // Susun alamat unik node ini, contoh: NODE_NUM=1 -> "NOD01"
  snprintf((char*)nodeAddr, sizeof(nodeAddr), "NOD%02d", NODE_NUM);

  if(!radio.begin()){
    Serial.println("ERROR: NRF24L01 tidak terdeteksi! Cek wiring & VCC 3.3V.");
    while(1){
      // Kedip cepat kalau radio error
      digitalWrite(LED_BUILTIN, HIGH); delay(100);
      digitalWrite(LED_BUILTIN, LOW);  delay(100);
    }
  }

  radio.setChannel(RF_CHANNEL);          // WAJIB sama dengan gateway
  radio.setPALevel(RF24_PA_LOW);         // naikkan ke RF24_PA_HIGH kalau jarak jauh & suplai daya cukup
  radio.setDataRate(RF24_250KBPS);       // jangkauan lebih jauh & lebih stabil dibanding 1MBPS/2MBPS
  radio.enableDynamicPayloads();
  radio.setRetries(5, 15);               // auto retry kalau paket gagal terkirim

  radio.openWritingPipe(GATEWAY_ADDR);   // pipa untuk kirim status ke gateway
  radio.openReadingPipe(1, nodeAddr);    // pipa untuk terima perintah dari gateway
  radio.startListening();                // default: mode dengar (RX)

  Serial.println("NRF24 OK! Sistem siap.");

  lcd.setCursor(0,1);
  lcd.print("NRF24 OK        "); // spasi ekstra buat timpa teks "Starting..." lama

  // Offset fase agar node tidak kirim bersamaan (anti-tabrakan udara)
  nextReport = millis() + 1500 + (unsigned long)((NODE_NUM*370)%4000);
}

void loop(){
  // 1) Baca sensor tanah tiap 1 detik
  if(millis()-tSensor >= 1000){ 
    tSensor = millis(); 
    readSensor(); 
  }

  // 2) Kirim status via NRF24
  if((long)(millis()-nextReport) >= 0){ 
    nextReport += REPORT_INTERVAL; 
    sendStatusNRF(); 
  }

  // 3) Terima perintah via NRF24
  receiveGatewayNRF();
  
  // 4) LED Heartbeat
  heartbeat();
}

void readSensor(){
  rawValue = analogRead(SOIL_PIN);
  // Capacitive Soil Moisture v1.2: raw tinggi = kering, raw rendah = basah
  moisture = constrain(map(rawValue, DRY_VALUE, WET_VALUE, 0, 100), 0, 100);
  
  // Print ke Serial Monitor biar kita bisa pantau
  Serial.print("RAW="); Serial.print(rawValue);
  Serial.print(" | Kelembapan="); Serial.print(moisture);
  Serial.print("% | Valve="); Serial.println(valveOpen ? "OPEN" : "CLOSE");

  updateLCD();
}

void updateLCD(){
  // Baris 1: nomor/ID node (statis, jarang berubah)
  lcd.setCursor(0,0);
  lcd.print("Node: "); lcd.print(NODE_ID);

  // Baris 2: RAW + kelembapan, buat kalibrasi DRY_VALUE & WET_VALUE
  // Setelah kalibrasi selesai & DRY_VALUE/WET_VALUE sudah pas, boleh ganti
  // baris ini balik ke tampilan "Lembap:xx% ON/OFF" kalau tidak perlu RAW lagi.
  char buf[17];
  snprintf(buf, sizeof(buf), "R:%4d L:%3d%%", rawValue, moisture);
  lcd.setCursor(0,1);
  lcd.print(buf);
}

void sendStatusNRF(){
  NodeStatus pkt;
  memset(&pkt, 0, sizeof(pkt));
  strncpy(pkt.nodeId, NODE_ID, sizeof(pkt.nodeId)-1);
  pkt.moisture  = moisture;
  pkt.valveOpen = valveOpen;

  radio.stopListening();                 // pindah ke mode kirim (TX) sebentar
  bool ok = radio.write(&pkt, sizeof(pkt));
  radio.startListening();                // kembali ke mode dengar (RX)

  delay(20); // ⭐ JEDA PENTING: kasih waktu radio "bernapas" setelah kirim

  Serial.print(">>> NRF TX: ");
  Serial.print(pkt.nodeId); Serial.print(","); Serial.print(pkt.moisture);
  Serial.print(","); Serial.print(pkt.valveOpen ? "OPEN" : "CLOSE");
  Serial.println(ok ? " [ACK OK]" : " [GAGAL/NO ACK]");
}

void receiveGatewayNRF(){
  if(radio.available()){
    NodeCmd cmd;
    radio.read(&cmd, sizeof(cmd));
    processCmd(cmd);
  }
}

void processCmd(NodeCmd cmd){
  Serial.print("<<< NRF RX: "); Serial.print(cmd.nodeId);
  Serial.println(cmd.open ? ",OPEN" : ",CLOSE");

  if(strncmp(cmd.nodeId, NODE_ID, sizeof(cmd.nodeId)) == 0){
    valveOpen = cmd.open;
    digitalWrite(RELAY_PIN, valveOpen ? HIGH : LOW);
    Serial.println(valveOpen ? "!!! PERINTAH: VALVE DIBUKA !!!" : "!!! PERINTAH: VALVE DITUTUP !!!");
    updateLCD();
  }
}

void heartbeat(){
  if(millis()-tHB >= 1000){ 
    tHB = millis(); 
    led = !led; 
    digitalWrite(LED_BUILTIN, led); 
  }
}
