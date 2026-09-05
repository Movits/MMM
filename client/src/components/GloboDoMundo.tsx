import { useEffect, useRef } from "react";
import * as THREE from "three";
import { mesh } from "topojson-client";
import mundo from "world-atlas/countries-110m.json";

/**
 * O planeta do MMM: gira conforme a rolagem e mostra as praças onde a rede faz
 * negócio, ligadas por rotas acesas.
 *
 * Por que 3D e não uma sequência de imagens: a rotação é contínua e pesa uma
 * geometria só, em vez de 60 a 120 quadros (3 a 5 MB). E o globo pode carregar
 * DADOS — hoje as praças são uma lista fixa, mas o mesmo desenho aceita o que
 * vier do servidor, agregado por país. Uma imagem seria enfeite; isto vira
 * informação.
 *
 * As fronteiras vêm do Natural Earth (world-atlas, domínio público).
 *
 * `animar` é a chave de movimento: desligada, o planeta é desenhado UMA vez e
 * o laço de animação nem começa. É o que salva aparelho fraco — e é também o
 * caminho de quem pediu menos movimento no sistema.
 */

const RAIO = 1;
const OURO = new THREE.Color(0xf5a623);

// Onde o MMM faz negócio. Lista fixa por enquanto: quando houver endpoint
// público agregado POR PAÍS (nunca por pessoa), estes pontos saem de lá.
const PRACAS = [
  { nome: "São Paulo", lat: -23.55, lon: -46.63 },
  { nome: "Lagos", lat: 6.52, lon: 3.38 },
  { nome: "Lisboa", lat: 38.72, lon: -9.14 },
  { nome: "Frankfurt", lat: 50.11, lon: 8.68 },
  { nome: "Dubai", lat: 25.2, lon: 55.27 },
  { nome: "Joanesburgo", lat: -26.2, lon: 28.05 },
];

const LIGACOES: Array<[number, number]> = [
  [0, 1],
  [0, 2],
  [1, 4],
  [2, 3],
  [1, 5],
  [3, 4],
];

function paraEsfera(lat: number, lon: number, raio = RAIO): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -raio * Math.sin(phi) * Math.cos(theta),
    raio * Math.cos(phi),
    raio * Math.sin(phi) * Math.sin(theta),
  );
}

/**
 * Qual longitude encara a câmera. Sai da geometria acima: um ponto do equador
 * fica em (-cos θ, 0, sen θ) com θ = lon + 180; girando o grupo em A, o z é
 * máximo quando θ + A = 90°. Logo, longitude de frente = -90° - A.
 *
 * Ter a fórmula em vez de tentativa e erro importa: o primeiro palpite punha a
 * Indonésia no centro quando eu queria o Brasil.
 */
export function anguloParaLongitude(longitude: number): number {
  return (-90 - longitude) * (Math.PI / 180);
}

/** Arco que sai da superfície, sobe e volta — a rota entre duas praças. */
function curvaEntre(a: THREE.Vector3, b: THREE.Vector3): THREE.QuadraticBezierCurve3 {
  const altura = 1 + a.distanceTo(b) * 0.32;
  const meio = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(RAIO * altura);
  return new THREE.QuadraticBezierCurve3(a, meio, b);
}

const VERTEX_NORMAL = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Oceano: quase preto no centro, acendendo numa borda dourada. É esse degradê
// que faz a esfera parecer um corpo com volume, e não um disco.
const FRAG_OCEANO = `
  varying vec3 vNormal;
  void main() {
    float frente = max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0);
    vec3 base = mix(vec3(0.016, 0.035, 0.070), vec3(0.043, 0.086, 0.153), frente);
    float borda = pow(1.0 - frente, 3.5);
    gl_FragColor = vec4(base + borda * vec3(0.96, 0.65, 0.14) * 0.55, 1.0);
  }
`;

// Atmosfera: casca maior desenhada pelo lado de dentro (BackSide) e somada à
// cena. Como só vemos o anel entre o raio do planeta e o da casca, o produto
// escalar ali vai de cerca de -0,6 (colado no planeta) a 0 (borda externa) — e
// a curva abaixo é decrescente nesse intervalo, que é o que faz o halo nascer
// grudado no planeta e apagar para fora.
//
// A primeira versão usava expoente 3 sobre 0,62 e multiplicador 0,9: passava
// de 1 em quase todo o anel, virando uma mancha laranja que engolia o texto.
const FRAG_ATMOSFERA = `
  varying vec3 vNormal;
  void main() {
    float intensidade = pow(max(0.55 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 4.0);
    gl_FragColor = vec4(0.96, 0.65, 0.14, 1.0) * min(intensidade, 1.0) * 0.26;
  }
`;

type Props = {
  progresso: () => number;
  /** Falso = um quadro só, sem laço de animação. Para aparelho fraco. */
  animar?: boolean;
};

export default function GloboDoMundo({ progresso, animar = true }: Props) {
  const hospedeiro = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const alvo = hospedeiro.current;
    if (!alvo) return;

    // Sem WebGL não há tela preta: o componente não desenha e o fundo da página
    // (a imagem bordada) continua valendo sozinho.
    const teste = document.createElement("canvas");
    if (!teste.getContext("webgl2") && !teste.getContext("webgl")) return;

    const cena = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.z = 4.2;

    const renderizador = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderizador.setClearColor(0x000000, 0);
    // Teto no devicePixelRatio: em tela 3x o custo por quadro triplica sem ganho
    // visível numa linha de um pixel.
    renderizador.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    alvo.appendChild(renderizador.domElement);

    const descartaveis: Array<{ dispose: () => void }> = [];
    const registrar = <T extends { dispose: () => void }>(x: T) => {
      descartaveis.push(x);
      return x;
    };

    const grupo = new THREE.Group();
    cena.add(grupo);

    // ── Estrelas ──────────────────────────────────────────────────────────
    // Ficam FORA do grupo que gira: o céu não acompanha a rotação do planeta.
    const posicoesDasEstrelas = new Float32Array(700 * 3);
    for (let i = 0; i < 700; i++) {
      // Distribuição uniforme na esfera: sortear z e o ângulo, não dois
      // ângulos — senão as estrelas se acumulam nos polos.
      const z = Math.random() * 2 - 1;
      const ang = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      const d = 14 + Math.random() * 10;
      posicoesDasEstrelas.set([r * Math.cos(ang) * d, r * Math.sin(ang) * d, z * d], i * 3);
    }
    const geometriaDasEstrelas = registrar(new THREE.BufferGeometry());
    geometriaDasEstrelas.setAttribute("position", new THREE.BufferAttribute(posicoesDasEstrelas, 3));
    cena.add(
      new THREE.Points(
        geometriaDasEstrelas,
        registrar(new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, transparent: true, opacity: 0.5 })),
      ),
    );

    // ── Oceano e atmosfera ────────────────────────────────────────────────
    grupo.add(
      new THREE.Mesh(
        registrar(new THREE.SphereGeometry(RAIO * 0.995, 64, 64)),
        registrar(new THREE.ShaderMaterial({ vertexShader: VERTEX_NORMAL, fragmentShader: FRAG_OCEANO })),
      ),
    );
    // No GRUPO, não na cena: o planeta se desloca para a direita em tela larga,
    // e uma atmosfera presa à origem ficaria pendurada ao lado dele.
    grupo.add(
      new THREE.Mesh(
        registrar(new THREE.SphereGeometry(RAIO * 1.22, 48, 48)),
        registrar(
          new THREE.ShaderMaterial({
            vertexShader: VERTEX_NORMAL,
            fragmentShader: FRAG_ATMOSFERA,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
          }),
        ),
      ),
    );

    // ── Meridianos e paralelos ────────────────────────────────────────────
    // Baratos e decisivos: são eles que dizem ao olho "isto é um globo".
    const gradeVertices: number[] = [];
    const ponto = (lat: number, lon: number) => paraEsfera(lat, lon, RAIO * 1.0005);
    for (let lon = -180; lon < 180; lon += 20) {
      for (let lat = -90; lat < 90; lat += 4) {
        gradeVertices.push(...ponto(lat, lon).toArray(), ...ponto(lat + 4, lon).toArray());
      }
    }
    for (let lat = -60; lat <= 60; lat += 20) {
      for (let lon = -180; lon < 180; lon += 4) {
        gradeVertices.push(...ponto(lat, lon).toArray(), ...ponto(lat, lon + 4).toArray());
      }
    }
    const geometriaDaGrade = registrar(new THREE.BufferGeometry());
    geometriaDaGrade.setAttribute("position", new THREE.Float32BufferAttribute(gradeVertices, 3));
    grupo.add(
      new THREE.LineSegments(
        geometriaDaGrade,
        registrar(new THREE.LineBasicMaterial({ color: 0x2b4a6b, transparent: true, opacity: 0.16 })),
      ),
    );

    // ── Litoral e divisas ─────────────────────────────────────────────────
    //
    // O `mesh` do topojson aceita um filtro que compara as DUAS faces vizinhas
    // de cada traço, e é ele que separa as duas coisas:
    //
    //   (a, b) => a === b   →  o traço só tem um país de um lado: é LITORAL
    //   (a, b) => a !== b   →  há país dos dois lados: é DIVISA INTERNA
    //
    // A versão anterior desenhava `mesh` inteiro E, por cima, o polígono de
    // cada país. Como vizinhos compartilham a mesma divisa, cada linha interna
    // era traçada três vezes — daí o emaranhado dentro dos continentes e o
    // brilho sujo do acúmulo. Agora cada traço existe uma vez só, e o litoral
    // fica mais forte que as divisas, que é o que faz o continente ter forma.
    const topologia = mundo as any;
    const paises = topologia.objects.countries;

    const construir = (linhas: number[][][], raio: number) => {
      const vertices: number[] = [];
      for (const linha of linhas) {
        for (let i = 0; i < linha.length - 1; i++) {
          vertices.push(
            ...paraEsfera(linha[i][1], linha[i][0], raio).toArray(),
            ...paraEsfera(linha[i + 1][1], linha[i + 1][0], raio).toArray(),
          );
        }
      }
      const g = registrar(new THREE.BufferGeometry());
      g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      return g;
    };

    const litoral = mesh(topologia, paises, (a: any, b: any) => a === b) as any;
    const internas = mesh(topologia, paises, (a: any, b: any) => a !== b) as any;

    grupo.add(
      new THREE.LineSegments(
        construir(litoral.coordinates, RAIO * 1.0015),
        registrar(new THREE.LineBasicMaterial({ color: OURO, transparent: true, opacity: 0.85 })),
      ),
    );
    grupo.add(
      new THREE.LineSegments(
        construir(internas.coordinates, RAIO * 1.001),
        registrar(new THREE.LineBasicMaterial({ color: OURO, transparent: true, opacity: 0.22 })),
      ),
    );

    // ── Praças ────────────────────────────────────────────────────────────
    const geometriaDaPraca = registrar(new THREE.SphereGeometry(0.014, 12, 12));
    const materialDaPraca = registrar(new THREE.MeshBasicMaterial({ color: 0xffe6b0 }));
    const geometriaDoHalo = registrar(new THREE.SphereGeometry(0.032, 12, 12));
    const materialDoHalo = registrar(
      new THREE.MeshBasicMaterial({ color: OURO, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    for (const praca of PRACAS) {
      const p = paraEsfera(praca.lat, praca.lon, RAIO * 1.008);
      const nucleo = new THREE.Mesh(geometriaDaPraca, materialDaPraca);
      nucleo.position.copy(p);
      grupo.add(nucleo);
      const halo = new THREE.Mesh(geometriaDoHalo, materialDoHalo);
      halo.position.copy(p);
      grupo.add(halo);
    }

    // ── Rotas e os pulsos que viajam nelas ────────────────────────────────
    const materialDaRota = registrar(
      new THREE.LineBasicMaterial({ color: 0xffd489, transparent: true, opacity: 0.7 }),
    );
    const geometriaDoPulso = registrar(new THREE.SphereGeometry(0.018, 10, 10));
    const materialDoPulso = registrar(new THREE.MeshBasicMaterial({ color: 0xfff3d6 }));
    const pulsos: Array<{ curva: THREE.QuadraticBezierCurve3; malha: THREE.Mesh; atraso: number }> = [];

    LIGACOES.forEach(([de, para], i) => {
      const curva = curvaEntre(
        paraEsfera(PRACAS[de].lat, PRACAS[de].lon, RAIO * 1.006),
        paraEsfera(PRACAS[para].lat, PRACAS[para].lon, RAIO * 1.006),
      );
      const g = registrar(new THREE.BufferGeometry().setFromPoints(curva.getPoints(64)));
      grupo.add(new THREE.Line(g, materialDaRota));

      const malha = new THREE.Mesh(geometriaDoPulso, materialDoPulso);
      malha.position.copy(curva.getPoint(0));
      grupo.add(malha);
      // Atraso próprio por rota: sem ele todos os pulsos partem juntos e o
      // planeta pisca em bloco, como um letreiro.
      pulsos.push({ curva, malha, atraso: i / LIGACOES.length });
    });

    // Inclinação do eixo, para não parecer um mapa girando num pino.
    grupo.rotation.z = -0.28;

    // A viagem: começa no Brasil e termina sobre o Golfo, cruzando a África.
    const ANGULO_INICIAL = anguloParaLongitude(-50);
    const GIRO_TOTAL = anguloParaLongitude(60) - ANGULO_INICIAL;

    let precisaDesenhar = true;
    const dimensionar = () => {
      const { clientWidth: l, clientHeight: a } = alvo;
      if (!l || !a) return;
      renderizador.setSize(l, a, false);
      camera.aspect = l / a;
      // Em tela larga o planeta sai do centro e vai para a direita, liberando a
      // coluna do texto. No celular volta ao meio, senão metade sai do quadro.
      grupo.position.x = l / a > 1.2 ? 0.55 : 0;
      camera.updateProjectionMatrix();
      // A rolagem não mudou, mas o quadro anterior ficou do tamanho errado.
      precisaDesenhar = true;
    };
    dimensionar();
    const observador = new ResizeObserver(dimensionar);
    observador.observe(alvo);

    const posicionar = (p: number) => {
      grupo.rotation.y = ANGULO_INICIAL + p * GIRO_TOTAL;
    };

    let animacao = 0;
    if (animar) {
      const inicio = performance.now();
      let ultimoProgresso = Number.NaN;
      const laco = () => {
        const p = progresso();
        const t = (performance.now() - inicio) / 4200;
        for (const pulso of pulsos) {
          const fase = (t + pulso.atraso) % 1;
          pulso.malha.position.copy(pulso.curva.getPoint(fase));
        }
        if (p !== ultimoProgresso) {
          ultimoProgresso = p;
          posicionar(p);
        }
        renderizador.render(cena, camera);
        animacao = requestAnimationFrame(laco);
      };
      laco();
    } else {
      // Movimento desligado: um quadro e pronto. Os pulsos ficam parados na
      // origem de cada rota e o planeta na posição de abertura.
      posicionar(progresso());
      renderizador.render(cena, camera);
      // Redesenha só se a janela mudar de tamanho — custo praticamente nulo.
      const aoRedimensionar = () => {
        if (!precisaDesenhar) return;
        precisaDesenhar = false;
        posicionar(progresso());
        renderizador.render(cena, camera);
      };
      window.addEventListener("resize", aoRedimensionar, { passive: true });
      return () => {
        window.removeEventListener("resize", aoRedimensionar);
        observador.disconnect();
        for (const d of descartaveis) d.dispose();
        renderizador.dispose();
        if (renderizador.domElement.parentNode === alvo) alvo.removeChild(renderizador.domElement);
      };
    }

    return () => {
      if (animacao) cancelAnimationFrame(animacao);
      observador.disconnect();
      for (const d of descartaveis) d.dispose();
      renderizador.dispose();
      if (renderizador.domElement.parentNode === alvo) alvo.removeChild(renderizador.domElement);
    };
  }, [progresso, animar]);

  return <div ref={hospedeiro} className="w-full h-full" aria-hidden="true" />;
}
