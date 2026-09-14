import { useEffect, useRef } from "react";
import * as THREE from "three";
import { mesh } from "topojson-client";
import mundo from "world-atlas/countries-110m.json";
import type { Ligacao, Praca } from "@/lib/pracas-do-globo";

/**
 * O planeta do MMM: gira conforme a rolagem e mostra as praças onde a rede faz
 * negócio, ligadas por rotas acesas.
 *
 * Por que 3D e não uma sequência de imagens: a rotação é contínua e pesa uma
 * geometria só, em vez de 60 a 120 quadros (3 a 5 MB). E o globo carrega
 * DADOS: as praças vêm do servidor, agregadas por país. Uma imagem seria
 * enfeite; isto é informação.
 *
 * As fronteiras vêm do Natural Earth (world-atlas, domínio público).
 *
 * `animar` é a chave de movimento: desligada, o planeta é desenhado UMA vez e
 * o laço de animação nem começa. É o que salva aparelho fraco — e é também o
 * caminho de quem pediu menos movimento no sistema.
 */

const RAIO = 1;
// Ouro rosé do selo WMMW (#C98F70), a mesma paleta do aplicativo.
const OURO = new THREE.Color(0xc98f70);

// Onde o MMM faz negócio, agora de verdade: as praças chegam por props, do
// agregado por país das usuárias reais (stats.presencaPorPais, montado por
// montarPracasDoGlobo) — nunca por pessoa. Sem dado, sem praça: o planeta
// continua inteiro (continentes, atmosfera, rotação). Os padrões são
// constantes de módulo de propósito: um [] inline nas props teria identidade
// nova a cada render da Home e, como estão nas deps do useEffect, derrubaria
// e reconstruiria a cena inteira sem necessidade.
const SEM_PRACAS: Praca[] = [];
const SEM_LIGACOES: Ligacao[] = [];

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
    vec3 base = mix(vec3(0.050, 0.045, 0.040), vec3(0.129, 0.118, 0.106), frente);
    float borda = pow(1.0 - frente, 3.5);
    gl_FragColor = vec4(base + borda * vec3(0.79, 0.56, 0.44) * 0.55, 1.0);
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
    gl_FragColor = vec4(0.79, 0.56, 0.44, 1.0) * min(intensidade, 1.0) * 0.26;
  }
`;

type Props = {
  progresso: () => number;
  /** Falso = um quadro só, sem laço de animação. Para aparelho fraco. */
  animar?: boolean;
  /** Agregado por país (montarPracasDoGlobo) — nunca dado de uma pessoa. */
  pracas?: Praca[];
  /** Pares de índices em `pracas`; índice inválido é ignorado. */
  ligacoes?: Ligacao[];
};

export default function GloboDoMundo({ progresso, animar = true, pracas = SEM_PRACAS, ligacoes = SEM_LIGACOES }: Props) {
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
        registrar(new THREE.LineBasicMaterial({ color: 0x4a3f36, transparent: true, opacity: 0.16 })),
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
    const materialDaPraca = registrar(new THREE.MeshBasicMaterial({ color: 0xefcba8 }));
    const geometriaDoHalo = registrar(new THREE.SphereGeometry(0.032, 12, 12));
    const materialDoHalo = registrar(
      new THREE.MeshBasicMaterial({ color: OURO, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    for (const praca of pracas) {
      const p = paraEsfera(praca.lat, praca.lon, RAIO * 1.008);
      const nucleo = new THREE.Mesh(geometriaDaPraca, materialDaPraca);
      nucleo.position.copy(p);
      grupo.add(nucleo);
      const halo = new THREE.Mesh(geometriaDoHalo, materialDoHalo);
      halo.position.copy(p);
      grupo.add(halo);
    }

    // ── Rotas e os pulsos que viajam nelas ────────────────────────────────
    // A praça 0 é o hub (Brasil/DF, ver montarPracasDoGlobo): rota que o toca
    // é PRINCIPAL — linha mais acesa e pulso dobrado. As demais formam a malha
    // entre as outras praças, mais discretas para não virar novelo.
    const materialDaRotaPrincipal = registrar(
      new THREE.LineBasicMaterial({ color: 0xefcba8, transparent: true, opacity: 0.9 }),
    );
    const materialDaRota = registrar(
      new THREE.LineBasicMaterial({ color: 0xe3b18e, transparent: true, opacity: 0.4 }),
    );
    const geometriaDoPulso = registrar(new THREE.SphereGeometry(0.018, 10, 10));
    const materialDoPulso = registrar(new THREE.MeshBasicMaterial({ color: 0xf6e4d6 }));
    const pulsos: Array<{ curva: THREE.QuadraticBezierCurve3; malha: THREE.Mesh; atraso: number }> = [];

    // Índice fora da lista (dado vindo de fora) não pode derrubar a cena:
    // rota inválida é descartada, o resto do planeta segue.
    const rotas = ligacoes.filter(([de, para]) => de !== para && pracas[de] && pracas[para]);
    rotas.forEach(([de, para], i) => {
      const principal = de === 0 || para === 0;
      const curva = curvaEntre(
        paraEsfera(pracas[de].lat, pracas[de].lon, RAIO * 1.006),
        paraEsfera(pracas[para].lat, pracas[para].lon, RAIO * 1.006),
      );
      const g = registrar(new THREE.BufferGeometry().setFromPoints(curva.getPoints(64)));
      grupo.add(new THREE.Line(g, principal ? materialDaRotaPrincipal : materialDaRota));

      const malha = new THREE.Mesh(geometriaDoPulso, materialDoPulso);
      malha.position.copy(curva.getPoint(0));
      grupo.add(malha);
      // Atraso próprio por rota: sem ele todos os pulsos partem juntos e o
      // planeta pisca em bloco, como um letreiro.
      pulsos.push({ curva, malha, atraso: i / rotas.length });
      if (principal) {
        // Segundo pulso em contrafase: a rota da sede pulsa em dobro.
        const eco = new THREE.Mesh(geometriaDoPulso, materialDoPulso);
        eco.position.copy(curva.getPoint(0));
        grupo.add(eco);
        pulsos.push({ curva, malha: eco, atraso: i / rotas.length + 0.5 });
      }
    });

    // Inclinação do eixo, para não parecer um mapa girando num pino.
    grupo.rotation.z = -0.28;

    // A viagem: começa no Brasil e termina sobre o Golfo, cruzando a África.
    const ANGULO_INICIAL = anguloParaLongitude(-50);
    const GIRO_TOTAL = anguloParaLongitude(60) - ANGULO_INICIAL;

    let precisaDesenhar = true;
    // No modo estático, redesenha assim que o tamanho muda (definido abaixo).
    let redesenharParado: (() => void) | null = null;
    const dimensionar = () => {
      const { clientWidth: l, clientHeight: a } = alvo;
      if (!l || !a) return;
      // updateStyle fica ligado de propósito: com devicePixelRatio > 1 (todo
      // celular, notebook retina) o three.js grava canvas.width = l*dpr e, sem
      // style.width, o canvas ocupava l*dpr px CSS: planeta em dobro do tamanho,
      // deslocado para o canto. Com o estilo, o canvas mede l×a px e desenha em
      // alta densidade por dentro.
      renderizador.setSize(l, a);
      camera.aspect = l / a;
      // Em tela larga o planeta sai do centro e vai para a direita, liberando a
      // coluna do texto. No celular volta ao meio, senão metade sai do quadro.
      grupo.position.x = l / a > 1.2 ? 0.55 : 0;
      // Celular em pé: o campo de visão VERTICAL é fixo (38°), então quanto
      // mais estreita a tela, menor o campo horizontal — e a esfera, calibrada
      // para tela larga com a câmera a 4.2, estourava as laterais e o globo
      // aparecia cortado. A câmera recua até o planeta inteiro (atmosfera a
      // 1.22 × RAIO, mais folga) caber na LARGURA. Em tela larga a conta dá
      // menos que 4.2 e o enquadramento de sempre não muda. A esfera cabe no
      // campo quando o seno da meia-abertura cobre o raio: d = r / sen(θ).
      const meiaAltura = (camera.fov / 2) * (Math.PI / 180);
      const meiaLargura = Math.atan(Math.tan(meiaAltura) * camera.aspect);
      camera.position.z = Math.max(4.2, (RAIO * 1.29) / Math.sin(Math.min(meiaAltura, meiaLargura)));
      camera.updateProjectionMatrix();
      // A rolagem não mudou, mas o quadro anterior ficou do tamanho errado.
      precisaDesenhar = true;
      redesenharParado?.();
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
      // Redesenha só quando o contêiner muda de tamanho — custo praticamente
      // nulo. Fica atrelado ao ResizeObserver (dentro de dimensionar), depois do
      // setSize: o evento resize da janela disparava ANTES do observer, o quadro
      // saía com o tamanho velho e o setSize seguinte limpava o canvas, deixando
      // o planeta em branco ao girar o celular ou recolher a barra de endereço.
      redesenharParado = () => {
        if (!precisaDesenhar) return;
        precisaDesenhar = false;
        posicionar(progresso());
        renderizador.render(cena, camera);
      };
      // A rolagem continua girando o planeta mesmo sem o laço de animação: é
      // ela que dá sentido ao globo, e a heurística de aparelho fraco desligava
      // as duas coisas juntas — quem caía nela rolava a página e via um planeta
      // parado, como se estivesse quebrado. Um quadro por rolagem, via rAF; os
      // pulsos continuam imóveis. Quem pediu menos movimento no SISTEMA segue
      // parado de verdade: o hook pina o progresso em 1 e o quadro redesenhado
      // é idêntico ao anterior. O rAF daqui roda depois do rAF de medição do
      // hook (listener registrado antes, na montagem da Home), então o valor
      // lido já é o da rolagem atual.
      let quadroDeRolagem = 0;
      const aoRolar = () => {
        if (quadroDeRolagem) return;
        quadroDeRolagem = requestAnimationFrame(() => {
          quadroDeRolagem = 0;
          posicionar(progresso());
          renderizador.render(cena, camera);
        });
      };
      window.addEventListener("scroll", aoRolar, { passive: true });
      return () => {
        window.removeEventListener("scroll", aoRolar);
        if (quadroDeRolagem) cancelAnimationFrame(quadroDeRolagem);
        redesenharParado = null;
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
  }, [progresso, animar, pracas, ligacoes]);

  return <div ref={hospedeiro} className="w-full h-full" aria-hidden="true" />;
}
