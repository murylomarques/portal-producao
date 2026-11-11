/* FUP · cena 3D da tela de login — "Da fibra à conexão".
   Maquete procedural (sem modelos externos): poste com rede elétrica no topo e cabo de telecom abaixo, CTO (caixa de
   terminação óptica, passiva) na cordoalha, técnico com EPI numa escada amarrada (inclinação ~4:1), cabo drop em catenária
   até a fachada, ONU dentro da casa (LOS vermelho piscando sem fibra → PON verde depois do sinal), roteador com Wi-Fi.
   Fluxo FTTH: OLT → cabo de distribuição → CTO (splitter) → drop → ONU → roteador → dispositivos.
   A cena é só apresentação: o login funciona sem ela e nunca é dado como aceito sem a resposta do servidor. */
import * as THREE from './vendor/three/three.module.min.js';  // relativo: serve no portal local (/) e no IQT (/fup-portal/)

const OURO = 0xf4ba44, TEAL = 0x6fe3d6, VERDE = 0x37e07a, VERM = 0xff3b30;

export function iniciar(canvas) {
  const palco = canvas.parentElement;
  let reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;  // vira true também no modo estático (máquina sem aceleração)
  const toque = matchMedia('(pointer: coarse)').matches;
  const larg = () => palco.clientWidth, alt = () => palco.clientHeight;
  // desktop: a cena ocupa a tela toda atrás do formulário; o cenário é deslocado para a esquerda (sem corte entre os dois)
  const lateral = () => innerWidth > 820;
  // qualidade: 0 celular · 1 tablet/notebook pequeno · 2 desktop
  const nivel = innerWidth < 760 || (toque && innerWidth < 1100) ? 0 : innerWidth < 1280 ? 1 : 2;
  const dprMax = [1.25, 1.5, 1.75][nivel];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: nivel > 0, alpha: true, powerPreference: 'high-performance' });
  // sem placa de vídeo (Área de Trabalho Remota, VM): WebGL por software é lento demais para animar
  const gpu = (() => { const gl = renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : ''; })();
  const software = /swiftshader|llvmpipe|software|basic render/i.test(gpu);
  renderer.setClearColor(0x000000, 0);
  let dpr = Math.min(devicePixelRatio || 1, dprMax);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = nivel > 0 && !software;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const cena = new THREE.Scene();
  cena.fog = new THREE.Fog(0x140d0e, 24, 52);
  const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  const descartaveis = [];  // geometrias/materiais/texturas para liberar no fim
  const guarda = x => (descartaveis.push(x), x);

  // ---------------------------------------------------------------- ambiente (reflexos suaves sem HDR externo)
  {
    const pm = new THREE.PMREMGenerator(renderer), env = new THREE.Scene();
    const placa = (cor, x, y, z, w, h, ry = 0, rx = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: cor, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m); };
    env.background = new THREE.Color(0x0c0a0c);
    placa(0x3a4a66, 0, 14, 0, 30, 30, 0, Math.PI / 2);     // céu frio
    placa(0x7a4a2a, 10, 3, 6, 8, 5, -Math.PI / 3);          // luz quente da rua
    placa(0x223044, -12, 4, -4, 10, 6, Math.PI / 2.5);
    const rt = pm.fromScene(env, 0.04);
    cena.environment = guarda(rt.texture); cena.environmentIntensity = 0.42;
    env.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); pm.dispose();
  }

  // ---------------------------------------------------------------- utilidades de modelagem
  const MAT = {};
  const mat = (k, o) => MAT[k] || (MAT[k] = guarda(new THREE.MeshStandardMaterial(o)));
  const G = g => guarda(g);
  const alvos = [];  // malhas clicáveis (userData.alvo)
  function malha(geo, m, x, y, z, pai, { sombra = true, recebe = true, alvo = null } = {}) {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z);
    o.castShadow = sombra && nivel > 0; o.receiveShadow = recebe && nivel > 0;
    if (alvo) { o.userData.alvo = alvo; alvos.push(o); }
    pai.add(o); return o;
  }
  const caixa = (w, h, d) => G(new THREE.BoxGeometry(w, h, d));
  function caixaArred(w, h, d, r) {  // caixa com cantos arredondados (extrusão com chanfro)
    const s = new THREE.Shape(), x = -w / 2 + r, y = -h / 2 + r, W = w - 2 * r, H = h - 2 * r;
    s.moveTo(x, y); s.lineTo(x + W, y); s.lineTo(x + W, y + H); s.lineTo(x, y + H); s.lineTo(x, y);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 3, curveSegments: 4 });
    g.translate(0, 0, -(d - 2 * r) / 2); return G(g);
  }
  // catenária aproximada (parábola) entre a e b com flecha "sag"
  const catenaria = (a, b, sag, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const s = i / n; return new THREE.Vector3().lerpVectors(a, b, s).add(new THREE.Vector3(0, -sag * 4 * s * (1 - s), 0)); });
  const tubo = (pts, r, m, segs = 64, pai = cena, o = {}) => { const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal'); const t = malha(G(new THREE.TubeGeometry(c, segs, r, 6, false)), m, 0, 0, 0, pai, o); t.userData.curva = c; return t; };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // materiais
  const mConcreto = mat('concreto', { color: 0x8c8784, roughness: 0.88 });
  const mAsfalto = mat('asfalto', { color: 0x19181a, roughness: 0.96 });
  const mCalcada = mat('calcada', { color: 0x3b3635, roughness: 0.92 });
  const mGrama = mat('grama', { color: 0x1a221c, roughness: 1 });
  const mBase = mat('base', { color: 0x1d1617, roughness: 0.9 });
  const mCabo = mat('cabo', { color: 0x0c0c0d, roughness: 0.55 });
  const mFio = mat('fio', { color: 0x2b2a2a, roughness: 0.6, metalness: 0.4 });
  const mParede = mat('parede', { color: 0xd8d1c4, roughness: 0.82 });
  const mEscuro = mat('escuro', { color: 0x262223, roughness: 0.7 });
  const mMadeira = mat('madeira', { color: 0x8a5634, roughness: 0.62 });
  const mPiso = mat('piso', { color: 0x5b3f2c, roughness: 0.55 });
  const mVidro = mat('vidro', { color: 0x9fbfd6, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.16, depthWrite: false });
  const mPlastico = mat('plastico', { color: 0xeeeeea, roughness: 0.42 });
  const mPreto = mat('preto', { color: 0x161616, roughness: 0.4, metalness: 0.2 });
  const mAmarelo = mat('amarelo', { color: 0xe1a52d, roughness: 0.55 });
  const mAluminio = mat('aluminio', { color: 0xb9b9b9, roughness: 0.35, metalness: 0.8 });
  const mBorda = mat('borda', { color: 0x000000, emissive: OURO, emissiveIntensity: 0.9, roughness: 1 });

  // ---------------------------------------------------------------- maquete: base, rua, calçada, terreno
  const mundo = new THREE.Group(); cena.add(mundo);
  malha(caixa(18, 0.5, 13), mBase, 0.5, -0.25, -0.5, mundo, { sombra: false });
  for (const [w, d, x, z] of [[18, 0.03, 0.5, 5.985], [18, 0.03, 0.5, -6.985], [0.03, 13, -8.485, -0.5], [0.03, 13, 9.485, -0.5]]) malha(caixa(w, 0.03, d), mBorda, x, 0.002, z, mundo, { sombra: false, recebe: false });
  malha(caixa(18, 0.02, 3.4), mAsfalto, 0.5, 0.011, 3.9, mundo, { sombra: false });
  const mFaixa = mat('faixa', { color: 0x9a9384, roughness: 0.8, emissive: 0x2a2620, emissiveIntensity: 0.6 });
  for (let x = -7.5; x <= 8.5; x += 2) malha(caixa(1.0, 0.006, 0.09), mFaixa, x, 0.024, 3.9, mundo, { sombra: false });
  malha(caixa(18, 0.16, 0.12), mConcreto, 0.5, 0.08, 2.16, mundo);
  malha(caixa(18, 0.12, 1.6), mCalcada, 0.5, 0.06, 1.35, mundo, { sombra: false });
  malha(caixa(18, 0.04, 7.5), mGrama, 0.5, 0.02, -3.2, mundo, { sombra: false });
  // muro baixo do lote e caminho até a casa
  malha(caixa(0.9, 0.55, 0.14), mParede, 2.05, 0.3, 0.42, mundo);
  malha(caixa(5.6, 0.55, 0.14), mParede, 6.4, 0.3, 0.42, mundo);
  malha(caixa(0.8, 0.03, 1.9), mCalcada, 3.0, 0.045, -0.45, mundo, { sombra: false });

  // ---------------------------------------------------------------- postes, rede elétrica (topo) e cabo de telecom (abaixo)
  const POSTE = V(-3.2, 0, 1.0), Y_CORD = 6.2;
  function poste(x, z, alvo) {
    const g = new THREE.Group(); g.position.set(x, 0, z); mundo.add(g);
    malha(G(new THREE.CylinderGeometry(0.11, 0.17, 9, 14)), mConcreto, 0, 4.5, 0, g, { alvo });
    malha(caixa(0.12, 0.12, 1.9), mConcreto, 0, 8.55, 0, g);  // cruzeta
    for (const dz of [-0.75, 0, 0.75]) malha(G(new THREE.CylinderGeometry(0.035, 0.05, 0.16, 8)), mPlastico, 0, 8.69, dz, g, { sombra: false });
    malha(caixa(0.06, 0.06, 0.14), mAluminio, 0.13, Y_CORD, 0, g, { sombra: false });  // braçadeira da cordoalha
    return g;
  }
  poste(-8.0, 1.0); poste(POSTE.x, POSTE.z, 'cto');  // o próximo poste fica fora da maquete (os cabos seguem para fora)
  for (const dz of [-0.75, 0, 0.75]) {  // rede elétrica (média tensão) bem acima da telecom
    tubo([...catenaria(V(-9.5, 8.78, 1 + dz), V(-8, 8.78, 1 + dz), 0.05, 4), ...catenaria(V(-8, 8.78, 1 + dz), V(-3.2, 8.78, 1 + dz), 0.22, 10).slice(1), ...catenaria(V(-3.2, 8.78, 1 + dz), V(12, 8.4, 1 + dz), 0.55, 20).slice(1)], 0.012, mFio, 80, mundo, { sombra: false });
  }
  // cabo de distribuição óptico (com cordoalha) ao longo da rua
  const cordA = catenaria(V(-9.6, Y_CORD - 0.05, 1.0), V(-8, Y_CORD, 1.0), 0.04, 4), cordB = catenaria(V(-8, Y_CORD, 1.0), V(POSTE.x, Y_CORD, 1.0), 0.22, 12), cordC = catenaria(V(POSTE.x, Y_CORD, 1.0), V(12, Y_CORD - 0.35, 1.0), 0.5, 24);
  tubo([...cordA, ...cordB.slice(1), ...cordC.slice(1)], 0.028, mCabo, 120, mundo, { sombra: true });
  // reserva técnica (sobra de cabo enrolada no poste)
  const reserva = malha(G(new THREE.TorusGeometry(0.34, 0.022, 6, 40)), mCabo, POSTE.x + 0.02, 5.35, 1.14, mundo); reserva.rotation.y = Math.PI / 2.2;
  // CTO na cordoalha, à direita do poste
  const CTO = V(-2.5, 5.9, 1.0);
  const gCto = new THREE.Group(); gCto.position.copy(CTO); mundo.add(gCto);
  malha(caixaArred(0.42, 0.56, 0.26, 0.04), mat('cto', { color: 0x2c2d31, roughness: 0.5 }), 0, 0, 0, gCto, { alvo: 'cto' });
  malha(caixa(0.44, 0.03, 0.28), mat('ctoTampa', { color: 0x1d1e21, roughness: 0.45 }), 0, 0.13, 0, gCto, { alvo: 'cto' });
  malha(caixa(0.18, 0.06, 0.005), mAmarelo, 0, 0.19, 0.131, gCto, { sombra: false });  // etiqueta de identificação
  for (let i = 0; i < 8; i++) malha(G(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 8)), mat('porta', { color: 0x5aa9e6, roughness: 0.4 }), -0.147 + i * 0.042, -0.3, 0.03, gCto, { sombra: false, alvo: 'cto' });
  malha(caixa(0.08, 0.1, 0.06), mAluminio, -0.15, 0.24, -0.02, gCto, { sombra: false });  // suporte na cordoalha
  // drops de outros clientes já instalados
  tubo(catenaria(V(-2.6, 5.6, 1.03), V(-7.5, 3.3, -4.5), 0.5, 16), 0.012, mCabo, 40, mundo, { sombra: false });
  tubo(catenaria(V(-2.65, 5.6, 1.03), V(-6.0, 4.0, 6.5), 0.5, 16), 0.012, mCabo, 40, mundo, { sombra: false });

  // anel holográfico da porta da CTO
  const anelMat = guarda(new THREE.MeshBasicMaterial({ color: OURO, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  const anel = new THREE.Mesh(G(new THREE.TorusGeometry(0.06, 0.006, 6, 32)), anelMat); anel.position.set(CTO.x + 0.04, CTO.y - 0.33, CTO.z + 0.03); anel.rotation.x = Math.PI / 2; mundo.add(anel);

  // ---------------------------------------------------------------- poste de iluminação pública (luz quente na cena)
  {
    const g = new THREE.Group(); g.position.set(0.6, 0, 1.85); mundo.add(g);
    malha(G(new THREE.CylinderGeometry(0.05, 0.08, 4.3, 10)), mEscuro, 0, 2.15, 0, g);
    malha(caixa(0.06, 0.06, 0.8), mEscuro, 0, 4.25, 0.36, g);
    malha(caixa(0.26, 0.07, 0.42), mEscuro, 0, 4.2, 0.78, g);
    malha(caixa(0.2, 0.015, 0.34), mat('lampada', { color: 0xffe2b0, emissive: 0xffc27a, emissiveIntensity: 3 }), 0, 4.16, 0.78, g, { sombra: false });
    const luz = new THREE.PointLight(0xffb867, 26, 13, 1.6); luz.position.set(0, 3.95, 0.78); g.add(luz);
  }

  // ---------------------------------------------------------------- residência moderna (térreo aberto em vidro + volume superior com ripas)
  const gCasa = new THREE.Group(); mundo.add(gCasa);
  const casaAlvo = { alvo: 'casa' };
  malha(caixa(4.4, 3.0, 0.18), mParede, 5.0, 1.5, -5.31, gCasa, casaAlvo);
  malha(caixa(0.18, 3.0, 4.0), mParede, 2.89, 1.5, -3.4, gCasa, casaAlvo);
  malha(caixa(0.18, 3.0, 4.0), mParede, 7.11, 1.5, -3.4, gCasa, casaAlvo);
  malha(caixa(0.5, 3.0, 0.2), mParede, 3.05, 1.5, -1.5, gCasa, casaAlvo);   // pilar esquerdo
  malha(caixa(0.4, 3.0, 0.2), mParede, 7.0, 1.5, -1.5, gCasa, casaAlvo);    // pilar direito
  malha(caixa(3.5, 0.4, 0.2), mParede, 5.05, 2.8, -1.5, gCasa, casaAlvo);   // viga
  malha(caixa(3.5, 0.25, 0.2), mEscuro, 5.05, 0.125, -1.5, gCasa, casaAlvo);
  malha(caixa(3.5, 2.35, 0.02), mVidro, 5.05, 1.42, -1.44, gCasa, { sombra: false, recebe: false });
  for (const x of [4.2, 5.1, 5.95]) malha(caixa(0.035, 2.35, 0.05), mPreto, x, 1.42, -1.44, gCasa, { sombra: false });  // caixilhos
  malha(caixa(4.2, 0.06, 3.8), mPiso, 5.0, 0.03, -3.4, gCasa, { sombra: false });
  malha(caixa(4.7, 0.22, 4.25), mat('laje', { color: 0x2a2626, roughness: 0.8 }), 5.0, 3.11, -3.38, gCasa, casaAlvo);
  // volume superior em balanço
  malha(caixa(3.6, 2.28, 3.6), mParede, 5.85, 4.36, -3.85, gCasa, casaAlvo);
  malha(caixa(3.95, 0.16, 3.95), mat('laje', {}), 5.85, 5.58, -3.85, gCasa, casaAlvo);
  {  // ripas de madeira (1 draw call)
    const n = 15, im = new THREE.InstancedMesh(caixa(0.09, 2.0, 0.06), mMadeira, n), m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { m4.makeTranslation(4.25 + i * 0.165, 4.35, -2.02); im.setMatrixAt(i, m4); }
    im.castShadow = im.receiveShadow = nivel > 0; im.userData.alvo = 'casa'; alvos.push(im); gCasa.add(im);
  }
  const mJanelaSup = mat('janelaSup', { color: 0x0e1418, emissive: 0xffa75a, emissiveIntensity: 0.07, roughness: 0.08, metalness: 0.5 });
  malha(caixa(1.15, 0.9, 0.03), mJanelaSup, 7.1, 4.45, -2.03, gCasa, { sombra: false, alvo: 'casa' });
  malha(caixa(0.03, 0.9, 0.05), mPreto, 7.1, 4.45, -2.04, gCasa, { sombra: false });
  malha(caixa(1.15, 0.03, 0.05), mPreto, 7.1, 4.45, -2.04, gCasa, { sombra: false });
  // interior
  const mInterno = mat('interno', { color: 0xe8dccb, roughness: 0.85 });
  malha(caixa(4.2, 2.9, 0.02), mInterno, 5.0, 1.5, -5.2, gCasa, { sombra: false });
  malha(caixa(0.9, 0.04, 0.3), mMadeira, 3.45, 1.0, -1.78, gCasa);                 // prateleira
  const ONU = V(3.25, 1.05, -1.8), ROT = V(3.68, 1.05, -1.8);
  malha(caixaArred(0.26, 0.05, 0.18, 0.012), mPlastico, ONU.x, ONU.y, ONU.z, gCasa, { alvo: 'roteador' });
  const led = (x, y, z, cor) => { const m = guarda(new THREE.MeshBasicMaterial({ color: cor })); const o = new THREE.Mesh(G(new THREE.SphereGeometry(0.009, 8, 6)), m); o.position.set(x, y, z); gCasa.add(o); return m; };
  // LEDs da ONU (frente para a janela): POWER, PON, LOS, LAN, WLAN
  const L = { power: led(ONU.x - 0.08, ONU.y + 0.005, ONU.z + 0.092, VERDE), pon: led(ONU.x - 0.04, ONU.y + 0.005, ONU.z + 0.092, 0x0b2a14), los: led(ONU.x, ONU.y + 0.005, ONU.z + 0.092, VERM), lan: led(ONU.x + 0.04, ONU.y + 0.005, ONU.z + 0.092, 0x0b2a14), wlan: led(ONU.x + 0.08, ONU.y + 0.005, ONU.z + 0.092, 0x0b2a14) };
  malha(caixaArred(0.26, 0.04, 0.17, 0.012), mPreto, ROT.x, ROT.y - 0.005, ROT.z, gCasa, { alvo: 'roteador' });
  for (const dx of [-0.1, 0.1]) { const a = malha(G(new THREE.CylinderGeometry(0.008, 0.01, 0.2, 6)), mPreto, ROT.x + dx, ROT.y + 0.11, ROT.z - 0.07, gCasa, { alvo: 'roteador' }); a.rotation.z = dx > 0 ? -0.18 : 0.18; }
  const ledRot = led(ROT.x, ROT.y + 0.017, ROT.z + 0.087, 0x0b2a14);
  // sala: sofá, mesa com notebook, TV, celular, planta
  const mSofa = mat('sofa', { color: 0x5a5e66, roughness: 0.95 });
  malha(caixa(2.0, 0.38, 0.85), mSofa, 5.3, 0.25, -3.25, gCasa, casaAlvo);
  malha(caixa(2.0, 0.42, 0.18), mSofa, 5.3, 0.62, -2.88, gCasa, casaAlvo);
  malha(caixa(1.0, 0.05, 0.5), mMadeira, 5.4, 0.42, -4.25, gCasa, casaAlvo);
  for (const [dx, dz] of [[-0.45, -0.2], [0.45, -0.2], [-0.45, 0.2], [0.45, 0.2]]) malha(caixa(0.04, 0.4, 0.04), mPreto, 5.4 + dx, 0.2, -4.25 + dz, gCasa, { sombra: false });
  const mTela = n => mat('tela' + n, { color: 0x05070a, emissive: 0x4a86d8, emissiveIntensity: 0.12, roughness: 0.2 });
  malha(caixa(1.45, 0.82, 0.04), mPreto, 5.2, 1.6, -5.17, gCasa, casaAlvo);
  const tv = malha(caixa(1.38, 0.76, 0.01), mTela(1), 5.2, 1.6, -5.145, gCasa, { sombra: false, alvo: 'casa' });
  malha(caixa(0.34, 0.015, 0.24), mAluminio, 5.25, 0.455, -4.2, gCasa, { sombra: false });
  const note = malha(caixa(0.34, 0.22, 0.012), mTela(2), 5.25, 0.57, -4.33, gCasa, { sombra: false, alvo: 'casa' }); note.rotation.x = 0.25;
  const cel = malha(caixa(0.075, 0.012, 0.15), mTela(3), 6.05, 0.47, -3.2, gCasa, { sombra: false, alvo: 'casa' });
  malha(G(new THREE.CylinderGeometry(0.14, 0.11, 0.3, 12)), mEscuro, 6.75, 0.2, -4.9, gCasa);
  malha(G(new THREE.IcosahedronGeometry(0.34, 0)), mat('folha', { color: 0x2f5a3a, roughness: 0.9, flatShading: true }), 6.75, 0.62, -4.9, gCasa);
  const luzCasa = new THREE.PointLight(0xffb46b, 14, 7, 1.6); luzCasa.position.set(5.0, 2.55, -3.3); gCasa.add(luzCasa);
  malha(G(new THREE.CylinderGeometry(0.16, 0.22, 0.14, 16, 1, true)), mat('pendente', { color: 0x1a1a1a, emissive: 0xffc58a, emissiveIntensity: 0.6, side: THREE.DoubleSide }), 5.0, 2.48, -3.3, gCasa, { sombra: false });

  // árvores estilizadas
  const mTronco = mat('tronco', { color: 0x3b2a20, roughness: 0.9 }), mCopa = mat('copa', { color: 0x203a2a, roughness: 0.95, flatShading: true });
  for (const [x, z, s] of [[-6.4, -3.6, 1.15], [8.4, -5.6, 0.95], [-1.0, -4.8, 0.8], [1.6, -1.2, 0.5]]) {
    malha(G(new THREE.CylinderGeometry(0.07 * s, 0.11 * s, 1.6 * s, 7)), mTronco, x, 0.8 * s, z, mundo);
    malha(G(new THREE.IcosahedronGeometry(0.95 * s, 1)), mCopa, x, 2.1 * s, z, mundo);
  }

  // ---------------------------------------------------------------- escada (fibra, amarela) apoiada na cordoalha ~4:1
  const ESC_BASE = V(-2.93, 0.12, 2.2), ESC_TOPO = V(-2.93, Y_CORD - 0.08, 1.12);
  {
    const g = new THREE.Group(); mundo.add(g);
    const dir = new THREE.Vector3().subVectors(ESC_TOPO, ESC_BASE), Lz = dir.length(), ang = Math.atan2(-dir.z, dir.y);
    for (const dx of [-0.21, 0.21]) { const r = malha(caixa(0.055, Lz, 0.035), mAmarelo, ESC_BASE.x + dx, (ESC_BASE.y + ESC_TOPO.y) / 2, (ESC_BASE.z + ESC_TOPO.z) / 2, g, { alvo: 'tecnico' }); r.rotation.x = -ang; }
    const n = Math.floor(Lz / 0.3);
    const im = new THREE.InstancedMesh(G(new THREE.CylinderGeometry(0.016, 0.016, 0.42, 8)), mAluminio, n), m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    for (let i = 0; i < n; i++) { const p = new THREE.Vector3().lerpVectors(ESC_BASE, ESC_TOPO, (i + 0.6) / (n + 0.4)); m4.compose(p, q, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(i, m4); }
    im.castShadow = nivel > 0; g.add(im);
    // amarração da escada no poste (fita)
    tubo([V(-3.14, 5.75, 1.18), V(-3.32, 5.75, 0.98), V(-3.2, 5.75, 0.84), V(-3.0, 5.75, 0.98), V(-2.74, 5.78, 1.18)], 0.012, mAmarelo, 24, g, { sombra: false });
  }

  // ---------------------------------------------------------------- técnico estilizado com EPI (capacete, óculos, luvas, cinto paraquedista, talabarte)
  const tec = construirTecnico();
  const yPe = 4.12, zPe = ESC_BASE.z + (ESC_TOPO.z - ESC_BASE.z) * ((yPe - ESC_BASE.y) / (ESC_TOPO.y - ESC_BASE.y));
  tec.g.position.set(-2.93, yPe + 0.88, zPe + 0.2);
  tec.g.rotation.x = -0.16;  // corpo acompanha a inclinação da escada
  mundo.add(tec.g);

  function construirTecnico() {
    const g = new THREE.Group();
    const mFarda = mat('farda', { color: 0x8e2420, roughness: 0.7 }), mCalca = mat('calca', { color: 0x23252c, roughness: 0.85 });
    const mFaixaR = mat('refletiva', { color: 0xd9d9d9, roughness: 0.25, metalness: 0.6, emissive: 0x3a3a3a, emissiveIntensity: 0.5 });
    const mPele = mat('pele', { color: 0xb98060, roughness: 0.6 }), mLuva = mat('luva', { color: 0xd9a93a, roughness: 0.8 }), mCapacete = mat('capacete', { color: 0xf3f3f1, roughness: 0.35 });
    const mCinto = mat('cinto', { color: 0xc9961f, roughness: 0.7 }), mBota = mat('bota', { color: 0x2a1d16, roughness: 0.7 });
    const op = { alvo: 'tecnico' };
    const tronco = new THREE.Group(); g.add(tronco);
    const t = malha(G(new THREE.CapsuleGeometry(0.165, 0.34, 6, 16)), mFarda, 0, 0.47, 0, tronco, op); t.scale.z = 0.74;
    for (const y of [0.36, 0.56]) { const f = malha(G(new THREE.CylinderGeometry(0.168, 0.168, 0.035, 20, 1, true)), mFaixaR, 0, y, 0, tronco, { sombra: false }); f.scale.z = 0.75; }
    // cinto paraquedista: alças cruzadas nas costas, cintura e argola dorsal
    for (const s of [-1, 1]) { const a = malha(caixa(0.045, 0.5, 0.012), mCinto, 0.07 * s, 0.5, 0.128, tronco, { sombra: false }); a.rotation.z = 0.32 * s; const b = malha(caixa(0.045, 0.45, 0.012), mCinto, 0.075 * s, 0.5, -0.128, tronco, { sombra: false }); b.rotation.z = -0.1 * s; }
    const cinto = malha(G(new THREE.TorusGeometry(0.165, 0.024, 6, 24)), mCinto, 0, 0.2, 0, tronco, { sombra: false }); cinto.rotation.x = Math.PI / 2; cinto.scale.y = 0.76;
    malha(G(new THREE.TorusGeometry(0.03, 0.007, 6, 16)), mAluminio, 0, 0.64, 0.135, tronco, { sombra: false });
    // cabeça
    const cab = new THREE.Group(); cab.position.set(0, 0.84, 0); tronco.add(cab);
    malha(G(new THREE.CylinderGeometry(0.05, 0.055, 0.08, 10)), mPele, 0, -0.04, 0, cab, { sombra: false });
    malha(G(new THREE.SphereGeometry(0.105, 20, 14)), mPele, 0, 0.09, -0.005, cab, op);
    malha(G(new THREE.SphereGeometry(0.128, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), mCapacete, 0, 0.115, 0, cab, op);
    malha(G(new THREE.CylinderGeometry(0.134, 0.134, 0.028, 24, 1, true)), mat('faixaCap', { color: 0xae2e2a, roughness: 0.5 }), 0, 0.128, 0, cab, { sombra: false });
    const aba = malha(G(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 24)), mCapacete, 0, 0.112, -0.03, cab, { sombra: false }); aba.scale.z = 1.12;
    malha(caixa(0.15, 0.035, 0.02), mat('oculos', { color: 0x10161c, roughness: 0.1, metalness: 0.6 }), 0, 0.1, -0.1, cab, { sombra: false });
    // braços (ombro → cotovelo → mão)
    function braco(s) {
      const om = new THREE.Group(); om.position.set(0.2 * s, 0.68, 0); tronco.add(om);
      malha(G(new THREE.CapsuleGeometry(0.055, 0.2, 4, 10)), mFarda, 0, -0.13, 0, om, op);
      malha(G(new THREE.CylinderGeometry(0.058, 0.058, 0.03, 12, 1, true)), mFaixaR, 0, -0.17, 0, om, { sombra: false });
      const co = new THREE.Group(); co.position.set(0, -0.27, 0); om.add(co);
      malha(G(new THREE.CapsuleGeometry(0.048, 0.18, 4, 10)), mFarda, 0, -0.12, 0, co, op);
      malha(G(new THREE.SphereGeometry(0.052, 12, 10)), mLuva, 0, -0.26, 0, co, op);
      return { om, co };
    }
    const bD = braco(1), bE = braco(-1);
    // medidor de potência óptica na mão esquerda (tela acende na medição)
    const telaMed = mat('telaMed', { color: 0x041014, emissive: TEAL, emissiveIntensity: 0.05 });
    const med = new THREE.Group(); med.position.set(0, -0.3, -0.03); bE.co.add(med);
    malha(caixaArred(0.075, 0.13, 0.03, 0.008), mat('medidor', { color: 0xe4b23a, roughness: 0.5 }), 0, 0, 0, med, { sombra: false });
    malha(caixa(0.05, 0.045, 0.004), telaMed, 0, 0.025, -0.016, med, { sombra: false });
    // pernas: uma no degrau de cima (subindo), outra apoiada
    function perna(s, coxa, joelho) {
      const q = new THREE.Group(); q.position.set(0.085 * s, 0.06, 0); g.add(q);
      malha(G(new THREE.CapsuleGeometry(0.068, 0.34, 4, 10)), mCalca, 0, -0.23, 0, q, op);
      const j = new THREE.Group(); j.position.set(0, -0.44, 0); q.add(j);
      malha(G(new THREE.CapsuleGeometry(0.06, 0.32, 4, 10)), mCalca, 0, -0.21, 0, j, op);
      malha(G(new THREE.CylinderGeometry(0.063, 0.063, 0.03, 12, 1, true)), mFaixaR, 0, -0.1, 0, j, { sombra: false });
      malha(caixa(0.11, 0.08, 0.22), mBota, 0, -0.42, -0.04, j, op);
      q.rotation.x = coxa; j.rotation.x = joelho; return { q, j };
    }
    const pE = perna(-1, 0.62, -0.95), pD = perna(1, 0.12, -0.18);
    // talabarte de posicionamento em volta do poste (poste fica à esquerda-frente do técnico)
    tubo([V(-0.16, 0.2, -0.02), V(-0.24, 0.24, -0.4), V(-0.43, 0.27, -0.72), V(-0.27, 0.29, -0.92), V(-0.1, 0.27, -0.75), V(0.04, 0.24, -0.45), V(0.16, 0.2, -0.04)], 0.012, mat('talabarte', { color: 0x1e1e1e, roughness: 0.7 }), 40, tronco, { sombra: false });
    return { g, tronco, cab, bD, bE, pE, pD, telaMed };
  }

  // poses (ângulos em rad): oD/cD ombro e cotovelo direitos, oE/cE esquerdos, cab cabeça, tro tronco
  const POSE = {
    apoio: { oD: [0.62, 0, 0.22], cD: [0.75, 0, 0], oE: [0.62, 0, -0.22], cE: [0.75, 0, 0], cab: [0.05, 0, 0], tro: [0, 0, 0] },
    alcanca: { oD: [1.85, 0, 0.42], cD: [0.25, 0, 0], oE: [0.62, 0, -0.22], cE: [0.75, 0, 0], cab: [0.28, -0.32, 0], tro: [0, -0.12, 0] },
    encaixa: { oD: [1.95, 0, 0.36], cD: [0.42, 0, 0], oE: [0.62, 0, -0.22], cE: [0.75, 0, 0], cab: [0.3, -0.3, 0], tro: [0.03, -0.12, 0] },
    mede: { oD: [0.62, 0, 0.22], cD: [0.75, 0, 0], oE: [1.05, 0, 0.12], cE: [1.45, 0, 0], cab: [-0.25, 0.05, 0], tro: [0, 0.05, 0] },
    olhaCasa: { oD: [0.62, 0, 0.22], cD: [0.75, 0, 0], oE: [0.55, 0, -0.22], cE: [0.7, 0, 0], cab: [-0.05, -0.85, 0], tro: [0, -0.32, 0] },
    joinha: { oD: [0.35, 0, 1.25], cD: [1.35, 0, 0], oE: [0.62, 0, -0.22], cE: [0.75, 0, 0], cab: [0.05, -0.95, 0], tro: [0, -0.4, 0] },
  };
  const mix = (a, b, t) => { const o = {}; for (const k in a) o[k] = a[k].map((v, i) => v + (b[k][i] - v) * t); return o; };
  function aplicaPose(p, resp) {
    tec.bD.om.rotation.set(...p.oD); tec.bD.co.rotation.set(...p.cD);
    tec.bE.om.rotation.set(...p.oE); tec.bE.co.rotation.set(...p.cE);
    tec.cab.rotation.set(...p.cab); tec.tronco.rotation.set(p.tro[0] + resp * 0.015, p.tro[1], p.tro[2]);
  }

  // ---------------------------------------------------------------- caminho da luz: cabo de distribuição → CTO → drop → ONU
  const pDrop = [V(-2.46, 5.6, 1.03), V(-2.43, 5.42, 1.0), ...catenaria(V(-2.4, 5.36, 0.97), V(3.05, 3.26, -1.32), 0.62, 20).slice(1), V(3.05, 2.72, -1.32), V(3.08, 2.6, -1.55), V(3.1, 1.6, -1.66), V(3.14, 1.15, -1.74), V(ONU.x - 0.1, ONU.y + 0.01, ONU.z - 0.02)];
  const drop = tubo(pDrop, 0.014, mCabo, 160, mundo, { sombra: false, alvo: 'cto' });
  malha(G(new THREE.SphereGeometry(0.03, 10, 8)), mAluminio, 3.05, 3.26, -1.36, mundo, { sombra: false });  // gancho de ancoragem na fachada
  const curvaDrop = drop.userData.curva;
  const curvaRede = new THREE.CatmullRomCurve3([...cordA, ...cordB.slice(1, -1), V(CTO.x - 0.4, Y_CORD - 0.04, 1.0), V(CTO.x - 0.2, CTO.y + 0.05, 1.0), V(CTO.x, CTO.y - 0.1, 1.0), pDrop[0]], false, 'centripetal');
  const caminho = new THREE.CurvePath(); caminho.add(curvaRede); caminho.add(curvaDrop);
  const LUT = caminho.getSpacedPoints(700), comps = caminho.getCurveLengths(), U_CTO = comps[0] / comps[1];
  const pontoU = (u, alvo) => { const f = Math.min(0.99999, Math.max(0, u)) * (LUT.length - 1), i = Math.floor(f); return alvo.lerpVectors(LUT[i], LUT[i + 1], f - i); };

  // brilho do drop (shader): frente da luz, cabeça do pulso e fluxo contínuo depois da ativação
  const brilhoU = { uProg: { value: 0 }, uT: { value: 0 }, uRealce: { value: 0 }, uCor: { value: new THREE.Color(OURO) }, uBase: { value: 0.18 } };
  const brilhoMat = guarda(new THREE.ShaderMaterial({
    uniforms: brilhoU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying float vU; void main(){ vU = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uProg,uT,uRealce,uBase; uniform vec3 uCor; varying float vU;
      void main(){ float aceso = 1.0 - smoothstep(uProg - 0.02, uProg, vU);
        float cabeca = exp(-pow((vU - uProg) * 45.0, 2.0)) * step(0.001, uProg) * (1.0 - step(0.999, uProg));
        float fluxo = pow(fract(vU * 16.0 - uT * 0.55), 12.0);
        float a = aceso * (uBase + 0.45 * fluxo + 0.75 * uRealce) + cabeca * 1.6;
        gl_FragColor = vec4(uCor * a, a); }`,
  }));
  const brilhoDrop = new THREE.Mesh(G(new THREE.TubeGeometry(curvaDrop, 200, 0.034, 8, false)), brilhoMat); mundo.add(brilhoDrop);
  const redeU = { ...brilhoU, uProg: { value: 1 } };
  const brilhoRede = new THREE.Mesh(G(new THREE.TubeGeometry(curvaRede, 120, 0.05, 8, false)), guarda(brilhoMat.clone())); brilhoRede.material.uniforms = redeU; mundo.add(brilhoRede);
  const luzPulso = new THREE.PointLight(OURO, 0, 3.5, 1.8); mundo.add(luzPulso);

  // partículas de dados ao longo do caminho
  const N = software ? 40 : [70, 120, 170][nivel];
  const pGeo = G(new THREE.BufferGeometry()), pPos = new Float32Array(N * 3), pTam = new Float32Array(N), pOff = Float32Array.from({ length: N }, () => Math.random()), pVel = Float32Array.from({ length: N }, () => 0.75 + Math.random() * 0.5);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('tam', new THREE.BufferAttribute(pTam, 1));
  const pMat = guarda(new THREE.ShaderMaterial({
    uniforms: { uCor: { value: new THREE.Color(0xffd27a) }, uEsc: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float tam; uniform float uEsc; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = tam * uEsc / -mv.z; vA = step(0.001, tam); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uCor; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a = a * a * vA; gl_FragColor = vec4(uCor * a * 1.4, a); }',
  }));
  const particulas = new THREE.Points(pGeo, pMat); particulas.frustumCulled = false; mundo.add(particulas);

  // ondas de Wi-Fi (cascas que se expandem a partir do roteador)
  const wifiMat = guarda(new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 }, uCor: { value: new THREE.Color(TEAL) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float uA; uniform vec3 uCor; varying vec3 vN; varying vec3 vV; void main(){ float r = pow(1.0 - abs(dot(vN, vV)), 1.6); float a = r * uA * 1.6; gl_FragColor = vec4(uCor * a, a); }',
  }));
  const ondas = [0, 1, 2].map(() => { const m = new THREE.Mesh(G(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.62)), wifiMat.clone()); m.position.copy(ROT).add(V(0, 0.03, 0)); m.visible = false; mundo.add(m); guarda(m.material); return m; });
  // pontos de conexão nos dispositivos
  const dispositivos = [{ n: 'TV', p: V(5.2, 2.08, -5.1) }, { n: 'Notebook', p: V(5.25, 0.78, -4.3) }, { n: 'Celular', p: V(6.05, 0.62, -3.2) }];
  const dGeo = G(new THREE.BufferGeometry().setFromPoints(dispositivos.map(d => d.p))), dTam = new Float32Array(3);
  dGeo.setAttribute('tam', new THREE.BufferAttribute(dTam, 1));
  const dMat = guarda(pMat.clone()); dMat.uniforms = { uCor: { value: new THREE.Color(TEAL) }, uEsc: pMat.uniforms.uEsc };
  const pontosDisp = new THREE.Points(dGeo, dMat); pontosDisp.frustumCulled = false; mundo.add(pontosDisp);

  // estrelas discretas
  if (nivel > 0) {
    const n = 380, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const th = Math.random() * Math.PI * 2, ph = Math.random() * 0.45 + 0.08, r = 70; pos.set([Math.cos(th) * Math.cos(ph) * r, Math.sin(ph) * r + 4, Math.sin(th) * Math.cos(ph) * r - 10], i * 3); }
    const g = G(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    cena.add(new THREE.Points(g, guarda(new THREE.PointsMaterial({ color: 0xc9d6ff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.55, fog: false }))));
  }

  // ---------------------------------------------------------------- luzes
  cena.add(new THREE.HemisphereLight(0x8098c0, 0x1a1012, 0.55));
  const lua = new THREE.DirectionalLight(0xa9bfff, 1.15); lua.position.set(-7, 14, 9); lua.target.position.set(1, 2, -1);
  if (nivel > 0) { lua.castShadow = true; lua.shadow.mapSize.set(nivel === 2 ? 2048 : 1024, nivel === 2 ? 2048 : 1024); Object.assign(lua.shadow.camera, { left: -11, right: 11, top: 11, bottom: -9, near: 1, far: 40 }); lua.shadow.bias = -0.0006; lua.shadow.normalBias = 0.02; }
  cena.add(lua, lua.target);
  const luzCto = new THREE.PointLight(TEAL, 0, 2.2, 2); luzCto.position.set(CTO.x + 0.2, CTO.y - 0.2, CTO.z + 0.5); mundo.add(luzCto);

  // ---------------------------------------------------------------- rótulos holográficos (DOM projetado)
  const camadaRot = document.getElementById('rotulos');
  const ROT_DEF = {
    cto: [V(CTO.x, CTO.y + 0.42, CTO.z), 'CTO · porta 3 · <b>splitter 1:8</b>'],
    medidor: [V(-2.93, 5.95, 1.6), 'Potência óptica <b>−19,8 dBm</b> · <span class="ok">dentro da faixa</span>'],
    onu: [V(ONU.x, ONU.y + 0.35, ONU.z + 0.2), 'ONU · <span class="ok">PON ●</span> · LOS ○ · provisionada'],
    wifi: [V(ROT.x + 0.6, 2.4, -1.4), 'Wi-Fi <b>2,4 + 5 GHz</b> · 3 dispositivos'],
    tecnico: [V(-2.93, 6.05, 1.75), 'Técnico Desktop · <b>EPI completo</b>: capacete, óculos, luvas, cinto e talabarte'],
    fibra: [V(0.4, 4.9, -0.1), 'Drop óptico · CTO → residência · <b>luz em trânsito</b>'],
    ...Object.fromEntries(dispositivos.map((d, i) => ['disp' + i, [d.p.clone().add(V(0, 0.12, 0)), `<span class="ok">●</span> ${d.n} conectado`]])),
  };
  const rotulos = {};
  for (const [k, [p, html]] of Object.entries(ROT_DEF)) { const el = document.createElement('div'); el.className = 'rot'; el.innerHTML = html; camadaRot.appendChild(el); rotulos[k] = { el, p, on: false, ate: 0 }; }
  // celular: a história fica só na linha de texto (rótulos só quando a pessoa toca num objeto)
  const mostra = (k, on, seg = 0, toqueUsuario = false) => { const r = rotulos[k]; if (!r || (on && nivel === 0 && !toqueUsuario)) return; r.on = on; r.ate = seg ? relogio + seg : 0; r.el.classList.toggle('on', on); };
  const vTmp = new THREE.Vector3();
  function posicionaRotulos() {
    const w = larg(), h = alt();
    for (const r of Object.values(rotulos)) {
      if (r.ate && relogio > r.ate) { r.on = false; r.ate = 0; r.el.classList.remove('on'); }
      if (!r.on && !r.el.classList.contains('on')) continue;
      vTmp.copy(r.p).project(cam);
      const fora = vTmp.z > 1 || Math.abs(vTmp.x) > 1.1 || Math.abs(vTmp.y) > 1.1;
      r.el.style.transform = `translate(${((vTmp.x + 1) / 2 * w).toFixed(1)}px,${((1 - vTmp.y) / 2 * h).toFixed(1)}px) translate(-50%,-100%)`;
      r.el.style.visibility = fora ? 'hidden' : '';
    }
  }

  // ---------------------------------------------------------------- câmera, parallax e tamanho
  const CAM_FIM = V(12.4, 8.2, 21.0), ALVO_FIM = V(1.9, 3.2, -0.9), CAM_INI = V(22, 15, 33), ALVO_INI = V(1.4, 4.4, -1.5);
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  let recuo = 1;
  function redimensiona() {
    const w = Math.max(1, larg()), h = Math.max(1, alt());
    renderer.setSize(w, h, false); cam.aspect = w / h;
    const lado = lateral(), util = (lado ? w * 0.6 : w) / h;  // proporção da área livre à esquerda do formulário
    if (lado) cam.setViewOffset(w, h, w * 0.19, 0, w, h); else cam.clearViewOffset();
    recuo = util < 1.05 ? Math.pow(1.05 / util, 0.85) : util > 1.9 ? 0.9 : 1;  // retrato afasta; muito largo aproxima
    cam.updateProjectionMatrix(); pMat.uniforms.uEsc.value = renderer.getPixelRatio() * h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));  // tamanho em metros → pixels
    pedeQuadro();
  }
  const ro = new ResizeObserver(redimensiona); ro.observe(palco);
  const aoMover = ev => { const r = palco.getBoundingClientRect(); mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1; mouse.y = ((ev.clientY - r.top) / r.height) * 2 - 1; mouse.px = ev.clientX - r.left; mouse.py = ev.clientY - r.top; mouse.movido = palco.contains(ev.target); if (!mouse.movido) hover(null); if (reduz) pedeQuadro(); };
  window.addEventListener('pointermove', aoMover);
  palco.addEventListener('pointerleave', () => { mouse.x = mouse.y = 0; mouse.movido = false; hover(null); });

  // ---------------------------------------------------------------- interação com objetos (raycast)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let sobre = null;
  const ROT_HOVER = { cto: 'cto', casa: 'onu', roteador: 'wifi', tecnico: 'tecnico' };
  function hover(a) {
    if (a === sobre) return;
    if (sobre && !acaoAtiva(sobre)) mostra(ROT_HOVER[sobre], false);
    sobre = a; palco.style.cursor = a ? 'pointer' : '';
    if (a && historiaFim) mostra(ROT_HOVER[a], true);
    pedeQuadro();
  }
  function pick(px, py) {
    ndc.set(px / larg() * 2 - 1, -(py / alt()) * 2 + 1); ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObjects(alvos, false)[0];
    return hit ? hit.object.userData.alvo : null;
  }
  palco.addEventListener('click', ev => {
    if (ev.target.closest('.explorar')) return;
    const r = palco.getBoundingClientRect(), a = pick(ev.clientX - r.left, ev.clientY - r.top);
    if (a) acao(a);
  });
  const acoes = {};
  const acaoAtiva = a => acoes[a] && relogio < acoes[a];
  function acao(a) {
    const dur = { cto: 3, roteador: 3.2, casa: 4, tecnico: 2.8 }[a] || 3;
    acoes[a] = relogio + dur; acoes[a + '_ini'] = relogio;
    if (a === 'cto') { mostra('fibra', true, dur, true); mostra('cto', true, dur, true); }
    if (a === 'roteador') mostra('wifi', true, dur, true);
    if (a === 'casa') { dispositivos.forEach((_, i) => mostra('disp' + i, true, dur, true)); if (nivel > 0) mostra('onu', true, dur, true); }
    if (a === 'tecnico') mostra('tecnico', true, dur, true);
    const b = document.querySelector(`.explorar [data-alvo="${a === 'roteador' ? 'roteador' : a}"]`);
    if (b) { b.setAttribute('aria-pressed', 'true'); setTimeout(() => b.setAttribute('aria-pressed', 'false'), dur * 1000); }
    pedeQuadro(true);
  }
  const explorar = document.getElementById('explorar');
  explorar.hidden = false;
  explorar.addEventListener('click', ev => { const b = ev.target.closest('button[data-alvo]'); if (b) acao(b.dataset.alvo); });

  // ---------------------------------------------------------------- história (linha do tempo) e estados
  const fase = document.getElementById('fase');
  let faseAtual = '';
  const setFase = txt => { if (txt === faseAtual) return; faseAtual = txt; fase.classList.add('troca'); setTimeout(() => { fase.textContent = txt; fase.classList.remove('troca'); }, 350); };
  const T = { intro: 3.2, alcanca: 3.2, encaixa: 4.5, clique: 4.85, mede: 5.4, leitura: 6.0, pulso: 6.9, chega: 9.5, pon: 10.6, wifi: 10.7, olha: 10.9, fim: 14.0 };
  const DUR_PULSO = T.chega - T.pulso;
  let relogio = 0, historiaFim = false, autentic = 0, autAlvo = 0, erroAte = 0, saida = null;
  const suave = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  const ease = t => { t = Math.min(1, Math.max(0, t)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const passou = {};
  const uma = (k, t, fn) => { if (!passou[k] && relogio >= t) { passou[k] = 1; fn(); } };

  function poseHistoria(t) {
    if (t < T.alcanca) return POSE.apoio;
    if (t < T.encaixa) return mix(POSE.apoio, POSE.alcanca, ease((t - T.alcanca) / 1.1));
    if (t < T.mede) { const k = (t - T.encaixa) / (T.mede - T.encaixa); return mix(POSE.alcanca, POSE.encaixa, Math.sin(Math.min(1, k) * Math.PI)); }
    if (t < T.olha) return mix(POSE.alcanca, POSE.mede, ease((t - T.mede) / 0.9));
    if (t < T.fim) return mix(POSE.mede, POSE.olhaCasa, ease((t - T.olha) / 1.0));
    return mix(POSE.olhaCasa, POSE.apoio, ease((t - T.fim) / 1.4));
  }
  function poseOcioso(t) {  // depois da história: apoiado, olha em volta de vez em quando (sem repetir a sequência)
    const olhar = Math.max(0, Math.sin(t * 0.21)) ** 6;
    return mix(POSE.apoio, POSE.olhaCasa, olhar * 0.55);
  }

  let ultimo = performance.now(), rodando = false, pedido = 0, quadros = 0, somaDt = 0, ajustado = false, ajustes = 0, modo = 'animado';
  const vCam = V(0, 0, 0), vAlvo = V(0, 0, 0), vP = V(0, 0, 0);
  function quadro(agora) {
    pedido = 0;
    const dt = Math.min(0.1, (agora - ultimo) / 1000); ultimo = agora;
    if (!reduz) relogio += dt;
    const t = relogio;

    // eventos únicos da história
    uma('f0', 0.3, () => setFase('Técnico chegando à CTO no poste'));
    uma('f1', T.alcanca, () => { setFase('Conectando o drop na porta da CTO'); mostra('cto', true, 3.6); });
    uma('f2', T.mede, () => setFase('Medindo a potência do sinal óptico'));
    uma('f3', T.leitura, () => mostra('medidor', true, 2.6));
    uma('f4', T.pulso, () => { setFase('Luz percorrendo a fibra até a casa'); mostra('fibra', true, DUR_PULSO); });
    uma('f5', T.chega, () => { setFase('ONU sincronizada · sinal estável'); mostra('onu', true, 3.4); });
    uma('f6', T.wifi, () => { setFase('Wi-Fi no ar · cliente conectado'); mostra('wifi', true, 3.0); });
    uma('f7', T.fim + 0.8, () => { setFase('Rede ativa · da fibra à conexão'); historiaFim = true; explorar.classList.add('on'); });

    // técnico
    const resp = Math.sin(t * 1.7);
    let pose = historiaFim ? poseOcioso(t) : poseHistoria(t);
    if (acaoAtiva('tecnico')) { const k = (t - acoes.tecnico_ini) / (acoes.tecnico - acoes.tecnico_ini); pose = mix(pose, POSE.joinha, Math.sin(Math.min(1, k) * Math.PI) ** 0.6); }
    aplicaPose(pose, resp);
    tec.telaMed.emissiveIntensity = t > T.mede + 0.5 && t < T.olha + 0.6 ? 1.6 : 0.05;

    // anel da porta (clique do conector) e luz da CTO
    const kAnel = t > T.clique && t < T.clique + 1.2 ? 1 - (t - T.clique) / 1.2 : 0;
    const realceCto = acaoAtiva('cto') ? Math.sin(Math.min(1, (t - acoes.cto_ini) / (acoes.cto - acoes.cto_ini)) * Math.PI) : 0;
    anelMat.opacity = Math.max(kAnel, realceCto * 0.8); anel.scale.setScalar(1 + (1 - kAnel) * 0.8 + realceCto * 0.4);
    luzCto.intensity = (kAnel * 1.5 + realceCto * 1.2) * 1.2;

    // luz no drop
    const prog = t < T.pulso ? 0 : Math.min(1, (t - T.pulso) / DUR_PULSO);
    const progE = ease(prog);
    brilhoU.uProg.value = progE; brilhoU.uT.value = t;
    autentic += (autAlvo - autentic) * Math.min(1, dt * 4);
    const erroK = erroAte > t ? (erroAte - t) / 0.9 : 0;
    brilhoU.uRealce.value = realceCto * 0.9 + autentic * 0.5;
    brilhoU.uCor.value.setHex(OURO).lerp(new THREE.Color(VERM), erroK * 0.8);
    redeU.uT.value = t;
    if (prog > 0 && prog < 1) { pontoU(U_CTO + (1 - U_CTO) * progE, luzPulso.position); luzPulso.intensity = 6 * Math.sin(prog * Math.PI); } else luzPulso.intensity = 0;

    // partículas: antes da ativação só até a CTO; depois até a ONU
    const frente = t < T.pulso ? U_CTO : U_CTO + (1 - U_CTO) * progE;
    const vel = (0.045 + autentic * 0.11 + realceCto * 0.04) * (reduz ? 0 : 1);
    for (let i = 0; i < N; i++) {
      pOff[i] = (pOff[i] + dt * vel * pVel[i]) % 1;
      const u = pOff[i];
      pontoU(u, vP); pPos[i * 3] = vP.x; pPos[i * 3 + 1] = vP.y; pPos[i * 3 + 2] = vP.z;
      const vis = u <= frente ? 1 : 0, borda = Math.min(1, u / 0.04, Math.max(0, (frente - u) / 0.02));
      pTam[i] = vis * borda * (0.045 + (i % 5) * 0.008) * (1 + autentic * 0.4);
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.tam.needsUpdate = true;

    // ONU: sem fibra LOS pisca vermelho; com o sinal, PON pisca e firma; LAN/WLAN acendem
    const conectado = t >= T.chega;
    const pisca = (f) => (Math.sin(t * f) > 0 ? 1 : 0);
    L.los.color.setHex(!conectado ? (pisca(5) ? VERM : 0x2a0806) : 0x2a0806);
    L.pon.color.setHex(conectado ? (t < T.pon ? (pisca(18) ? VERDE : 0x0b2a14) : VERDE) : 0x0b2a14);
    L.lan.color.setHex(t > T.pon ? (Math.random() > 0.08 ? VERDE : 0x0b2a14) : 0x0b2a14);
    L.wlan.color.setHex(t > T.wifi ? (pisca(9 + Math.sin(t) * 3) ? VERDE : 0x1d6b3a) : 0x0b2a14);
    ledRot.color.setHex(t > T.wifi ? 0x7ff0e4 : 0x0b2a14);

    // Wi-Fi e dispositivos
    const wifiOn = t > T.wifi;
    const burst = acaoAtiva('roteador') ? 1 : 0;
    ondas.forEach((o, i) => {
      o.visible = wifiOn;
      if (!wifiOn) return;
      const per = burst ? 1.6 : 3.2, k = ((t - T.wifi) / per + i / 3) % 1;
      o.scale.setScalar(0.15 + k * (burst ? 3.4 : 2.6));
      o.material.uniforms.uA.value = (1 - k) ** 1.6 * (burst ? 1.0 : 0.55) * Math.min(1, (t - T.wifi) / 0.8);
    });
    const casaRealce = acaoAtiva('casa') ? 1 : 0;
    dispositivos.forEach((d, i) => { const on = t > T.wifi + 0.35 + i * 0.3; dTam[i] = on ? (0.11 + 0.03 * Math.sin(t * 3 + i) + casaRealce * 0.06) : 0; });
    dGeo.attributes.tam.needsUpdate = true;
    const telaK = t > T.wifi + 0.3 ? 1 : 0.12;
    MAT.tela1.emissiveIntensity = 0.12 + (telaK - 0.12) * 0.9; MAT.tela2.emissiveIntensity = 0.12 + (telaK - 0.12) * 1.1; MAT.tela3.emissiveIntensity = 0.12 + (telaK - 0.12) * 1.4;
    luzCasa.intensity = 14 + (t > T.wifi ? 4 : 0) + casaRealce * 4 + Math.sin(t * 0.7) * 0.6;

    // câmera: entrada cinematográfica, deriva lenta e parallax
    const ki = reduz ? 1 : ease(t / T.intro);
    vCam.lerpVectors(CAM_INI, CAM_FIM, ki); vAlvo.lerpVectors(ALVO_INI, ALVO_FIM, ki);
    const ang = (1 - ki) * 0.35; vCam.sub(vAlvo).applyAxisAngle(V(0, 1, 0), ang).multiplyScalar(recuo).add(vAlvo);
    if (!reduz) {
      vCam.x += Math.sin(t * 0.11) * 0.35; vCam.y += Math.sin(t * 0.07) * 0.18;
      mouse.sx += (mouse.x - mouse.sx) * Math.min(1, dt * 2.2); mouse.sy += (mouse.y - mouse.sy) * Math.min(1, dt * 2.2);
      vCam.x += mouse.sx * 1.1; vCam.y -= mouse.sy * 0.6;
    }
    if (saida) { const k = ease((agora - saida.t0) / 900); vCam.lerp(V(5.4, 2.2, 3.2), k * 0.75); vAlvo.lerp(V(5.0, 1.3, -3.5), k * 0.75); }
    cam.position.copy(vCam); cam.lookAt(vAlvo);

    // hover (1 raycast por quadro, só com mouse)
    if (mouse.movido && !toque) { mouse.movido = false; hover(pick(mouse.px, mouse.py)); }

    renderer.render(cena, cam);
    posicionaRotulos();

    // vigia de desempenho: lento → menos resolução e sem sombras; muito lento → imagem 3D parada (o formulário nunca trava)
    if (!reduz && !ajustado && relogio > 0.6) {
      quadros++; somaDt += dt;
      if (quadros === 30) {
        const med = somaDt / quadros; quadros = somaDt = 0;
        if (med > 1 / 12) estatico();
        else if (med > 1 / 32) { ajustes++; dpr = Math.max(1, dpr * 0.72); renderer.setPixelRatio(dpr); renderer.shadowMap.enabled = false; cena.traverse(o => { if (o.material) o.material.needsUpdate = true; }); redimensiona(); if (ajustes >= 2) ajustado = true; }
        else ajustado = true;
      }
    }
    if (rodando && !reduz) pedido = requestAnimationFrame(quadro);
  }
  function pedeQuadro(forca) { if (!pedido && (reduz || forca || !rodando)) pedido = requestAnimationFrame(quadro); }
  function play() { if (rodando) return; rodando = true; ultimo = performance.now(); if (!pedido) pedido = requestAnimationFrame(quadro); }
  function pausa() { rodando = false; if (pedido) { cancelAnimationFrame(pedido); pedido = 0; } }

  // movimento reduzido (ou máquina lenta): cena já no estado final, sem animação contínua; desenha só quando algo muda
  function estatico() {
    reduz = true; modo = 'estatico'; relogio = T.fim + 1; Object.assign(passou, { f0: 1, f1: 1, f2: 1, f3: 1, f4: 1, f5: 1, f6: 1 });
    Object.values(rotulos).forEach(r => { r.on = false; r.ate = 0; r.el.classList.remove('on'); });
    renderer.shadowMap.enabled = false; dpr = 1; renderer.setPixelRatio(1); cena.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    pausa(); redimensiona();
  }
  if (reduz) { modo = 'reduzido'; relogio = T.fim + 1; Object.assign(passou, { f0: 1, f1: 1, f2: 1, f3: 1, f4: 1, f5: 1, f6: 1 }); }
  else if (software) estatico();  // sem aceleração: nem tenta animar
  document.addEventListener('visibilitychange', aoVisibilidade);
  function aoVisibilidade() { if (document.hidden) pausa(); else if (!reduz) play(); else pedeQuadro(); }

  redimensiona();
  document.body.classList.add('cena-ok');
  if (reduz) pedeQuadro(); else play();

  function destruir() {
    pausa(); ro.disconnect(); document.removeEventListener('visibilitychange', aoVisibilidade); window.removeEventListener('pointermove', aoMover);
    descartaveis.forEach(x => x.dispose?.()); renderer.dispose();
  }
  window.addEventListener('pagehide', destruir, { once: true });

  // API usada pelo login.js (só apresentação: quem decide o acesso é o servidor)
  window.FUP_CENA = {
    autenticando(on) { autAlvo = on ? 1 : 0; pedeQuadro(true); },
    erro() { erroAte = relogio + 0.9; pedeQuadro(true); },
    sucesso() { saida = { t0: performance.now() }; acoes.roteador = relogio + 2; acoes.roteador_ini = relogio; if (reduz) return Promise.resolve(); return new Promise(ok => setTimeout(ok, 950)); },
    acao,
    info: () => ({ nivel, modo, gpu, software, dpr: renderer.getPixelRatio(), reduz, chamadas: renderer.info.render.calls, triangulos: renderer.info.render.triangles, geometrias: renderer.info.memory.geometries, texturas: renderer.info.memory.textures, particulas: N, relogio }),
    destruir,
  };
}
