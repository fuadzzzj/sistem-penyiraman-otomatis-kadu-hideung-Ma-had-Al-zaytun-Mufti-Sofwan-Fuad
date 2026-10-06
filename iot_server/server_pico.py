# iot_server/server_pico.py — FINAL (long-run + jadwal + grafik + blok + aksi + notif TTL)
from flask import Flask, jsonify, request, render_template
import serial, threading, time, queue, math, os, re, json, sqlite3, urllib.request
import datetime as dt
from collections import deque

PORT="COM3"; BAUD=115200
BASE=os.path.dirname(os.path.abspath(__file__))
DB_PATH=os.path.join(BASE,"sirkadu.db")
UP_DIR=os.path.join(BASE,"static","uploads"); RES_DIR=os.path.join(BASE,"static","results")
os.makedirs(UP_DIR,exist_ok=True); os.makedirs(RES_DIR,exist_ok=True)

BLOCKS=["A","B","C","D","E"]; BEDENG_PER_BLOCK=2
def block_of(bedeng):
    i=(int(bedeng)-1)//BEDENG_PER_BLOCK
    return BLOCKS[min(i,len(BLOCKS)-1)]

NODE_TIMEOUT=20; AUTO_INT=3; RETRY=10
SERIAL_WATCHDOG=10; SERIAL_SILENT_TIMEOUT=120
SOIL_LOG_INTERVAL=300; NOTIF_TTL=300      # notif web hidup 5 menit
WEATHER_LAT=-6.3266; WEATHER_LON=108.3200

MODEL_CANDIDATES=[os.path.join(BASE,"models","best.pt"),
                  os.path.join(BASE,"..","model","best.pt"),
                  os.path.join(BASE,"model","best.pt")]
def find_model():
    for p in MODEL_CANDIDATES:
        if os.path.exists(p): return os.path.abspath(p)
    return None

app=Flask(__name__)
lock=threading.Lock(); log_lock=threading.Lock(); db_lock=threading.Lock()
logs=deque(maxlen=200); notifs=deque(maxlen=60)
detections=deque(maxlen=30); history=deque(maxlen=60)
cmd_queue=queue.Queue(); auto_last={}; nodes={}; cur_event=None; model=None

st={"mode":"AUTO","serial_ok":False,"port":PORT,"last_serial_rx":0,
 "toren_dist":None,"tpump":0,"pump":0,"last_update":None,
 "weather":{"ok":False,"temp":None,"hum":None,"rain":None,"label":"-"},
 "th":{"soil_on":30,"soil_off":55,"tank_on":50,"tank_off":20,"tank_height":150,
       "sched_enabled":1,"sched_time":"06:30","sched_below":60}}

AI_OK=True
try:
    from ultralytics import YOLO
    import cv2
except Exception: AI_OK=False
DEFISIT_KEY=("mati","defisit","kering","sakit","stress","stres","dead","dry","wilt")

def ts(): return time.strftime("%d/%m %H:%M")
def iso(): return time.strftime("%Y-%m-%d %H:%M:%S")
def add_log(m):
    with log_lock: logs.appendleft(f"[{ts()}] {m}")
def notify(kind,m):
    now=time.time()
    with log_lock:
        notifs.appendleft({"t":ts(),"ts":now,"kind":kind,"msg":m})
        while len(notifs) and now-notifs[-1].get("ts",now)>NOTIF_TTL: notifs.pop()
    add_log(m)
def parse_float(v,d=None):
    try:
        f=float(v); return d if (math.isnan(f) or math.isinf(f)) else f
    except: return d
def parse_int(v,d=0):
    f=parse_float(v,None); return d if f is None else int(f)

# ================= SQLITE =================
db=sqlite3.connect(DB_PATH,check_same_thread=False)
def db_init():
    with db_lock:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS detections(
          id INTEGER PRIMARY KEY AUTOINCREMENT, t TEXT, blok TEXT, bedeng TEXT,
          pohon TEXT, mode TEXT, counts TEXT, deficit INT, total INT, img TEXT);
        CREATE TABLE IF NOT EXISTS history(
          id INTEGER PRIMARY KEY AUTOINCREMENT, t_iso TEXT, mulai TEXT, akhir TEXT,
          durasi INT, mode TEXT);
        CREATE TABLE IF NOT EXISTS soil_log(
          id INTEGER PRIMARY KEY AUTOINCREMENT, t TEXT, node TEXT, moisture INT);
        CREATE TABLE IF NOT EXISTS actions(
          id INTEGER PRIMARY KEY AUTOINCREMENT, t_iso TEXT, kind TEXT,
          target TEXT, state TEXT, source TEXT);
        """); db.commit()
    try:
        with db_lock: db.execute("ALTER TABLE history ADD COLUMN t_iso TEXT"); db.commit()
    except Exception: pass
def db_save_detection(r):
    try:
        with db_lock:
            db.execute("INSERT INTO detections(t,blok,bedeng,pohon,mode,counts,deficit,total,img) VALUES(?,?,?,?,?,?,?,?,?)",
              (r["t"],r["blok"],r["bedeng"],r["pohon"],r["mode"],json.dumps(r["counts"]),r["deficit"],r["total"],r["img"])); db.commit()
    except Exception as e: add_log(f"DB detection err: {e}")
def db_save_history(h):
    try:
        with db_lock:
            db.execute("INSERT INTO history(t_iso,mulai,akhir,durasi,mode) VALUES(?,?,?,?,?)",
              (h["t_iso"],h["mulai"],h.get("akhir","-"),h.get("durasi",0),h["mode"])); db.commit()
    except Exception as e: add_log(f"DB history err: {e}")
def db_save_action(kind,target,state,source):
    try:
        with db_lock:
            db.execute("INSERT INTO actions(t_iso,kind,target,state,source) VALUES(?,?,?,?,?)",
              (iso(),kind,target,state,source)); db.commit()
    except Exception as e: add_log(f"DB action err: {e}")
def db_load():
    try:
        with db_lock:
            for r in db.execute("SELECT t,blok,bedeng,pohon,mode,counts,deficit,total,img FROM detections ORDER BY id ASC"):
                detections.appendleft({"t":r[0],"blok":r[1],"bedeng":r[2],"pohon":r[3],"mode":r[4],
                                       "counts":json.loads(r[5]),"deficit":r[6],"total":r[7],"img":r[8]})
            for r in db.execute("SELECT mulai,akhir,durasi,mode FROM history ORDER BY id ASC"):
                history.appendleft({"mulai":r[0],"akhir":r[1],"durasi":r[2],"mode":r[3]})
    except Exception as e: add_log(f"DB load err: {e}")

# ================= SERIAL =================
ser=None; ser_lock=threading.Lock()
def open_serial():
    global ser
    try:
        s=serial.Serial(PORT,BAUD,timeout=1)
        with ser_lock: ser=s
        st["serial_ok"]=True; st["last_serial_rx"]=time.time()
        add_log(f"Serial terhubung: {PORT}"); return True
    except Exception:
        with ser_lock: ser=None
        st["serial_ok"]=False; return False
def kill_serial(s,why):
    global ser
    add_log(f"Serial lepas ({why}) -> menunggu reconnect")
    try: s.close()
    except Exception: pass
    with ser_lock:
        if ser is s: ser=None
    st["serial_ok"]=False
def serial_watchdog():
    while True:
        time.sleep(SERIAL_WATCHDOG)
        with ser_lock: s=ser
        if s is None:
            if open_serial(): notify("ok","Serial reconnect berhasil")
            continue
        try: alive=s.is_open
        except Exception: alive=False
        if not alive:
            with ser_lock:
                if ser is s: ser=None
            st["serial_ok"]=False; continue
        last=st["last_serial_rx"]
        if last and time.time()-last>SERIAL_SILENT_TIMEOUT: kill_serial(s,"sunyi 120 detik")
def send_command(c): cmd_queue.put(c)
def auto_send(c):
    now=time.time()
    with lock:
        if now-auto_last.get(c,0)<RETRY: return False
        auto_last[c]=now
    send_command(c); return True
def serial_writer():
    while True:
        c=cmd_queue.get()
        with ser_lock: s=ser
        if s is None: continue
        try:
            s.write((c+"\n").encode()); add_log(f"SERVER->PICO: {c}"); time.sleep(0.12)
        except Exception as e: kill_serial(s,f"write error: {e}")
def handle_line(line):
    if line.startswith("TEL,TOREN,"):
        p=line.split(",")
        if len(p)>=5:
            d=parse_float(p[2]); tp=parse_int(p[3]); pu=parse_int(p[4]); ev=None
            with lock:
                st["toren_dist"]= d if (d is not None and d>=0) else None
                st["tpump"]=tp
                if pu!=st["pump"]: st["pump"]=pu; ev=pump_event(pu)
                st["last_update"]=time.time()
            if ev: finish_pump_event(ev)
    elif line.startswith("TEL,NODE,"):
        p=line.split(",")
        if len(p)>=5:
            nid=p[2].strip(); m=parse_int(p[3],-1); v=1 if p[4].strip()=="OPEN" else 0
            new=False
            with lock:
                if nid not in nodes:
                    bed=parse_int(nid[4:],len(nodes)+1)
                    nodes[nid]={"id":nid,"bedeng":bed,"block":block_of(bed),"moisture":-1,
                                "valve":0,"last_seen":0,"hist":deque(maxlen=25),"online":False}
                    new=True
                n=nodes[nid]; n["moisture"]=m; n["valve"]=v; n["last_seen"]=time.time()
                if m>=0: n["hist"].append(m)
            if new: notify("ok",f"AUTO-DISCOVERY: node baru {nid} terdaftar")
def serial_reader():
    while True:
        with ser_lock: s=ser
        if s is None: time.sleep(1); continue
        try:
            line=s.readline().decode(errors="ignore").strip(); st["last_serial_rx"]=time.time()
        except Exception as e:
            kill_serial(s,f"read error: {e}"); time.sleep(1); continue
        if line: handle_line(line)
def pump_event(new):
    global cur_event
    if new==1:
        cur_event={"start":time.time(),"t_iso":iso(),"mulai":ts(),"mode":st["mode"]}; return "ON"
    if cur_event:
        ev=cur_event; cur_event=None; return ev
    return None
def finish_pump_event(ev):
    if ev=="ON":
        notify("info","Pompa utama ON"); return
    ev["durasi"]=int(time.time()-ev["start"]); ev["akhir"]=ts()
    history.appendleft(ev); db_save_history(ev)
    notify("info",f"Pompa utama OFF (durasi {ev['durasi']} dtk)")
def node_watchdog():
    while True:
        time.sleep(5); now=time.time()
        with lock: items=list(nodes.items())
        for nid,n in items:
            on=(now-n["last_seen"])<NODE_TIMEOUT and n["last_seen"]>0
            if on!=n["online"]:
                n["online"]=on
                notify("warn" if not on else "ok",f"{nid} {'TERPUTUS - Belum Tersambung' if not on else 'kembali online'}")
def soil_logger():
    while True:
        time.sleep(SOIL_LOG_INTERVAL)
        with lock:
            snap=[(n["id"],n["moisture"]) for n in nodes.values() if n["online"] and n["moisture"]>=0]
        if not snap: continue
        t=iso()
        try:
            with db_lock:
                db.executemany("INSERT INTO soil_log(t,node,moisture) VALUES(?,?,?)",[(t,nid,m) for nid,m in snap])
                db.execute("DELETE FROM soil_log WHERE t < datetime('now','-90 days')"); db.commit()
        except Exception as e: add_log(f"DB soil err: {e}")

# ================= AUTO CONTROL + JADWAL =================
def auto_control():
    while True:
        time.sleep(AUTO_INT); cmds=[]; now=time.time()
        with lock:
            if st["mode"]!="AUTO": continue
            if st["last_update"] is None or now-st["last_update"]>20: continue
            th=st["th"]; any_open=False
            for nid,n in nodes.items():
                if not n["online"] or n["moisture"]<0: continue
                if n["valve"]==1: any_open=True
                m=n["moisture"]
                if m<th["soil_on"] and n["valve"]==0:
                    cmds.append((f"VALVE,{nid},ON",f"AUTO: {nid} {m}% -> valve OPEN",("valve",nid,"OPEN","AUTO")))
                elif m>th["soil_off"] and n["valve"]==1:
                    cmds.append((f"VALVE,{nid},OFF",f"AUTO: {nid} {m}% -> valve CLOSE",("valve",nid,"CLOSE","AUTO")))
            if any_open and st["pump"]==0: cmds.append(("POMPA_ON","AUTO: pompa utama ON",("pump","utama","ON","AUTO")))
            if not any_open and st["pump"]==1: cmds.append(("POMPA_OFF","AUTO: pompa utama OFF",("pump","utama","OFF","AUTO")))
            d=st["toren_dist"]
            if d is not None:
                if d>th["tank_on"] and st["tpump"]==0: cmds.append(("TPUMP_ON",f"AUTO: toren {d:.0f}cm -> pompa toren ON",("tpump","toren","ON","AUTO")))
                elif d<=th["tank_off"] and st["tpump"]==1: cmds.append(("TPUMP_OFF","AUTO: toren penuh -> pompa toren OFF",("tpump","toren","OFF","AUTO")))
        for c,m,act in cmds:
            if auto_send(c): add_log(m); db_save_action(*act)
def in_window(now_s,t_s,mins=30):
    try:
        a=dt.datetime.strptime(now_s,"%H:%M"); b=dt.datetime.strptime(t_s,"%H:%M")
        return 0<=(a-b).total_seconds()<mins*60
    except Exception: return False
def scheduler():
    last_fire=""
    while True:
        time.sleep(20)
        with lock:
            th=st["th"]; enabled=th["sched_enabled"]; ttarget=str(th["sched_time"]).strip(); mode=st["mode"]
        if not enabled or not ttarget or mode!="AUTO": continue
        key=dt.date.today().isoformat()+" "+ttarget
        if last_fire==key: continue
        if in_window(time.strftime("%H:%M"),ttarget):
            last_fire=key; cmds=[]
            with lock:
                for nid,n in nodes.items():
                    if n["online"] and 0<=n["moisture"]<th["sched_below"] and n["valve"]==0:
                        cmds.append(nid)
            if cmds:
                notify("info",f"JADWAL {ttarget}: penyiraman dimulai ({len(cmds)} bedeng)")
                for nid in cmds:
                    send_command(f"VALVE,{nid},ON"); db_save_action("valve",nid,"OPEN","JADWAL")
            else:
                notify("info",f"JADWAL {ttarget}: kelembapan cukup, tidak menyiram")

# ================= CUACA =================
def wlabel(c):
    if c==0:return "Cerah"
    if c<=2:return "Cerah Berawan"
    if c==3:return "Mendung"
    if c in (45,48):return "Berkabut"
    if c<70:return "Gerimis"
    if c<95:return "Hujan"
    return "Hujan Petir"
def weather_loop():
    while True:
        try:
            url=(f"https://api.open-meteo.com/v1/forecast?latitude={WEATHER_LAT}&longitude={WEATHER_LON}"
                 f"&current=temperature_2m,relative_humidity_2m,precipitation,weather_code&timezone=Asia%2FJakarta")
            with urllib.request.urlopen(url,timeout=10) as r: j=json.load(r)
            c=j["current"]
            with lock:
                st["weather"]={"ok":True,"temp":c["temperature_2m"],"hum":c["relative_humidity_2m"],
                               "rain":c["precipitation"],"label":wlabel(c["weather_code"])}
        except Exception:
            with lock: st["weather"]["ok"]=False
        time.sleep(600)

# ================= DRONE AI =================
def ai_status():
    if not AI_OK: return {"ok":False,"msg":"ultralytics belum terinstall"}
    p=find_model()
    if not p: return {"ok":False,"msg":"best.pt tidak ditemukan"}
    return {"ok":True,"msg":os.path.relpath(p,BASE)}
def get_model():
    global model
    if model is None: model=YOLO(find_model())
    return model
@app.route("/api/drone/upload",methods=["POST"])
def drone_upload():
    if "file" not in request.files: return jsonify(ok=False,msg="File tidak ada"),400
    f=request.files["file"]
    blok=request.form.get("blok","-"); bedeng=request.form.get("bedeng","-"); pohon=request.form.get("pohon","-")
    # nama file "A1,1,2" -> Blok A1, Bedeng 1, Pohon 2
    mp=re.match(r"^([A-Za-z]+\d+)\s*[,._-]\s*(\d+)\s*[,._-]\s*(\d+)$",os.path.splitext(f.filename or "")[0].strip())
    if mp: blok,bedeng,pohon=mp.group(1),mp.group(2),mp.group(3)
    t=int(time.time()); orig=os.path.join(UP_DIR,f"{t}_{f.filename}"); f.save(orig)
    s=ai_status()
    if not s["ok"]: return jsonify(ok=False,msg=s["msg"]),500
    try:
        mdl=get_model(); res=mdl.predict(orig,conf=0.35,verbose=False)[0]
        counts={}; total=0; mode="detect"
        if getattr(res,"boxes",None) is not None and len(res.boxes)>0:
            total=len(res.boxes)
            for b in res.boxes:
                nm=mdl.names[int(b.cls)]; counts[nm]=counts.get(nm,0)+1
        elif getattr(res,"probs",None) is not None:
            mode="classify"; total=1
            counts={mdl.names[int(res.probs.top1)]:round(float(res.probs.top1conf),2)}
        img=res.plot(); out=f"res_{t}.jpg"; cv2.imwrite(os.path.join(RES_DIR,out),img)
        deficit=sum(c for k,c in counts.items() if any(x in k.lower() for x in DEFISIT_KEY))
        rec={"t":ts(),"blok":blok,"bedeng":bedeng,"pohon":pohon,"mode":mode,"counts":counts,
             "deficit":deficit,"total":total,"img":f"/static/results/{out}"}
        detections.appendleft(rec); db_save_detection(rec)
        notify("warn" if deficit else "ok",f"Drone Blok {blok} Bedeng {bedeng}: {deficit} pohon defisit/mati")
        return jsonify(ok=True,rec=rec)
    except Exception as e:
        return jsonify(ok=False,msg=f"Deteksi gagal: {e}"),500

# ================= API =================
@app.route("/")
def index(): return render_template("index.html")
@app.route("/api/state")
def state():
    with lock:
        nl=[{"id":n["id"],"bedeng":n["bedeng"],"block":n["block"],"moisture":n["moisture"],
             "valve":n["valve"],"online":n["online"],"hist":list(n["hist"])}
            for n in sorted(nodes.values(),key=lambda x:x["bedeng"])]
        onl=[n for n in nl if n["online"]]
        avg=round(sum(n["moisture"] for n in onl if n["moisture"]>=0)/max(1,len(onl))) if onl else None
        th=st["th"]; d=st["toren_dist"]
        level=None if d is None else max(0,min(100,round((1-d/th["tank_height"])*100)))
        data={"mode":st["mode"],"serial_ok":st["serial_ok"],"port":st["port"],"ai":ai_status(),
              "weather":st["weather"],"pump":st["pump"],
              "toren":{"dist":d,"tpump":st["tpump"],"level":level},
              "nodes":nl,"avg":avg,"open_count":sum(1 for n in nl if n["valve"]==1),
              "total":len(nl),"online_count":len(onl),
              "notifs":list(notifs),"detections":list(detections),
              "history":list(history),"th":th}
    return jsonify(data)
@app.route("/api/charts")
def charts():
    ndays=7
    dates=[dt.date.today()-dt.timedelta(days=i) for i in range(ndays-1,-1,-1)]
    labels=[d.strftime("%d/%m") for d in dates]; dstr=[d.isoformat() for d in dates]
    with db_lock:
        soil=db.execute("SELECT date(t),node,ROUND(AVG(moisture)) FROM soil_log WHERE date(t)>=? GROUP BY date(t),node",(dstr[0],)).fetchall()
        overall=db.execute("SELECT date(t),ROUND(AVG(moisture)) FROM soil_log WHERE date(t)>=? GROUP BY date(t)",(dstr[0],)).fetchall()
        irr=db.execute("SELECT date(t_iso),ROUND(SUM(durasi)/60.0,1),COUNT(*) FROM history WHERE t_iso IS NOT NULL AND date(t_iso)>=? GROUP BY date(t_iso)",(dstr[0],)).fetchall()
        vo=db.execute("SELECT date(t_iso),COUNT(*) FROM actions WHERE kind='valve' AND state='OPEN' AND t_iso IS NOT NULL AND date(t_iso)>=? GROUP BY date(t_iso)",(dstr[0],)).fetchall()
    soilmap={}
    for d,n,m in soil: soilmap.setdefault(n,{})[d]=m
    ovmap={d:m for d,m in overall}; irmap={d:(mn,c) for d,mn,c in irr}; vomap={d:c for d,c in vo}
    with lock:
        nids=[n["id"] for n in sorted(nodes.values(),key=lambda x:x["bedeng"])]
    return jsonify(labels=labels,overall=[ovmap.get(d) for d in dstr],
        nodes=[{"id":nid,"values":[soilmap.get(nid,{}).get(d) for d in dstr]} for nid in nids],
        minutes=[irmap.get(d,(0,0))[0] for d in dstr],
        counts=[irmap.get(d,(0,0))[1] for d in dstr],
        valveopens=[vomap.get(d,0) for d in dstr],has_data=len(soil)>0)
@app.route("/api/mode",methods=["POST"])
def set_mode():
    m=(request.get_json(silent=True) or {}).get("mode","AUTO").upper()
    if m not in ("AUTO","MANUAL"): return jsonify(ok=False),400
    with lock: st["mode"]=m
    return jsonify(ok=True)
@app.route("/api/config",methods=["POST"])
def set_config():
    p=request.get_json(silent=True) or {}
    with lock:
        for k,v in p.items():
            if k in st["th"]: st["th"][k]= v if k=="sched_time" else float(v)
    notify("info","Pengaturan threshold/jadwal diperbarui"); return jsonify(ok=True)
def manual(fn,label,act=None):
    with lock: st["mode"]="MANUAL"
    fn(); notify("info",label)
    if act: db_save_action(*act)
    return jsonify(ok=True)
@app.route("/api/manual/pump/<a>",methods=["POST"])
def m_pump(a):
    s="ON" if a=="on" else "OFF"
    return manual(lambda: send_command("POMPA_ON" if a=="on" else "POMPA_OFF"),
                  f"AKSI MANUAL: pompa utama {s}",("pump","utama",s,"MANUAL"))
@app.route("/api/manual/tpump/<a>",methods=["POST"])
def m_tpump(a):
    s="ON" if a=="on" else "OFF"
    return manual(lambda: send_command("TPUMP_ON" if a=="on" else "TPUMP_OFF"),
                  f"AKSI MANUAL: pompa toren {s}",("tpump","toren",s,"MANUAL"))
@app.route("/api/manual/valve/<nid>/<a>",methods=["POST"])
def m_valve(nid,a):
    s="OPEN" if a=="on" else "CLOSE"
    return manual(lambda: send_command(f"VALVE,{nid},{'ON' if a=='on' else 'OFF'}"),
                  f"AKSI MANUAL: valve {nid} {'BUKA' if a=='on' else 'TUTUP'}",("valve",nid,s,"MANUAL"))
@app.route("/api/manual/valve_all/<a>",methods=["POST"])
def m_valve_all(a):
    s="OPEN" if a=="on" else "CLOSE"
    def go():
        with lock: ids=[n["id"] for n in nodes.values() if n["online"]]
        for i in ids:
            send_command(f"VALVE,{i},{'ON' if a=='on' else 'OFF'}")
            db_save_action("valve",i,s,"MANUAL")
    return manual(go,f"AKSI MANUAL: semua valve {'BUKA' if a=='on' else 'TUTUP'}")

def guarded(name,fn,delay=5):
    def wrap():
        while True:
            try: fn()
            except Exception as e:
                add_log(f"THREAD {name} crash: {e} -> restart {delay}s"); time.sleep(delay)
    threading.Thread(target=wrap,daemon=True).start()

if __name__=="__main__":
    db_init(); db_load()
    add_log(f"Database siap ({len(history)} riwayat, {len(detections)} deteksi dimuat)")
    open_serial(); time.sleep(2)
    for nm,fn in [("serial_watchdog",serial_watchdog),("serial_reader",serial_reader),
                  ("serial_writer",serial_writer),("auto_control",auto_control),
                  ("scheduler",scheduler),("node_watchdog",node_watchdog),
                  ("soil_logger",soil_logger),("weather_loop",weather_loop)]:
        guarded(nm,fn)
    add_log(f"SIRKADU aktif di http://127.0.0.1:5000 | AI: {ai_status()['msg']}")
    app.run(host="0.0.0.0",port=5000,debug=False,use_reloader=False,threaded=True)