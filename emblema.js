/* =========================================================
   O "L" DA LUBE EM 3D (three.js)
   Um só elemento [data-emblema], que mora na tela de entrada e voa para a
   abertura depois do login (quem move é o app.js). Aqui fica só o desenho:
   a marca extrudada, brilhante, flutuando e olhando para o mouse.
   Sem WebGL (ou se o three.js não carregar) fica a marca plana do HTML.
   ========================================================= */
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const caixa = document.querySelector('[data-emblema]');
const canvas = caixa && caixa.querySelector('canvas');
const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer = null;
if (canvas) {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch (e) { renderer = null; }
}

if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(30, 1.15, 0.1, 50);
  camera.position.set(0, 0, 7.2);

  // o mesmo desenho da marca, com volume
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M24 6h34v56h42c6 0 10 4 10 10v12c0 10-8 18-18 18H24C12 102 4 94 4 82V26C4 14 12 6 24 6Z"/><path d="M68 6h36c6 0 10 4 10 10v32c0 3-2 4-5 4H68Z"/></svg>';
  const dados = new SVGLoader().parse(svg);
  const inclina = new THREE.Matrix4().set(1, -Math.tan(10 * Math.PI / 180), 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const mats = [
    new THREE.MeshPhysicalMaterial({ color: 0x3550e6, metalness: .3, roughness: .18, clearcoat: 1, clearcoatRoughness: .05 }),
    new THREE.MeshPhysicalMaterial({ color: 0xee1b24, metalness: .25, roughness: .2, clearcoat: 1, clearcoatRoughness: .05 })
  ];
  const marca = new THREE.Group();
  dados.paths.forEach((p, k) => {
    const geo = new THREE.ExtrudeGeometry(SVGLoader.createShapes(p), { depth: 16, bevelEnabled: true, bevelThickness: 3, bevelSize: 2.4, bevelSegments: 8, curveSegments: 28 });
    geo.applyMatrix4(inclina);
    marca.add(new THREE.Mesh(geo, mats[k]));
  });
  const centro = new THREE.Box3().setFromObject(marca).getCenter(new THREE.Vector3());
  marca.children.forEach((m) => m.geometry.translate(-centro.x, -centro.y, -centro.z));
  marca.scale.set(0.0255, -0.0255, 0.0255);
  const pivo = new THREE.Group(); pivo.add(marca); scene.add(pivo);

  const chave = new THREE.DirectionalLight(0xffffff, 1.4); chave.position.set(2, 3, 6); scene.add(chave);
  const contra = new THREE.DirectionalLight(0x9fd8ff, 1.6); contra.position.set(-4, 2, -3); scene.add(contra);
  const quente = new THREE.PointLight(0xff3344, 6, 12); quente.position.set(3, 1, 3); scene.add(quente);
  scene.add(new THREE.AmbientLight(0x30408a, .45));

  let larg = 0, alt = 0;
  function tamanho() {
    const w = caixa.clientWidth, h = caixa.clientHeight;
    if (!w || !h || (w === larg && h === alt)) return;
    larg = w; alt = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(tamanho).observe(caixa);
  addEventListener('resize', tamanho);

  const alvo = { x: 0, y: 0 }, atual = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => {
    alvo.x = (e.clientX / innerWidth) * 2 - 1;
    alvo.y = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });

  // entra girando; a cada giro pedido dá uma volta e sempre para de frente
  const VOLTA = Math.PI * 2;
  let giroDe = performance.now(), giroIni = calmo ? 0 : -Math.PI * 1.2, giroFim = 0;
  const ease = (x) => 1 - Math.pow(1 - x, 4);
  const t0 = performance.now();

  function desenhar(agora) {
    tamanho();
    if (!larg) return;
    const t = (agora - t0) / 1000;
    atual.x += (alvo.x - atual.x) * .06; atual.y += (alvo.y - atual.y) * .06;
    const g = Math.min(1, (agora - giroDe) / 1800);
    const giro = giroIni + (giroFim - giroIni) * ease(g);
    pivo.userData.giro = giro;
    pivo.rotation.y = (calmo ? 0 : giro + Math.sin(t * .5) * .28) + atual.x * .45;
    pivo.rotation.x = -.06 + atual.y * .2;
    pivo.position.y = calmo ? 0 : Math.sin(t * .9) * .06;
    renderer.render(scene, camera);
  }

  // só desenha quando o L está na tela (fora dela, ou com a aba escondida, não gasta nada)
  let visivel = true;
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver((es) => { visivel = es[es.length - 1].isIntersecting; }).observe(caixa);
  }
  (function quadro(agora) {
    requestAnimationFrame(quadro);
    if (!visivel || document.hidden || !caixa.clientWidth) return;
    desenhar(agora || performance.now());
  })();

  window.LubeEmblema = {
    desenhar,
    giro() {
      if (calmo) return;
      giroIni = pivo.userData.giro || 0;
      giroFim = (Math.round(giroIni / VOLTA) + 1) * VOLTA;
      giroDe = performance.now();
    }
  };
  desenhar(performance.now());
  caixa.classList.add('tem-3d');          // o 3D assumiu: some a marca plana
}
