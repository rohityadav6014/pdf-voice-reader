/*
 * Visual effects: Three.js 3D backdrop, 3D tilt cards, reveal-on-scroll, ripples and glass spotlight.
 * Everything is decorative; the app works the same if any of it fails to load.
 */
const FX = (() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

  let energyTarget = 0;   // 0 idle → 1 while the voice is reading
  let kick = 0;           // short burst on every new sentence

  /* ---------- 3D backdrop ---------- */
  function loadThree() {
    return new Promise((resolve, reject) => {
      if (window.THREE) { resolve(); return; }
      const s = document.createElement('script');
      s.src = THREE_URL;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function startScene() {
    const canvas = document.getElementById('bg3d');
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      return; // no WebGL: the CSS aurora stays as the backdrop
    }
    const small = window.innerWidth < 760;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.5));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x07071a, 0.045);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 0, 14);

    // Lights: soft ambient plus three coloured lights that orbit the shapes.
    scene.add(new THREE.AmbientLight(0x6d5dfc, 0.45));
    const lights = [0x8b5cf6, 0x22d3ee, 0xec4899].map((c, i) => {
      const l = new THREE.PointLight(c, 2.2, 40);
      l.userData.phase = (i / 3) * Math.PI * 2;
      scene.add(l);
      return l;
    });

    const shapes = [];
    const glossy = color => new THREE.MeshStandardMaterial({
      color, metalness: 0.55, roughness: 0.18, flatShading: true, emissive: color, emissiveIntensity: 0.08,
    });
    const wire = color => new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.18 });

    // Positions are given relative to the visible screen (-1…1) so shapes hug the edges at any window size.
    function addShape(geometry, color, nx, ny, z, scale, speed) {
      const group = new THREE.Group();
      const solid = new THREE.Mesh(geometry, glossy(color));
      const shell = new THREE.Mesh(geometry, wire(0xffffff));
      shell.scale.setScalar(1.18);
      group.add(solid, shell);
      group.scale.setScalar(scale);
      group.userData = { nx, ny, z, base: new THREE.Vector3(), scale, speed, shell, seed: Math.random() * 100 };
      scene.add(group);
      shapes.push(group);
    }

    addShape(new THREE.IcosahedronGeometry(1.6, 0), 0x7c3aed, -0.92, 0.62, -2, 1, 0.35);
    addShape(new THREE.TorusKnotGeometry(1.0, 0.32, 120, 16), 0x06b6d4, 0.9, -0.55, -3, 1.05, 0.25);
    addShape(new THREE.OctahedronGeometry(1.1, 0), 0xdb2777, 0.78, 0.8, -5, 0.9, 0.45);
    addShape(new THREE.DodecahedronGeometry(1.0, 0), 0x4f46e5, -0.85, -0.78, -4, 0.85, 0.3);
    if (!small) {
      addShape(new THREE.TorusGeometry(1.0, 0.28, 16, 60), 0xa855f7, 0.05, 1.05, -8, 0.9, 0.4);
      addShape(new THREE.IcosahedronGeometry(0.8, 1), 0x0ea5e9, -0.2, -1.05, -7, 0.8, 0.5);
    }

    function placeShapes() {
      const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      shapes.forEach(g => {
        const u = g.userData;
        const halfH = halfTan * (camera.position.z - u.z);
        u.base.set(u.nx * halfH * camera.aspect, u.ny * halfH, u.z);
        g.position.copy(u.base);
      });
    }

    // Particle field.
    const count = small ? 350 : 900;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 40;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 26;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 30 - 5;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
      color: 0xc4b5fd, size: 0.06, transparent: true, opacity: 0.75, depthWrite: false,
    }));
    scene.add(particles);

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      placeShapes();
    }
    resize();
    window.addEventListener('resize', resize);

    const mouse = { x: 0, y: 0 };
    window.addEventListener('pointermove', e => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    let energy = 0;
    let last = performance.now();
    let t = 0;
    let running = true;
    document.addEventListener('visibilitychange', () => {
      running = !document.hidden;
      if (running) { last = performance.now(); requestAnimationFrame(frame); }
    });

    function frame(now) {
      if (!running) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      energy += (energyTarget - energy) * Math.min(dt * 2.5, 1);
      kick *= Math.pow(0.04, dt);
      // A gentle "speaking" pulse while reading (speech audio can't be analysed directly).
      const voice = energy * (0.55 + 0.45 * Math.abs(Math.sin(now / 180) * Math.sin(now / 470)));
      t += dt * (1 + energy * 1.6);

      shapes.forEach(g => {
        const u = g.userData;
        g.rotation.x += dt * u.speed * (1 + energy * 2);
        g.rotation.y += dt * u.speed * 1.3 * (1 + energy * 2);
        g.position.z = u.base.z;
        g.position.y = u.base.y + Math.sin(t * 0.6 + u.seed) * 0.45;
        g.position.x = u.base.x + Math.cos(t * 0.4 + u.seed) * 0.3;
        g.scale.setScalar(u.scale * (1 + voice * 0.12 + kick * 0.1));
        u.shell.material.opacity = 0.14 + voice * 0.25 + kick * 0.2;
      });
      lights.forEach((l, i) => {
        const a = t * 0.5 + l.userData.phase;
        l.position.set(Math.cos(a) * 9, Math.sin(a * 1.3) * 5, 4 + Math.sin(a) * 3);
        l.intensity = 1.8 + energy * 1.4 + kick * 1.5;
      });
      particles.rotation.y += dt * (0.015 + energy * 0.05);
      particles.rotation.x = Math.sin(t * 0.1) * 0.05;

      camera.position.x += (mouse.x * 1.6 - camera.position.x) * Math.min(dt * 2, 1);
      camera.position.y += (-mouse.y * 1.0 - camera.position.y) * Math.min(dt * 2, 1);
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    document.body.classList.add('has-3d');
  }

  /* ---------- 3D tilt (with moving glare) ---------- */
  function initTilt() {
    if (reduceMotion || !finePointer) return;
    let active = null;
    document.addEventListener('pointermove', e => {
      const el = e.target.closest('[data-tilt], .note-card');
      if (active && active !== el) resetTilt(active);
      active = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const max = el.classList.contains('note-card') ? 4 : 9;
      el.style.setProperty('--rx', `${(0.5 - py) * max}deg`);
      el.style.setProperty('--ry', `${(px - 0.5) * max}deg`);
      el.style.setProperty('--gx', `${px * 100}%`);
      el.style.setProperty('--gy', `${py * 100}%`);
      el.classList.add('tilting');
    }, { passive: true });
    document.addEventListener('pointerleave', () => { if (active) resetTilt(active); active = null; });
  }

  function resetTilt(el) {
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.classList.remove('tilting');
  }

  /* ---------- Spotlight that follows the cursor across glass panels ---------- */
  function initSpotlight() {
    if (!finePointer) return;
    document.addEventListener('pointermove', e => {
      const g = e.target.closest('.glass');
      if (!g) return;
      const r = g.getBoundingClientRect();
      g.style.setProperty('--sx', `${e.clientX - r.left}px`);
      g.style.setProperty('--sy', `${e.clientY - r.top}px`);
    }, { passive: true });
  }

  /* ---------- Reveal on scroll (staggered) ---------- */
  function initReveal() {
    const els = [...document.querySelectorAll('[data-reveal]')];
    els.forEach((el, i) => el.style.setProperty('--d', `${i * 90}ms`));
    if (reduceMotion || !('IntersectionObserver' in window)) { els.forEach(el => el.classList.add('revealed')); return; }
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('revealed'); io.unobserve(en.target); } });
    }, { threshold: 0.1 });
    els.forEach(el => io.observe(el));
  }

  /* ---------- Ripple on buttons ---------- */
  function initRipples() {
    if (reduceMotion) return;
    document.addEventListener('pointerdown', e => {
      const b = e.target.closest('.btn, .icon-btn, .play-btn, .tab, .segmented button');
      if (!b) return;
      const r = b.getBoundingClientRect();
      const s = document.createElement('span');
      s.className = 'ripple';
      const size = Math.max(r.width, r.height) * 2;
      s.style.width = s.style.height = size + 'px';
      s.style.left = e.clientX - r.left - size / 2 + 'px';
      s.style.top = e.clientY - r.top - size / 2 + 'px';
      b.appendChild(s);
      s.addEventListener('animationend', () => s.remove());
    });
  }

  /* ---------- Public hooks ---------- */
  function setPlaying(playing) {
    energyTarget = playing ? 1 : 0;
    document.body.classList.toggle('is-playing', playing);
  }

  function pulse() { kick = 1; }

  function init() {
    initReveal();
    initTilt();
    initSpotlight();
    initRipples();
    if (reduceMotion) return;
    // Load the 3D scene after the page is usable.
    const start = () => loadThree().then(startScene).catch(() => {});
    if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 1500 });
    else setTimeout(start, 300);
  }

  return { init, setPlaying, pulse };
})();
