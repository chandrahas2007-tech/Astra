#!/usr/bin/env python3
"""Adds a realistic 3D Moon and tumbling 3D debris fragments to the Astra globe script.
Usage:  python apply_patch.py path/to/globe.js     (a .bak copy is saved first)
Every edit must match exactly once, otherwise nothing is written."""
import shutil, sys

EDITS = []
def edit(name, old, new): EDITS.append((name, old, new))

# 1. Moon: textured, bump-mapped mesh with a procedural fallback texture
edit("moon mesh", r'''    const moon=new THREE.Mesh(new THREE.SphereGeometry(1737*SE,32,32),new THREE.MeshPhongMaterial({color:0xb8b8b8,shininess:3}));
    gE.add(moon);''', r'''    function makeMoonCanvas(){   // offline fallback: highlands, dark maria, craters with bright rims
      const W=1024,H=512,c=document.createElement('canvas');c.width=W;c.height=H;
      const x=c.getContext('2d');let s=20240607;
      const rnd=function(){s=(s*1664525+1013904223)>>>0;return s/4294967296;};
      x.fillStyle='#8c8b87';x.fillRect(0,0,W,H);
      function blob(px,py,r,col,a){
        const g=x.createRadialGradient(px,py,0,px,py,r);
        g.addColorStop(0,col.replace('A',a));g.addColorStop(1,col.replace('A',0));
        x.fillStyle=g;x.fillRect(px-r,py-r,2*r,2*r);
      }
      for(let i=0;i<400;i++)blob(rnd()*W,rnd()*H,10+rnd()*50,rnd()<.5?'rgba(190,190,185,A)':'rgba(70,70,70,A)',.07+rnd()*.08);
      for(let i=0;i<14;i++)blob(W*.15+rnd()*W*.7,H*.25+rnd()*H*.5,40+rnd()*70,'rgba(52,54,60,A)',.55);
      for(let i=0;i<700;i++){
        const r=1.5+Math.pow(rnd(),3)*22,px=rnd()*W,py=H*.1+rnd()*H*.8;
        blob(px,py,r,'rgba(40,40,40,A)',.35);
        x.strokeStyle='rgba(215,215,210,'+(.25+rnd()*.25)+')';x.lineWidth=Math.max(.6,r*.12);
        x.beginPath();x.arc(px,py,r*.8,0,6.2832);x.stroke();
      }
      return c;
    }
    const moonMap=new THREE.CanvasTexture(makeMoonCanvas());
    const moonMat=new THREE.MeshStandardMaterial({map:moonMap,bumpMap:moonMap,bumpScale:.6,roughness:1,metalness:0});
    const moon=new THREE.Mesh(new THREE.SphereGeometry(1737*SE,96,64),moonMat);
    gE.add(moon);
    // Real lunar imagery (three.js example texture). If it cannot load, the procedural moon stays.
    loader.load('https://threejs.org/examples/textures/planets/moon_1024.jpg',function(tex){
      moonMat.map=tex;moonMat.bumpMap=tex;moonMat.needsUpdate=true;
    },undefined,function(){});
    const mx=new THREE.Vector3(),my=new THREE.Vector3(),mz=new THREE.Vector3(),mBasis=new THREE.Matrix4();''')

# 2. Tidal locking: the near side always faces Earth
edit("tidal lock", r'''      moon.position.copy(toE(eclToEq(p)));''', r'''      moon.position.copy(toE(eclToEq(p)));
      // tidal lock: the texture centre (+X) always points at Earth, north stays up
      mx.copy(moon.position).negate().normalize();
      my.set(0,1,0).addScaledVector(mx,-mx.y).normalize();
      mz.crossVectors(mx,my);
      moon.quaternion.setFromRotationMatrix(mBasis.makeBasis(mx,my,mz));''')

# 3. Debris fragments: irregular, lit, tumbling instanced meshes
edit("fragment definitions", r'''    // ----- satellites from CelesTrak -----''', r'''    // ----- debris fragments: irregular, lit, tumbling. Positions are real (SGP4); size is exaggerated -----
    const FRAG_SIZE=.016;   // scene units (about 100 km). Real fragments are centimetres to metres.
    const FRAG_NEAR=16;     // camera distance (Earth radii) below which fragments replace the dots
    const fragGeo=(function(){
      const g=new THREE.IcosahedronGeometry(1,1),p=g.attributes.position,off={};
      for(let i=0;i<p.count;i++){   // same offset for shared corners, so the shard has no cracks
        const x=p.getX(i),y=p.getY(i),z=p.getZ(i),k=x.toFixed(3)+','+y.toFixed(3)+','+z.toFixed(3);
        if(!off[k]){const h=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453;off[k]=.6+.7*(h-Math.floor(h));}
        p.setXYZ(i,x*off[k],y*off[k],z*off[k]);
      }
      g.computeVertexNormals();return g;
    })();
    function makeFragments(n){
      const mat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.55,metalness:.35,flatShading:true});
      const m=new THREE.InstancedMesh(fragGeo,mat,Math.max(n,1));
      const spin=new Float32Array(n*5),scl=new Float32Array(n*3),col=new THREE.Color(),ax=new THREE.Vector3();
      for(let i=0;i<n;i++){
        ax.set(Math.random()-.5,Math.random()-.5,Math.random()-.5).normalize();
        spin.set([ax.x,ax.y,ax.z,(Math.random()*.8+.2)*(Math.random()<.5?-1:1),Math.random()*6.28],i*5);   // axis, rad/s, phase
        const s=FRAG_SIZE*(.5+Math.pow(Math.random(),2)*1.5);
        scl.set([s*(.6+Math.random()*1.4),s*(.3+Math.random()*.9),s*(.4+Math.random()*1.0)],i*3);
        const r=Math.random();   // dark metal, scorched grey, occasional gold insulation foil
        col.set(r<.12?0xd9a441:r<.55?0x6f737a:0x3b3f46).offsetHSL(0,0,(Math.random()-.5)*.08);
        m.setColorAt(i,col);
      }
      m.frustumCulled=false;m.visible=false;gE.add(m);
      return {mesh:m,spin:spin,scl:scl,q:new THREE.Quaternion(),ax:new THREE.Vector3(),mat4:new THREE.Matrix4(),p:new THREE.Vector3(),s:new THREE.Vector3()};
    }
    function updateFragments(t){
      const dist=camera.position.length(),k=Math.min(2.5,Math.max(.5,dist/4));
      for(const L of layers){
        const F=L.frag;if(!F)continue;
        const show=mode==='earth'&&L.pts.visible&&dist<FRAG_NEAR;
        F.mesh.visible=show;L.pts.material.visible=!show;   // dots stay pickable, just not drawn
        if(!show)continue;
        const pos=L.pos,sp=F.spin,sc=F.scl;
        for(let i=0;i<L.sats.length;i++){
          const x=pos[i*3],y=pos[i*3+1],z=pos[i*3+2],gone=!x&&!y&&!z;
          F.ax.set(sp[i*5],sp[i*5+1],sp[i*5+2]);
          F.q.setFromAxisAngle(F.ax,sp[i*5+3]*t+sp[i*5+4]);
          F.p.set(x,y,z);
          F.s.set(gone?0:sc[i*3]*k,gone?0:sc[i*3+1]*k,gone?0:sc[i*3+2]*k);
          F.mat4.compose(F.p,F.q,F.s);F.mesh.setMatrixAt(i,F.mat4);
        }
        F.mesh.instanceMatrix.needsUpdate=true;
      }
    }

    // ----- satellites from CelesTrak -----''')

edit("layer fragments", r'''      return {kind:kind,sats:sats,pos:pos,geo:geo,pts:pts};''',
 r'''      const L={kind:kind,sats:sats,pos:pos,geo:geo,pts:pts,frag:null};
      if(kind==='debris')L.frag=makeFragments(sats.length);
      return L;''')

# 4. Camera can orbit a target, so you can fly in on the Moon
edit("controls target", r'''o={autoRotate:false};''', r'''o={autoRotate:false,target:new THREE.Vector3()};''')
edit("camera position", r'''camera.position.set(dist*Math.sin(ph)*Math.sin(th),dist*Math.cos(ph),dist*Math.sin(ph)*Math.cos(th));''',
 r'''camera.position.set(o.target.x+dist*Math.sin(ph)*Math.sin(th),o.target.y+dist*Math.cos(ph),o.target.z+dist*Math.sin(ph)*Math.cos(th));''')
edit("camera look", r'''camera.lookAt(0,0,0);''', r'''camera.lookAt(o.target);''')
edit("focus state", r'''let selected=null,selOrbit=null,dataNote='';''', r'''let selected=null,selOrbit=null,dataNote='',focusMoon=false;''')
edit("mode resets focus", r'''mode=m;gE.visible=m==='earth';gS.visible=m==='solar';''',
 r'''mode=m;focusMoon=false;moonBtn.textContent='Focus on Moon';moonBtn.classList.remove('on');gE.visible=m==='earth';gS.visible=m==='solar';''')
edit("moon button", r'''    document.querySelectorAll('.gbtn[data-mode]').forEach(function(b){b.addEventListener('click',function(){setMode(b.dataset.mode);});});''',
 r'''    const moonBtn=document.createElement('button');
    moonBtn.className='gbtn earthonly';moonBtn.textContent='Focus on Moon';
    viewBtn.parentNode.insertBefore(moonBtn,viewBtn.nextSibling);
    moonBtn.addEventListener('click',function(){
      focusMoon=!focusMoon;
      if(focusMoon){controls.setLimits(.5,40,1.3);moonBtn.textContent='Back to Earth';moonBtn.classList.add('on');}
      else{controls.setLimits(1.5,260,4.3);moonBtn.textContent='Focus on Moon';moonBtn.classList.remove('on');viewBtn.textContent='Zoom out to Moon';}
      setHover(null);
    });
    document.querySelectorAll('.gbtn[data-mode]').forEach(function(b){b.addEventListener('click',function(){setMode(b.dataset.mode);});});''')
edit("main loop", r'''      controls.update();''', r'''      if(focusMoon&&mode==='earth')controls.target.copy(moon.position);else controls.target.set(0,0,0);
      controls.update();
      updateFragments(now/1000);''')
edit("status note", r''' faster than satellites so it visibly moves''', r''' faster than satellites so it visibly moves · debris fragments enlarged for visibility''')

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    src = open(path, encoding="utf-8").read()
    for name, old, new in EDITS:
        n = src.count(old)
        if n != 1:
            sys.exit(f"Patch '{name}' matched {n} times (expected 1). Nothing was written.")
        src = src.replace(old, new)
    shutil.copyfile(path, path + ".bak")
    open(path, "w", encoding="utf-8").write(src)
    print(f"Applied {len(EDITS)} edits. Backup: {path}.bak")
