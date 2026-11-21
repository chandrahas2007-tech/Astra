// ---------------------------------------------------------------------------
// Live 3D view: Earth + Moon + satellites (SGP4 from CelesTrak) and Earth + Mars (Kepler orbits).
// Hover any trajectory line to see the equation that describes it.
// ---------------------------------------------------------------------------
(function(){
  const box=document.getElementById('globeCanvas');
  const statusEl=document.getElementById('globeStatus');
  const info=document.getElementById('globeInfo');
  const tip=document.getElementById('eqTip');
  const frameBox=box.parentNode;
  const INFO_DEFAULT=info.textContent;

  statusEl.textContent='Loading 3D libraries…';
  window.libsReady.then(initGlobe).catch(function(e){
    statusEl.textContent='Could not load '+e.message+'. Check your internet connection or ad blocker and reload.';
  });

  function initGlobe(){
    const D=Math.PI/180, RE=6371, MU=398600.4418, MU_SUN=1.32712440018e11, AU=149597870.7, OBL=23.4393*D;
    const SE=1/RE;            // Earth view: 1 scene unit = 1 Earth radius
    const SS=10/AU;           // Solar view: 10 scene units = 1 AU
    const MOON_BOOST=2000;    // Moon clock runs this much faster than the satellite clock
    const SOLAR_BOOST=3000;   // planet clock runs this much faster than the satellite clock
    const MAX_ACTIVE=2500, MAX_DEBRIS=1500;
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const f=(x,d)=>Number(x).toLocaleString('en-US',{maximumFractionDigits:d||0});

    let renderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}
    catch(e){statusEl.textContent='WebGL is not available in this browser.';return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
    box.appendChild(renderer.domElement);

    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(45,1,0.05,3000);
    camera.position.set(0,1.6,4);

    // Small built-in orbit controls: drag to rotate, wheel to zoom
    const controls=(function(){
      const el=renderer.domElement,o={autoRotate:false};
      let th=0.4,ph=1.2,dist=4.3,vt=0,vp=0,drag=null,minD=1.5,maxD=260;
      el.style.touchAction='none';
      el.addEventListener('pointerdown',function(e){drag=[e.clientX,e.clientY];vt=vp=0;try{el.setPointerCapture(e.pointerId);}catch(_){}});
      el.addEventListener('pointermove',function(e){
        if(!drag)return;
        vt=-(e.clientX-drag[0])*.005;vp=-(e.clientY-drag[1])*.005;
        th+=vt;ph=Math.min(3.09,Math.max(.05,ph+vp));drag=[e.clientX,e.clientY];
      });
      const end=function(){drag=null;};
      el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
      el.addEventListener('wheel',function(e){e.preventDefault();dist=Math.min(maxD,Math.max(minD,dist*Math.exp(e.deltaY*.001)));},{passive:false});
      o.setLimits=function(a,b,d){minD=a;maxD=b;dist=d;};
      o.setDist=function(d){dist=Math.min(maxD,Math.max(minD,d));};
      o.dist=function(){return dist;};
      o.update=function(){
        if(!drag){th+=vt;ph=Math.min(3.09,Math.max(.05,ph+vp));vt*=.92;vp*=.92;if(o.autoRotate)th+=.003;}
        camera.position.set(dist*Math.sin(ph)*Math.sin(th),dist*Math.cos(ph),dist*Math.sin(ph)*Math.cos(th));
        camera.lookAt(0,0,0);
      };
      return o;
    })();

    function resize(){
      const w=box.clientWidth,h=box.clientHeight;
      if(!w||!h)return;
      renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(box);resize();

    // Two scene groups: Earth system (Earth, Moon, satellites) and solar system (Sun, Earth, Mars)
    const gE=new THREE.Group(), gS=new THREE.Group();
    scene.add(gE);scene.add(gS);gS.visible=false;

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff,.7));
    const dirLight=new THREE.DirectionalLight(0xffffff,1.1);dirLight.position.set(5,2,3);scene.add(dirLight);
    const sunLight=new THREE.PointLight(0xffffff,1.6);sunLight.decay=0;sunLight.visible=false;scene.add(sunLight);

    // Earth (texture loads from the three-globe sample images; blue sphere if it cannot)
    const earthMat=new THREE.MeshPhongMaterial({color:0x1d4ed8,shininess:8});
    const earth=new THREE.Mesh(new THREE.SphereGeometry(1,64,64),earthMat);
    gE.add(earth);
    const loader=new THREE.TextureLoader();loader.setCrossOrigin('anonymous');
    loader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg',function(tex){
      earthMat.map=tex;earthMat.color.set(0xffffff);earthMat.needsUpdate=true;
    },undefined,function(){});
    gE.add(new THREE.Mesh(new THREE.SphereGeometry(1.025,48,48),
      new THREE.MeshBasicMaterial({color:0x4ea8ff,transparent:true,opacity:.13,side:THREE.BackSide,depthWrite:false})));

    // Moon (true size: radius 1,737 km)
    const moon=new THREE.Mesh(new THREE.SphereGeometry(1737*SE,32,32),new THREE.MeshPhongMaterial({color:0xb8b8b8,shininess:3}));
    gE.add(moon);

    // Solar system bodies (enlarged so they can be seen)
    const sunMesh=new THREE.Mesh(new THREE.SphereGeometry(.9,32,32),new THREE.MeshBasicMaterial({color:0xffc933}));
    const earthS=new THREE.Mesh(new THREE.SphereGeometry(.28,32,32),earthMat);
    const marsM=new THREE.Mesh(new THREE.SphereGeometry(.2,32,32),new THREE.MeshPhongMaterial({color:0xc1440e,shininess:4}));
    gS.add(sunMesh);gS.add(earthS);gS.add(marsM);

    // Background stars (fixed size on screen, far away)
    (function(){
      const n=1800,p=new Float32Array(n*3);
      for(let i=0;i<n;i++){
        const u=Math.random()*2-1,t=Math.random()*6.2832,r=Math.sqrt(1-u*u),R=1500;
        p[i*3]=R*r*Math.cos(t);p[i*3+1]=R*u;p[i*3+2]=R*r*Math.sin(t);
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));
      scene.add(new THREE.Points(g,new THREE.PointsMaterial({color:0x9fb4d6,size:1.6,sizeAttenuation:false,transparent:true,opacity:.7})));
    })();

    // Round dot sprite for satellites
    const dotTex=(function(){
      const c=document.createElement('canvas');c.width=c.height=32;
      const x=c.getContext('2d');x.fillStyle='#fff';x.beginPath();x.arc(16,16,14,0,6.2832);x.fill();
      return new THREE.CanvasTexture(c);
    })();

    // Text labels that keep a constant size on screen
    const labels=[];
    function addLabel(group,text,color,obj,radius){
      const c=document.createElement('canvas');c.width=256;c.height=64;
      const x=c.getContext('2d');x.font='600 30px system-ui,sans-serif';x.fillStyle=color;x.textAlign='center';x.textBaseline='middle';x.fillText(text,128,32);
      const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthTest:false}));
      s.center.set(.5,0);group.add(s);labels.push({s:s,obj:obj,r:radius,group:group});
    }
    addLabel(gE,'Earth','#9ec5ff',earth,1.03);
    addLabel(gE,'Moon','#e2e8f0',moon,1737*SE);
    addLabel(gS,'Sun','#ffd866',sunMesh,.9);
    addLabel(gS,'Earth','#9ec5ff',earthS,.28);
    addLabel(gS,'Mars','#ff8a5c',marsM,.2);

    // ----- orbital mathematics -----
    function kepler(M,e){
      M=((M%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
      let E=e<.8?M:Math.PI;
      for(let k=0;k<10;k++)E-=(E-e*Math.sin(E)-M)/(1-e*Math.cos(E));
      return E;
    }
    // Position in the parent frame (same unit as el.a) from eccentric anomaly E
    function posE(el,E){
      const xo=el.a*(Math.cos(E)-el.e),yo=el.a*Math.sqrt(1-el.e*el.e)*Math.sin(E);
      const cw=Math.cos(el.w),sw=Math.sin(el.w),cO=Math.cos(el.Om),sO=Math.sin(el.Om),ci=Math.cos(el.i),si=Math.sin(el.i);
      return [
        (cw*cO-sw*sO*ci)*xo+(-sw*cO-cw*sO*ci)*yo,
        (cw*sO+sw*cO*ci)*xo+(-sw*sO+cw*cO*ci)*yo,
        (sw*si)*xo+(cw*si)*yo
      ];
    }
    const eclToEq=p=>[p[0],p[1]*Math.cos(OBL)-p[2]*Math.sin(OBL),p[1]*Math.sin(OBL)+p[2]*Math.cos(OBL)];
    const toE=p=>new THREE.Vector3(p[0]*SE,p[2]*SE,-p[1]*SE);   // Earth-centred equatorial (km) -> scene
    const toS=p=>new THREE.Vector3(p[0]*SS,p[2]*SS,-p[1]*SS);   // Sun-centred ecliptic (AU) -> scene

    // Planet elements (JPL approximate Keplerian elements, valid 1800-2050); angles in degrees, rates per century
    const EARTH={a0:1.00000261,a1:.00000562,e0:.01671123,e1:-.00004392,I0:-.00001531,I1:-.01294668,L0:100.46457166,L1:35999.37306,w0:102.93768193,w1:.32327364,O0:0,O1:0};
    const MARS ={a0:1.52371034,a1:.00001847,e0:.0933941, e1:.00007882, I0:1.84969142, I1:-.00813131, L0:-4.55343205, L1:19140.30268499,w0:-23.94362959,w1:.44441088,O0:49.55953891,O1:-.29257343};
    function planetEl(p,Tc){
      const Om=p.O0+p.O1*Tc,wb=p.w0+p.w1*Tc;
      return {a:p.a0+p.a1*Tc,e:p.e0+p.e1*Tc,i:(p.I0+p.I1*Tc)*D,Om:Om*D,w:(wb-Om)*D,M:(p.L0+p.L1*Tc-wb)*D};
    }

    const T0=Date.now();
    const jd0=T0/86400000+2440587.5-2451545.0;        // days since J2000
    const TcNow=jd0/36525;

    // Moon: elements frozen at start time, mean anomaly advances (so the drawn orbit matches the Moon)
    const moonEl=(function(){
      const Om=125.0445-0.0529538*jd0,L=218.3165+13.17639648*jd0,Mm=134.9634+13.06499295*jd0;
      return {a:384399,e:.0549,i:5.145*D,Om:Om*D,w:(L-Mm-Om)*D,M0:Mm*D};
    })();
    const MOON_N=13.06499295*D/86400000;           // rad per ms
    let nowMoon={r:384399,v:1.02};

    // ----- trajectory lines (hover for equations) -----
    const pick=[];
    function addLine(group,mode,pts,color,opacity,html,closed){
      const geo=new THREE.BufferGeometry().setFromPoints(pts);
      const mat=new THREE.LineBasicMaterial({color:color,transparent:true,opacity:opacity});
      const line=closed?new THREE.LineLoop(geo,mat):new THREE.Line(geo,mat);
      group.add(line);
      const rec={obj:line,mode:mode,html:html,color:color,opacity:opacity,group:group};
      pick.push(rec);return rec;
    }
    function removeLine(rec){
      if(!rec)return;
      rec.group.remove(rec.obj);rec.obj.geometry.dispose();
      const i=pick.indexOf(rec);if(i>=0)pick.splice(i,1);
    }
    function ellipsePts(el,conv,n){
      const pts=[];
      for(let k=0;k<n;k++)pts.push(conv(posE(el,k/n*2*Math.PI)));
      return pts;
    }
    const fmtT=s=>s>172800?f(s/86400,1)+' days':f(s/60,1)+' min';
    function orbitHTML(title,color,center,a,e,incDeg,mu,now){
      const rp=a*(1-e),ra=a*(1+e),T=2*Math.PI*Math.sqrt(a*a*a/mu);
      const vp=Math.sqrt(mu*(2/rp-1/a)),va=Math.sqrt(mu*(2/ra-1/a));
      let h='<b style="color:'+color+'">'+title+'</b>';
      h+='<div class="eq">r(ν) = a(1 − e²) / (1 + e·cos ν)</div>';
      h+='<div class="eq">a = '+f(a)+' km &nbsp; e = '+e.toFixed(4)+' &nbsp; i = '+incDeg.toFixed(1)+'°</div>';
      h+='<div class="eq">v = √[ μ (2/r − 1/a) ]</div>';
      h+='<div class="eq">T = 2π √(a³/μ) = '+fmtT(T)+'</div>';
      h+='<div class="eq">r<sub>p</sub> = a(1−e) = '+f(rp)+' km, v<sub>p</sub> = '+vp.toFixed(2)+' km/s</div>';
      h+='<div class="eq">r<sub>a</sub> = a(1+e) = '+f(ra)+' km, v<sub>a</sub> = '+va.toFixed(2)+' km/s</div>';
      if(now)h+='<div class="eq" style="color:var(--cyan)">now: r = '+f(now.r)+' km, v = '+now.v.toFixed(2)+' km/s</div>';
      h+='<div class="eqsub">μ<sub>'+center+'</sub> = '+f(mu)+' km³/s²</div>';
      return h;
    }

    // Moon orbit (Earth view)
    addLine(gE,'earth',ellipsePts(moonEl,function(p){return toE(eclToEq(p));},240),0xcbd5e1,.6,
      function(){return orbitHTML('Moon orbit (Keplerian ellipse)','#e2e8f0','Earth',moonEl.a,moonEl.e,moonEl.i/D,MU,nowMoon);},true);

    // Geostationary ring (Earth view)
    (function(){
      const Tsid=86164.1,r=Math.cbrt(MU*Tsid*Tsid/(4*Math.PI*Math.PI));
      const pts=[];for(let k=0;k<180;k++){const t=k/180*2*Math.PI;pts.push(toE([r*Math.cos(t),r*Math.sin(t),0]));}
      addLine(gE,'earth',pts,0xa78bfa,.55,function(){
        const v=Math.sqrt(MU/r);
        return '<b style="color:#a78bfa">Geostationary orbit</b>'
          +'<div class="eq">r³ = μ T² / (4π²)</div>'
          +'<div class="eq">T = '+f(Tsid)+' s (one sidereal day)</div>'
          +'<div class="eq">r = '+f(r)+' km → altitude '+f(r-RE)+' km</div>'
          +'<div class="eq">v = √(μ/r) = '+v.toFixed(2)+' km/s</div>'
          +'<div class="eqsub">μ<sub>Earth</sub> = '+f(MU)+' km³/s²</div>';
      },true);
    })();

    // Earth and Mars orbits and an Earth→Mars Hohmann transfer (solar view)
    const elE0=planetEl(EARTH,TcNow),elM0=planetEl(MARS,TcNow);
    let nowEarth={r:elE0.a*AU,v:29.78},nowMars={r:elM0.a*AU,v:24.1};
    addLine(gS,'solar',ellipsePts(elE0,toS,240),0x22d3ee,.6,function(){
      return orbitHTML('Earth orbit around the Sun','#22d3ee','Sun',elE0.a*AU,elE0.e,elE0.i/D,MU_SUN,nowEarth);},true);
    addLine(gS,'solar',ellipsePts(elM0,toS,240),0xfb7185,.6,function(){
      return orbitHTML('Mars orbit around the Sun','#fb7185','Sun',elM0.a*AU,elM0.e,elM0.i/D,MU_SUN,nowMars);},true);
    (function(){
      const r1=elE0.a,r2=elM0.a,at=(r1+r2)/2,et=(r2-r1)/(r2+r1);
      const th0=Math.atan2(posE(elE0,kepler(elE0.M,elE0.e))[1],posE(elE0,kepler(elE0.M,elE0.e))[0]);
      const pts=[];
      for(let k=0;k<=120;k++){
        const nu=k/120*Math.PI,r=at*(1-et*et)/(1+et*Math.cos(nu));
        pts.push(toS([r*Math.cos(th0+nu),r*Math.sin(th0+nu),0]));
      }
      addLine(gS,'solar',pts,0x4ade80,.8,function(){
        const R1=r1*AU,R2=r2*AU,A=(R1+R2)/2;
        const dv1=Math.sqrt(MU_SUN/R1)*(Math.sqrt(2*R2/(R1+R2))-1);
        const dv2=Math.sqrt(MU_SUN/R2)*(1-Math.sqrt(2*R1/(R1+R2)));
        const t=Math.PI*Math.sqrt(A*A*A/MU_SUN);
        return '<b style="color:#4ade80">Earth → Mars Hohmann transfer</b>'
          +'<div class="eq">a<sub>t</sub> = (r₁ + r₂) / 2 = '+at.toFixed(3)+' AU</div>'
          +'<div class="eq">e<sub>t</sub> = (r₂ − r₁) / (r₂ + r₁) = '+et.toFixed(3)+'</div>'
          +'<div class="eq">Δv₁ = √(μ/r₁) · [√(2r₂/(r₁+r₂)) − 1] = '+dv1.toFixed(2)+' km/s</div>'
          +'<div class="eq">Δv₂ = √(μ/r₂) · [1 − √(2r₁/(r₁+r₂))] = '+dv2.toFixed(2)+' km/s</div>'
          +'<div class="eq">t = π √(a<sub>t</sub>³ / μ) = '+f(t/86400)+' days</div>'
          +'<div class="eqsub">Simplified: circular, coplanar orbits. Launch needs Mars about 44° ahead of Earth.</div>';
      },false);
    })();

    // ----- satellites from CelesTrak -----
    function sample(arr,max){
      if(arr.length<=max)return arr;
      const step=arr.length/max,out=[];
      for(let i=0;i<max;i++)out.push(arr[Math.floor(i*step)]);
      return out;
    }
    function makeLayer(items,color,size,kind){
      const sats=[];
      for(const o of items){
        try{
          const rec=satellite.json2satrec(o);
          if(rec.error)continue;
          sats.push({name:o.OBJECT_NAME||'Unknown',id:o.NORAD_CAT_ID,rec:rec});
        }catch(e){}
      }
      const pos=new Float32Array(sats.length*3);
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
      geo.boundingSphere=new THREE.Sphere(new THREE.Vector3(),60);
      const pts=new THREE.Points(geo,new THREE.PointsMaterial({color:color,size:size,map:dotTex,transparent:true,alphaTest:.2,depthWrite:false,sizeAttenuation:true}));
      pts.frustumCulled=false;gE.add(pts);
      return {kind:kind,sats:sats,pos:pos,geo:geo,pts:pts};
    }

    // Fallback used only if neither the Astra server nor CelesTrak can be reached
    function demoData(){
      const epoch=new Date().toISOString().slice(0,-1);
      const mk=function(i,alt,inc,deb){
        const a=RE+alt,T=2*Math.PI*Math.sqrt(a*a*a/MU);
        return {OBJECT_NAME:(deb?'DEMO DEBRIS ':'DEMO SAT ')+i,OBJECT_ID:'0000-000A',NORAD_CAT_ID:String(90000+i),EPOCH:epoch,
          MEAN_MOTION:86400/T,ECCENTRICITY:Math.random()*.01,INCLINATION:inc,RA_OF_ASC_NODE:Math.random()*360,
          ARG_OF_PERICENTER:Math.random()*360,MEAN_ANOMALY:Math.random()*360,EPHEMERIS_TYPE:0,CLASSIFICATION_TYPE:'U',
          ELEMENT_SET_NO:999,REV_AT_EPOCH:1,BSTAR:0,MEAN_MOTION_DOT:0,MEAN_MOTION_DDOT:0};
      };
      const active=[],debris=[];
      for(let i=0;i<700;i++)active.push(mk(i,400+Math.random()*1200,[53,70,97.5,28,51.6][i%5]+Math.random()*2,false));
      for(let i=0;i<40;i++)active.push(mk(900+i,35786,Math.random()*3,false));
      for(let i=0;i<500;i++)debris.push(mk(2000+i,700+Math.random()*500,[98.5,74,86.4,82.5][i%4]+Math.random()*1.5,true));
      return {source:'demo',active:active,debris:debris,updated:new Date().toISOString(),via:'built-in demo data (offline)'};
    }
    async function getJSON(u){const r=await fetch(u);if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}
    async function loadData(){
      try{
        const d=await getJSON('/api/gp');
        if(d.active&&d.active.length)return Object.assign(d,{via:'CelesTrak via Astra server'});
      }catch(e){}
      try{
        const base='https://celestrak.org/NORAD/elements/gp.php?FORMAT=json&GROUP=';
        const active=await getJSON(base+'active');
        const groups=['fengyun-1c-debris','cosmos-2251-debris','iridium-33-debris','cosmos-1408-debris'];
        const debris=(await Promise.all(groups.map(function(g){return getJSON(base+g).catch(function(){return [];});}))).flat();
        if(active.length)return {source:'celestrak',active:active,debris:debris,updated:new Date().toISOString(),via:'CelesTrak (direct)'};
      }catch(e){}
      return demoData();
    }

    // ----- simulation state -----
    let layers=[],speed=30,simMs=T0,last=performance.now(),acc=0,cost=10,visible=true,mode='earth';
    let selected=null,selOrbit=null,dataNote='';
    const marker=new THREE.Mesh(new THREE.SphereGeometry(.018,16,16),new THREE.MeshBasicMaterial({color:0xffffff}));
    marker.visible=false;gE.add(marker);
    const timeEl=document.getElementById('gTime');

    function updateMoon(){
      const moonMs=T0+(simMs-T0)*MOON_BOOST;
      const M=moonEl.M0+MOON_N*(moonMs-T0);
      const E=kepler(M,moonEl.e);
      const p=posE({a:moonEl.a,e:moonEl.e,i:moonEl.i,Om:moonEl.Om,w:moonEl.w},E);
      moon.position.copy(toE(eclToEq(p)));
      const r=moonEl.a*(1-moonEl.e*Math.cos(E));
      nowMoon={r:r,v:Math.sqrt(MU*(2/r-1/moonEl.a))};
    }
    function updateSolar(){
      const solarMs=T0+(simMs-T0)*SOLAR_BOOST;
      const Tc=((solarMs/86400000+2440587.5)-2451545.0)/36525;
      const ee=planetEl(EARTH,Tc),me=planetEl(MARS,Tc),Ee=kepler(ee.M,ee.e),Em=kepler(me.M,me.e);
      earthS.position.copy(toS(posE(ee,Ee)));marsM.position.copy(toS(posE(me,Em)));
      const re=ee.a*AU*(1-ee.e*Math.cos(Ee)),rm=me.a*AU*(1-me.e*Math.cos(Em));
      nowEarth={r:re,v:Math.sqrt(MU_SUN*(2/re-1/(ee.a*AU)))};
      nowMars={r:rm,v:Math.sqrt(MU_SUN*(2/rm-1/(me.a*AU)))};
      return solarMs;
    }
    function updatePositions(){
      const t0=performance.now(),d=new Date(simMs);
      for(const L of layers){
        const sats=L.sats,pos=L.pos;
        for(let i=0;i<sats.length;i++){
          let p=null;
          try{p=satellite.propagate(sats[i].rec,d).position;}catch(e){}
          if(p&&isFinite(p.x)){pos[i*3]=p.x*SE;pos[i*3+1]=p.z*SE;pos[i*3+2]=-p.y*SE;}
          else{pos[i*3]=pos[i*3+1]=pos[i*3+2]=0;}
        }
        L.geo.attributes.position.needsUpdate=true;
      }
      cost=performance.now()-t0;
      updateSelected(d);
    }
    function updateSelected(d){
      if(!selected)return;
      const s=selected.layer.sats[selected.i],pv=satellite.propagate(s.rec,d);
      if(!pv.position)return;
      const p=pv.position,v=pv.velocity;
      marker.position.set(p.x*SE,p.z*SE,-p.y*SE);marker.visible=true;
      const alt=Math.hypot(p.x,p.y,p.z)-RE,spd=Math.hypot(v.x,v.y,v.z);
      const incl=s.rec.inclo*180/Math.PI,period=2*Math.PI/s.rec.no;
      info.innerHTML='<strong>'+esc(s.name)+'</strong>'
        +'<span style="color:'+(selected.layer.kind==='debris'?'var(--amber)':'var(--cyan)')+'">'+(selected.layer.kind==='debris'?'Debris fragment':'Active satellite')+'</span>'
        +'<table><tr><td>NORAD ID</td><td>'+esc(s.id)+'</td></tr>'
        +'<tr><td>Altitude</td><td>'+f(alt)+' km</td></tr>'
        +'<tr><td>Speed</td><td>'+spd.toFixed(2)+' km/s</td></tr>'
        +'<tr><td>Inclination</td><td>'+incl.toFixed(1)+'°</td></tr>'
        +'<tr><td>Orbit period</td><td>'+period.toFixed(1)+' min</td></tr></table>';
    }
    function drawOrbit(s,d){
      removeLine(selOrbit);selOrbit=null;
      const rec=s.rec,periodMs=2*Math.PI/rec.no*60000,pts=[];
      for(let k=0;k<=180;k++){
        const p=satellite.propagate(rec,new Date(d.getTime()+k/180*periodMs)).position;
        if(p)pts.push(new THREE.Vector3(p.x*SE,p.z*SE,-p.y*SE));
      }
      if(pts.length<2)return;
      const n=rec.no/60,a=Math.cbrt(MU/(n*n)),e=rec.ecco,inc=rec.inclo*180/Math.PI,name=s.name;
      selOrbit=addLine(gE,'earth',pts,0xffffff,.6,function(){
        return orbitHTML(esc(name)+' orbit','#ffffff','Earth',a,e,inc,MU,null)
          +'<div class="eqsub">Mean Keplerian elements from CelesTrak; the drawn path comes from SGP4.</div>';
      },false);
    }
    function clearSelection(){
      selected=null;marker.visible=false;info.textContent=INFO_DEFAULT;
      removeLine(selOrbit);selOrbit=null;
    }

    // ----- hover (equations) and click (satellite details) -----
    const ray=new THREE.Raycaster();
    let pressed=null,hov=null;
    function ndc(e){
      const r=renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);
    }
    function lineAt(e){
      ray.setFromCamera(ndc(e),camera);
      ray.params.Line.threshold=controls.dist()*.012;
      const recs=pick.filter(function(p){return p.mode===mode;});
      const hits=ray.intersectObjects(recs.map(function(p){return p.obj;}),false);
      let limit=Infinity;
      if(mode==='earth'){const eh=ray.intersectObject(earth)[0];if(eh)limit=eh.distance;}
      for(const h of hits){
        if(h.distance>limit)continue;
        return recs.find(function(p){return p.obj===h.object;});
      }
      return null;
    }
    function setHover(rec,e){
      if(hov&&hov!==rec&&pick.indexOf(hov)>=0){hov.obj.material.color.set(hov.color);hov.obj.material.opacity=hov.opacity;}
      hov=rec;
      if(!rec){tip.style.display='none';renderer.domElement.style.cursor='';return;}
      rec.obj.material.color.set(0xffffff);rec.obj.material.opacity=1;
      renderer.domElement.style.cursor='pointer';
      tip.innerHTML=rec.html();tip.style.display='block';
      const fr=frameBox.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;
      let x=e.clientX-fr.left+16,y=e.clientY-fr.top+16;
      if(x+w>fr.width-8)x=e.clientX-fr.left-w-16;
      if(y+h>fr.height-8)y=Math.max(8,fr.height-h-8);
      tip.style.left=Math.max(8,x)+'px';tip.style.top=y+'px';
    }
    renderer.domElement.addEventListener('pointerdown',function(e){pressed=[e.clientX,e.clientY];setHover(null);});
    renderer.domElement.addEventListener('pointermove',function(e){
      if(pressed||e.pointerType!=='mouse')return;
      setHover(lineAt(e),e);
    });
    renderer.domElement.addEventListener('pointerleave',function(){setHover(null);});
    renderer.domElement.addEventListener('pointerup',function(e){
      const was=pressed;pressed=null;
      if(!was||Math.hypot(e.clientX-was[0],e.clientY-was[1])>5)return;
      if(e.pointerType!=='mouse'){setHover(lineAt(e),e);}      // touch: tap a line to see its equation
      if(mode!=='earth')return;
      ray.setFromCamera(ndc(e),camera);
      ray.params.Points.threshold=Math.max(.03,controls.dist()*.008);
      const eh=ray.intersectObject(earth)[0],limit=eh?eh.distance:Infinity;
      let best=null;
      for(const L of layers){
        if(!L.pts.visible)continue;
        for(const h of ray.intersectObject(L.pts)){
          if(h.distance<limit&&(!best||h.distance<best.dist))best={layer:L,i:h.index,dist:h.distance};
        }
      }
      if(!best){clearSelection();return;}
      selected=best;
      const d=new Date(simMs);drawOrbit(best.layer.sats[best.i],d);updateSelected(d);
    });

    // ----- mode and buttons -----
    function updateStatus(){
      statusEl.textContent=mode==='earth'
        ?dataNote+' · Moon clock ×'+f(MOON_BOOST)+' faster than satellites so it visibly moves'
        :'Earth and Mars on real Keplerian orbits · planet sizes exaggerated · time runs ×'+f(SOLAR_BOOST)+' faster';
    }
    function setMode(m){
      mode=m;gE.visible=m==='earth';gS.visible=m==='solar';
      dirLight.visible=m==='earth';sunLight.visible=m==='solar';
      document.querySelectorAll('.gbtn[data-mode]').forEach(function(b){b.classList.toggle('on',b.dataset.mode===m);});
      document.querySelectorAll('.earthonly').forEach(function(el){el.style.display=m==='earth'?'':'none';});
      if(m==='earth'){controls.setLimits(1.5,260,4.3);viewBtn.textContent='Zoom out to Moon';}
      else controls.setLimits(6,120,42);
      setHover(null);clearSelection();updateStatus();
    }
    const viewBtn=document.getElementById('gViewBtn');
    viewBtn.addEventListener('click',function(){
      if(controls.dist()<20){controls.setDist(170);viewBtn.textContent='Zoom in to Earth';}
      else{controls.setDist(4.3);viewBtn.textContent='Zoom out to Moon';}
    });
    document.querySelectorAll('.gbtn[data-mode]').forEach(function(b){b.addEventListener('click',function(){setMode(b.dataset.mode);});});
    document.querySelectorAll('.gbtn[data-speed]').forEach(function(b){b.addEventListener('click',function(){
      speed=+b.dataset.speed;
      document.querySelectorAll('.gbtn[data-speed]').forEach(function(o){o.classList.toggle('on',o===b);});
    });});
    document.getElementById('gDebrisBtn').addEventListener('click',function(e){
      const on=e.currentTarget.classList.toggle('on');
      for(const L of layers)if(L.kind==='debris')L.pts.visible=on;
    });
    document.getElementById('gSpinBtn').addEventListener('click',function(e){
      controls.autoRotate=e.currentTarget.classList.toggle('on');
    });
    new IntersectionObserver(function(es){visible=es[0].isIntersecting;}).observe(box);

    // ----- main loop -----
    const tmp=new THREE.Vector3();
    function frame(now){
      requestAnimationFrame(frame);
      const dt=Math.min(now-last,100);last=now;
      if(!visible)return;
      simMs+=dt*speed;
      let shown;
      if(mode==='earth'){
        updateMoon();
        earth.rotation.y=satellite.gstime(new Date(simMs));
        acc+=dt;
        if(acc>Math.max(100,cost*3)){acc=0;if(layers.length)updatePositions();}
        shown=new Date(simMs).toISOString().slice(0,16).replace('T',' ')+' UTC';
      }else{
        shown='Sim date '+new Date(updateSolar()).toISOString().slice(0,10);
      }
      if(timeEl.textContent!==shown)timeEl.textContent=shown;
      controls.update();
      for(const L of labels){
        if(!L.group.visible)continue;
        tmp.copy(L.obj.position);tmp.y+=L.r*1.15;L.s.position.copy(tmp);
        const k=camera.position.distanceTo(tmp)*.045;L.s.scale.set(k*4,k,1);
      }
      renderer.render(scene,camera);
    }

    loadData().then(function(d){
      const act=sample(d.active||[],MAX_ACTIVE),deb=sample(d.debris||[],MAX_DEBRIS);
      layers=[makeLayer(act,0x22d3ee,.022,'active'),makeLayer(deb,0xfbbf24,.018,'debris')];
      document.getElementById('gActive').textContent=layers[0].sats.length.toLocaleString();
      document.getElementById('gDebris').textContent=layers[1].sats.length.toLocaleString();
      const when=d.updated?new Date(d.updated).toLocaleString():'unknown';
      document.getElementById('gUpdated').textContent=d.source==='demo'?'Demo data':'Fetched '+when;
      dataNote='Source: '+d.via+(d.active.length>MAX_ACTIVE?' · showing '+layers[0].sats.length.toLocaleString()+' of '+d.active.length.toLocaleString()+' active objects':'');
      if(!document.getElementById('gDebrisBtn').classList.contains('on'))layers[1].pts.visible=false;
      updatePositions();updateStatus();
    }).catch(function(err){statusEl.textContent='Could not load orbital data: '+err.message;});

    dataNote='Loading orbital data…';
    setMode('earth');
    requestAnimationFrame(frame);
  }
})();
