/* ================= PETA 3D - THREE.JS + lahan.glb ================= */
let scene, camera, renderer, controls, model=null;
let threeInited=false;
const MODEL_PATH="/static/models/lahan.glb";

function initThree(){
  if(threeInited) return;
  const canvas=document.getElementById('canvas3d');
  if(!canvas || typeof THREE==='undefined') return;

  // Renderer
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
  renderer.setSize(canvas.clientWidth,canvas.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;

  // Scene + sky
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x87ceeb);
  scene.fog=new THREE.Fog(0x87ceeb,200,600);

  // Camera
  camera=new THREE.PerspectiveCamera(50,canvas.clientWidth/canvas.clientHeight,0.1,3000);
  camera.position.set(0,80,150);

  // Lights — biar model terlihat realistis
  const hemi=new THREE.HemisphereLight(0xffffff,0x444466,0.8);
  scene.add(hemi);

  const sun=new THREE.DirectionalLight(0xffffff,1.2);
  sun.position.set(80,120,60);
  sun.castShadow=true;
  sun.shadow.mapSize.width=2048;
  sun.shadow.mapSize.height=2048;
  sun.shadow.camera.left=-100;sun.shadow.camera.right=100;
  sun.shadow.camera.top=100;sun.shadow.camera.bottom=-100;
  scene.add(sun);

  const fill=new THREE.DirectionalLight(0xffffff,0.4);
  fill.position.set(-50,40,-60);
  scene.add(fill);

  // Ground plane (opsional, sebagai alas)
  const groundGeo=new THREE.PlaneGeometry(800,800);
  const groundMat=new THREE.ShadowMaterial({opacity:0.2});
  const ground=new THREE.Mesh(groundGeo,groundMat);
  ground.rotation.x=-Math.PI/2;
  ground.position.y=-2;
  ground.receiveShadow=true;
  scene.add(ground);

  // OrbitControls (rotasi + zoom + pan)
  controls=new THREE.OrbitControls(camera,canvas);
  controls.enableDamping=true;
  controls.dampingFactor=0.08;
  controls.minDistance=20;
  controls.maxDistance=500;
  controls.maxPolarAngle=Math.PI/2 - 0.05; // jangan sampai tembus bawah
  controls.target.set(0,0,0);

  // Load model .glb
  const loader=new THREE.GLTFLoader();
  loader.load(
    MODEL_PATH,
    (gltf)=>{
      model=gltf.scene;

      // Auto-center
      const box=new THREE.Box3().setFromObject(model);
      const center=box.getCenter(new THREE.Vector3());
      const size=box.getSize(new THREE.Vector3());
      model.position.sub(center);
      model.position.y -= box.min.y - center.y; // supaya pas di tanah

      // Auto-scale supaya proporsional
      const maxDim=Math.max(size.x,size.y,size.z);
      const targetSize=180;
      const scale=targetSize/maxDim;
      model.scale.setScalar(scale);

      // Bayangan
      model.traverse(c=>{if(c.isMesh){c.castShadow=true;c.receiveShadow=true;}});

      scene.add(model);

      // Atur kamera biar pas
      camera.position.set(0,80*scale,150*scale);
      controls.target.set(0,0,0);
      controls.update();

      // Hilangkan loader
      const ld=document.getElementById('loader3d');
      if(ld) ld.classList.add('hide');
    },
    (xhr)=>{
      const ld=document.getElementById('loader3d');
      if(ld && xhr.total){
        const pct=Math.round(xhr.loaded/xhr.total*100);
        ld.querySelector('div:last-child').textContent=`Loading... ${pct}%`;
      }
    },
    (err)=>{
      console.error('Gagal load GLB:',err);
      const ld=document.getElementById('loader3d');
      if(ld) ld.innerHTML=`<div style="color:#fca5a5">❌ Gagal load ${MODEL_PATH}<br><small>Cek file ada di static/models/lahan.glb</small></div>`;
    }
  );

  // Animation loop
  (function animate(){
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene,camera);
  })();

  // Handle resize
  window.addEventListener('resize',onResize);
  threeInited=true;
}

function onResize(){
  if(!renderer) return;
  const canvas=document.getElementById('canvas3d');
  if(!canvas || canvas.clientWidth===0) return;
  renderer.setSize(canvas.clientWidth,canvas.clientHeight);
  camera.aspect=canvas.clientWidth/canvas.clientHeight;
  camera.updateProjectionMatrix();
}

function resetView3d(){
  if(!model || !controls) return;
  const box=new THREE.Box3().setFromObject(model);
  const center=box.getCenter(new THREE.Vector3());
  camera.position.set(center.x,center.y+80,center.z+150);
  controls.target.copy(center);
  controls.update();
}

// Toggle view (dipanggil dari HTML)
function showView(id,btn){
  const v3d=document.getElementById('v3d');
  const v2d=document.getElementById('v2d');
  if(!v3d || !v2d) return;

  v3d.style.display = id==='v3d' ? 'block' : 'none';
  v2d.style.display = id==='v2d' ? 'block' : 'none';

  // aktifkan class di tombol
  document.querySelectorAll('.map-toggle button').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');

  // refresh ukuran setelah transisi
  setTimeout(()=>{
    if(id==='v3d'){
      onResize();
    } else if(id==='v2d' && typeof initPeta==='function'){
      initPeta();
      if(typeof map!=='undefined' && map) map.invalidateSize();
    }
  },50);
}

// Auto-init 3D saat halaman pertama dibuka
document.addEventListener('DOMContentLoaded',()=>{
  setTimeout(initThree,100);
});