// =====================================================
// GATEWAY_PICO_NRF24_V1.ino (Fixed LED & Serial Delay)
// Pi Pico + NRF24L01
// Library yang dibutuhkan: RF24 by TMRh20 (Library Manager)
// =====================================================
#include <SPI.h>
#include <RF24.h>

// ---------- PIN PERANGKAT ----------
#define MAIN_PUMP_RELAY 14   // Pompa utama penyiraman
#define TOREN_PUMP_RELAY 15  // Pompa isi toren
#define TRIG_PIN 2           // HC-SR04 Trig
#define ECHO_PIN 3           // HC-SR04 Echo
#define LED_PIN LED_BUILTIN

// ---------- PIN NRF24L01 (PI PICO) ----------
// SCK, MISO, MOSI tetap pakai SPI custom pins di bawah
// CSN  -> 17 (dulu LORA_CS)
// CE   -> 20 (dulu LORA_RST)
// VCC  -> WAJIB 3.3V, GND -> GND
#define NRF_SCK  18
#define NRF_MISO 16
#define NRF_MOSI 19
#define NRF_CSN  17
#define NRF_CE   20

// ---------- VARIABEL GLOBAL ----------
bool mainPump=false, torenPump=false;
float distanceCM=0;
String rxSrv="";
unsigned long tSensor=0, tTel=0;
unsigned long tLed=0; bool ledOn=false;

// Channel & alamat radio HARUS SAMA PERSIS dengan node.ino
const uint8_t RF_CHANNEL = 90;
const byte GATEWAY_ADDR[6] = "GATE1";   // alamat gateway (dengar telemetri dari semua node)

RF24 radio(NRF_CE, NRF_CSN);

// ---------- Struktur paket (harus sama persis dgn node.ino) ----------
struct NodeStatus {
  char nodeId[8];
  int16_t moisture;
  bool valveOpen;
};

struct NodeCmd {
  char nodeId[8];
  bool open; // true=OPEN, false=CLOSE
};

void setup(){
  pinMode(MAIN_PUMP_RELAY,OUTPUT);  digitalWrite(MAIN_PUMP_RELAY,LOW);
  pinMode(TOREN_PUMP_RELAY,OUTPUT); digitalWrite(TOREN_PUMP_RELAY,LOW);
  pinMode(TRIG_PIN,OUTPUT); pinMode(ECHO_PIN,INPUT);
  pinMode(LED_PIN,OUTPUT);

  Serial.begin(115200);
  delay(3000);   // ⭐ PENTING: tunggu Serial Monitor sempat terhubung
  Serial.println("=== GATEWAY MULAI ===");

  SPI.setRX(NRF_MISO);
  SPI.setTX(NRF_MOSI);
  SPI.setSCK(NRF_SCK);

  if(!radio.begin()){
    // GAGAL: LED kedip cepat + error diulang terus biar kelihatan
    while(1){
      Serial.println("ERROR: NRF24L01 tidak terdeteksi! Cek wiring SPI, CE/CSN, power 3.3V");
      for(int i=0;i<6;i++){
        digitalWrite(LED_PIN,HIGH); delay(80);
        digitalWrite(LED_PIN,LOW);  delay(80);
      }
      delay(2000);
    }
  }

  radio.setChannel(RF_CHANNEL);          // WAJIB sama dengan semua node
  radio.setPALevel(RF24_PA_LOW);         // naikkan ke RF24_PA_HIGH kalau jarak jauh & suplai daya cukup
  radio.setDataRate(RF24_250KBPS);       // WAJIB sama dengan node
  radio.enableDynamicPayloads();
  radio.setRetries(5, 15);

  radio.openReadingPipe(1, GATEWAY_ADDR); // dengar telemetri masuk dari semua node
  radio.startListening();

  Serial.println("GATEWAY NRF24 READY");
}

void loop(){
  // 1) Baca toren tiap 2 detik
  if(millis()-tSensor>2000){ tSensor=millis(); distanceCM=readDistance(); }

  // 2) Kirim data toren ke server tiap 2 detik
  if(millis()-tTel>2000){
    tTel=millis();
    Serial.print("TEL,TOREN,"); Serial.print(distanceCM); Serial.print(",");
    Serial.print(torenPump?1:0); Serial.print(","); Serial.println(mainPump?1:0);
  }

  // 3) Terima data node via NRF24
  readNodeNRF();

  // 4) Terima perintah server via USB
  readServer();

  // 5) LED heartbeat stabil (kedip tiap 0,5 detik)
  if(millis()-tLed>=500){ 
    tLed=millis(); 
    ledOn=!ledOn; 
    digitalWrite(LED_PIN, ledOn); 
  }
}

// ---------- NRF24: TERIMA DARI NODE ----------
void readNodeNRF(){
  if(radio.available()){
    NodeStatus pkt;
    radio.read(&pkt, sizeof(pkt));

    char idBuf[9]; memset(idBuf,0,sizeof(idBuf));
    strncpy(idBuf, pkt.nodeId, sizeof(pkt.nodeId));

    String received = String(idBuf) + "," + String(pkt.moisture) + "," + (pkt.valveOpen ? "OPEN" : "CLOSE");
    Serial.println("TEL,NODE,"+received);   // forward ke server
    Serial.println("NRF RX: "+received);
  }
}

// ---------- SENSOR ULTRASONIK HC-SR04 ----------
float readDistance(){
  float s=0; int v=0;
  for(int i=0;i<5;i++){
    digitalWrite(TRIG_PIN,LOW);  delayMicroseconds(2);
    digitalWrite(TRIG_PIN,HIGH); delayMicroseconds(10);
    digitalWrite(TRIG_PIN,LOW);
    long d=pulseIn(ECHO_PIN,HIGH,15000);
    if(d>0){ s+=d*0.0343/2.0; v++; }
    delay(20);
  }
  return v? s/v : -1.0;
}

// ---------- USB: TERIMA DARI SERVER ----------
void readServer(){
  while(Serial.available()){
    char c=Serial.read();
    if(c=='\n'){ execSrv(rxSrv); rxSrv=""; }
    else if(c!='\r') rxSrv+=c;
  }
}

void execSrv(String c){
  c.trim(); if(!c.length()) return;
  Serial.print("CMD: "); Serial.println(c);

  if(c=="POMPA_ON")      { mainPump=true;  digitalWrite(MAIN_PUMP_RELAY,HIGH); }
  else if(c=="POMPA_OFF"){ mainPump=false; digitalWrite(MAIN_PUMP_RELAY,LOW);  }
  else if(c=="TPUMP_ON") { torenPump=true;  digitalWrite(TOREN_PUMP_RELAY,HIGH);}
  else if(c=="TPUMP_OFF"){ torenPump=false; digitalWrite(TOREN_PUMP_RELAY,LOW); }
  else if(c.startsWith("VALVE,")){
    int p1=c.indexOf(','); int p2=c.indexOf(',',p1+1);
    if(p2>0){
      String id =c.substring(p1+1,p2);
      String act=c.substring(p2+1);
      sendCmdToNode(id, act=="ON");
    }
  }
}

// ---------- NRF24: KIRIM PERINTAH KE NODE TERTENTU ----------
void sendCmdToNode(String id, bool open){
  NodeCmd cmd;
  memset(&cmd, 0, sizeof(cmd));
  id.toCharArray(cmd.nodeId, sizeof(cmd.nodeId));
  cmd.open = open;

  // Ambil 2 digit angka di belakang ID, contoh "NODE01" -> 1 -> alamat "NOD01"
  int num = id.substring(4).toInt();
  byte nodeAddr[6];
  snprintf((char*)nodeAddr, sizeof(nodeAddr), "NOD%02d", num);

  radio.stopListening();               // pindah ke mode kirim (TX) sebentar
  radio.openWritingPipe(nodeAddr);
  bool ok = radio.write(&cmd, sizeof(cmd));
  radio.startListening();              // kembali dengar telemetri node lain

  String msg = id + (open ? ",OPEN" : ",CLOSE");
  Serial.println("NRF TX: " + msg + (ok ? " [ACK OK]" : " [GAGAL/NO ACK]"));
}
