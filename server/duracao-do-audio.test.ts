import { describe, expect, it } from "vitest";
import { medirDuracaoDoAudio } from "./duracao-do-audio";

/**
 * A duração que vale para o limite de 10 minutos e para o contador de minutos
 * é a MEDIDA nos bytes. Os contêineres aqui são montados byte a byte, no
 * formato que cada decodificador lê — sem arquivo binário no repositório. (A
 * medição também foi conferida contra o ffprobe em arquivos gerados pelo
 * ffmpeg: WAV, MP3 CBR/VBR/ID3, MP2, AAC ADTS, M4A, MP4 fragmentado e com
 * vídeo, MOV, Ogg Opus/Vorbis, WebM Opus/Vorbis, com e sem tamanho conhecido.)
 */

const u16be = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32be = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u16le = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

// ─── WAV ─────────────────────────────────────────────────────────────────────
function wav(opcoes: { formato?: number; taxa: number; canais: number; bits: number; bytesDeDados: number; bytesPorSegundoDeclarado?: number; tamanhoDeclarado?: number }) {
  const alinhamento = (opcoes.canais * opcoes.bits) / 8;
  const fmt = Buffer.concat([
    u16le(opcoes.formato ?? 1), u16le(opcoes.canais), u32le(opcoes.taxa),
    u32le(opcoes.bytesPorSegundoDeclarado ?? opcoes.taxa * alinhamento), u16le(alinhamento), u16le(opcoes.bits),
  ]);
  const dados = Buffer.alloc(opcoes.bytesDeDados);
  return Buffer.concat([
    Buffer.from("RIFF"), u32le(36 + dados.length), Buffer.from("WAVE"),
    Buffer.from("fmt "), u32le(fmt.length), fmt,
    Buffer.from("LIST"), u32le(4), Buffer.from("INFO"),
    Buffer.from("data"), u32le(opcoes.tamanhoDeclarado ?? dados.length), dados,
  ]);
}

// ─── MP3 e ADTS ──────────────────────────────────────────────────────────────
/** Quadro MPEG-1 Layer III, 128 kbps, 44,1 kHz, sem enchimento: 417 bytes e 1152 amostras. */
const quadroMp3 = () => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)]);
const SEGUNDOS_POR_QUADRO_MP3 = 1152 / 44100;

function quadroAdts(tamanho = 100) {
  const cabecalho = Buffer.from([
    0xff, 0xf1,
    (1 << 6) | (4 << 2), // perfil LC, 44,1 kHz
    (2 << 6) | ((tamanho >> 11) & 3), // 2 canais
    (tamanho >> 3) & 0xff,
    ((tamanho & 7) << 5) | 0x1f,
    0xfc, // um bloco de dados por quadro
  ]);
  return Buffer.concat([cabecalho, Buffer.alloc(tamanho - 7)]);
}

function id3v2(tamanho: number) {
  const s = [(tamanho >> 21) & 0x7f, (tamanho >> 14) & 0x7f, (tamanho >> 7) & 0x7f, tamanho & 0x7f];
  return Buffer.concat([Buffer.from("ID3"), Buffer.from([3, 0, 0, ...s]), Buffer.alloc(tamanho, 0xff)]);
}

// ─── Ogg ─────────────────────────────────────────────────────────────────────
function paginaOgg(opcoes: { segmentos: number[]; dados: Buffer; granulo: number; continua?: boolean; serial?: number }) {
  // -1: página em que nenhum pacote termina.
  const granulo = Buffer.alloc(8, opcoes.granulo < 0 ? 0xff : 0);
  if (opcoes.granulo >= 0) {
    granulo.writeUInt32LE(opcoes.granulo >>> 0, 0);
    granulo.writeUInt32LE(Math.floor(opcoes.granulo / 4294967296), 4);
  }
  return Buffer.concat([
    Buffer.from("OggS"), Buffer.from([0, opcoes.continua ? 1 : 0]), granulo,
    u32le(opcoes.serial ?? 7), u32le(0), u32le(0), Buffer.from([opcoes.segmentos.length]), Buffer.from(opcoes.segmentos), opcoes.dados,
  ]);
}
const lacosDe = (tamanho: number) => { const l: number[] = []; let resto = tamanho; while (resto >= 255) { l.push(255); resto -= 255; } l.push(resto); return l; };
/** Uma página por pacote, simples. */
const paginaDoPacote = (pacote: Buffer, granulo = 0) => paginaOgg({ segmentos: lacosDe(pacote.length), dados: pacote, granulo });

const OPUS_HEAD = Buffer.concat([Buffer.from("OpusHead"), Buffer.from([1, 1]), u16le(312), u32le(48000), u16le(0), Buffer.from([0])]);
const OPUS_TAGS = Buffer.concat([Buffer.from("OpusTags"), u32le(0), u32le(0)]);
/** CELT, 20 ms, um quadro: 960 amostras. */
const pacoteOpus20ms = () => Buffer.from([31 << 3, 1, 2, 3, 4]);

// ─── EBML (WebM) ─────────────────────────────────────────────────────────────
const ebml = (id: number[], corpo: Buffer) => {
  if (corpo.length > 126) throw new Error("tamanho de 1 byte só até 126 no teste");
  return Buffer.concat([Buffer.from(id), Buffer.from([0x80 | corpo.length]), corpo]);
};
const TAMANHO_DESCONHECIDO = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
const trackEntry = (numero: number, tipo: number, codec: string) =>
  ebml([0xae], Buffer.concat([ebml([0xd7], Buffer.from([numero])), ebml([0x83], Buffer.from([tipo])), ebml([0x86], Buffer.from(codec))]));
const simpleBlock = (faixa: number, relativoMs: number, quadro: Buffer, flags = 0x80) =>
  ebml([0xa3], Buffer.concat([Buffer.from([0x80 | faixa]), u16be(relativoMs), Buffer.from([flags]), quadro]));

function webm(faixas: Buffer[], blocos: Buffer[]) {
  return Buffer.concat([
    ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], Buffer.from("webm"))),
    // Segment e Cluster com tamanho desconhecido: o que o MediaRecorder do Chrome grava.
    Buffer.from([0x18, 0x53, 0x80, 0x67]), TAMANHO_DESCONHECIDO,
    ebml([0x15, 0x49, 0xa9, 0x66], ebml([0x2a, 0xd7, 0xb1], Buffer.from([0x0f, 0x42, 0x40]))),
    ebml([0x16, 0x54, 0xae, 0x6b], Buffer.concat(faixas)),
    Buffer.from([0x1f, 0x43, 0xb6, 0x75]), TAMANHO_DESCONHECIDO,
    ebml([0xe7], Buffer.from([0])),
    ...blocos,
  ]);
}

// ─── MP4 ─────────────────────────────────────────────────────────────────────
const caixa = (tipo: string, ...corpo: Buffer[]) => { const c = Buffer.concat(corpo); return Buffer.concat([u32be(8 + c.length), Buffer.from(tipo), c]); };
const caixaCheia = (tipo: string, flags: number, ...corpo: Buffer[]) => caixa(tipo, u32be(flags & 0xffffff), ...corpo);
const descritor = (tag: number, corpo: Buffer) => Buffer.concat([Buffer.from([tag, corpo.length]), corpo]);

/** Bits em sequência, para montar o AudioSpecificConfig. */
function bits(campos: Array<[number, number]>) {
  let texto = "";
  for (const [valor, largura] of campos) texto += valor.toString(2).padStart(largura, "0");
  texto = texto.padEnd(Math.ceil(texto.length / 8) * 8, "0");
  return Buffer.from(texto.match(/.{8}/g)!.map(byte => parseInt(byte, 2)));
}
const ASC_AAC_LC_44100 = bits([[2, 5], [4, 4], [2, 4], [0, 1], [0, 1], [0, 1]]);
// HE-AAC explícito: núcleo AAC a 24 kHz, saída a 48 kHz. Os quadros são do núcleo.
const ASC_HE_AAC_24000 = bits([[5, 5], [6, 4], [2, 4], [3, 4], [2, 5], [0, 1], [0, 1], [0, 1]]);

function entradaMp4a(asc: Buffer) {
  const esds = caixaCheia("esds", 0, descritor(3, Buffer.concat([
    u16be(1), Buffer.from([0]),
    descritor(4, Buffer.concat([Buffer.from([0x40, 0x15]), Buffer.alloc(3), u32be(0), u32be(0), descritor(5, asc)])),
    descritor(6, Buffer.from([2])),
  ])));
  return caixa("mp4a", Buffer.alloc(6), u16be(1), u16be(0), u16be(0), u32be(0), u16be(2), u16be(16), u16be(0), u16be(0), u32be(44100 * 65536), esds);
}

function trak(opcoes: { id: number; manipulador: string; escala: number; entrada: Buffer; amostras: number; delta: number }) {
  const tkhd = caixaCheia("tkhd", 0, u32be(0), u32be(0), u32be(opcoes.id), Buffer.alloc(68));
  const mdhd = caixaCheia("mdhd", 0, u32be(0), u32be(0), u32be(opcoes.escala), u32be(0), Buffer.alloc(4));
  const hdlr = caixaCheia("hdlr", 0, u32be(0), Buffer.from(opcoes.manipulador), Buffer.alloc(13));
  const stsd = caixaCheia("stsd", 0, u32be(1), opcoes.entrada);
  const stts = opcoes.amostras ? caixaCheia("stts", 0, u32be(1), u32be(opcoes.amostras), u32be(opcoes.delta)) : caixaCheia("stts", 0, u32be(0));
  const stsz = caixaCheia("stsz", 0, u32be(0), u32be(opcoes.amostras), Buffer.alloc(4 * opcoes.amostras));
  return caixa("trak", tkhd, caixa("mdia", mdhd, hdlr, caixa("minf", caixa("stbl", stsd, stts, stsz))));
}
const ftyp = () => caixa("ftyp", Buffer.from("M4A "), u32be(0), Buffer.from("isomM4A "));

describe("medirDuracaoDoAudio — WAV", () => {
  it("PCM: bytes de dados ÷ (taxa × alinhamento), pulando pedaços que não são áudio", () => {
    expect(medirDuracaoDoAudio(wav({ taxa: 8000, canais: 1, bits: 16, bytesDeDados: 16000 * 3 }))).toBe(3);
  });

  it("bytes/segundo forjado no cabeçalho não encurta o PCM: o decodificador usa taxa × alinhamento", () => {
    expect(medirDuracaoDoAudio(wav({ taxa: 8000, canais: 1, bits: 16, bytesDeDados: 16000 * 3, bytesPorSegundoDeclarado: 10_000_000 }))).toBe(3);
  });

  it("tamanho do 'data' maior que o arquivo (gravação em fluxo): vale o que chegou", () => {
    expect(medirDuracaoDoAudio(wav({ taxa: 8000, canais: 1, bits: 8, bytesDeDados: 8000 * 2, tamanhoDeclarado: 0xffffffff }))).toBe(2);
  });

  it("formato comprimido dentro do WAV usa os bytes/segundo do cabeçalho", () => {
    expect(medirDuracaoDoAudio(wav({ formato: 0x11, taxa: 8000, canais: 1, bits: 4, bytesDeDados: 4055 * 4, bytesPorSegundoDeclarado: 4055 }))).toBe(4);
  });
});

describe("medirDuracaoDoAudio — MP3 e AAC em ADTS", () => {
  it("conta quadro a quadro, depois das etiquetas ID3v2", () => {
    const arquivo = Buffer.concat([id3v2(300), ...Array.from({ length: 200 }, quadroMp3)]);
    expect(medirDuracaoDoAudio(arquivo)).toBeCloseTo(200 * SEGUNDOS_POR_QUADRO_MP3, 6);
  });

  it("lixo no meio não interrompe a contagem: procura o próximo quadro, como o decodificador", () => {
    const arquivo = Buffer.concat([...Array.from({ length: 50 }, quadroMp3), Buffer.from("TAG lixo no meio"), ...Array.from({ length: 50 }, quadroMp3)]);
    expect(medirDuracaoDoAudio(arquivo)).toBeCloseTo(100 * SEGUNDOS_POR_QUADRO_MP3, 6);
  });

  it("ADTS: 1024 amostras por quadro na taxa do cabeçalho", () => {
    const arquivo = Buffer.concat(Array.from({ length: 431 }, () => quadroAdts()));
    expect(medirDuracaoDoAudio(arquivo)).toBeCloseTo((431 * 1024) / 44100, 6);
  });
});

describe("medirDuracaoDoAudio — Ogg", () => {
  const cabecalhos = [paginaDoPacote(OPUS_HEAD), paginaDoPacote(OPUS_TAGS)];

  it("Opus: soma as amostras do TOC de cada pacote", () => {
    const audio = Array.from({ length: 150 }, (_, i) => paginaDoPacote(pacoteOpus20ms(), (i + 1) * 960));
    expect(medirDuracaoDoAudio(Buffer.concat([...cabecalhos, ...audio]))).toBeCloseTo(3, 6);
  });

  it("grânulo forjado (zero) não encolhe o Opus: a medida vem dos pacotes, não do grânulo", () => {
    const audio = Array.from({ length: 150 }, () => paginaDoPacote(pacoteOpus20ms(), 0));
    expect(medirDuracaoDoAudio(Buffer.concat([...cabecalhos, ...audio]))).toBeCloseTo(3, 6);
  });

  it("pacote com vários quadros (código 3) e pacote que atravessa páginas", () => {
    const tresQuadros = Buffer.concat([Buffer.from([(31 << 3) | 3, 3]), Buffer.alloc(298)]); // 3 × 960
    const pagina1 = paginaOgg({ segmentos: [255], dados: tresQuadros.subarray(0, 255), granulo: -1 });
    const pagina2 = paginaOgg({ segmentos: [45], dados: tresQuadros.subarray(255), granulo: 2880, continua: true });
    expect(medirDuracaoDoAudio(Buffer.concat([...cabecalhos, pagina1, pagina2]))).toBeCloseTo(2880 / 48000, 6);
  });

  it("codec que não sabemos medir (FLAC em Ogg): null", () => {
    const flac = Buffer.concat([Buffer.from([0x7f]), Buffer.from("FLAC"), Buffer.alloc(40)]);
    expect(medirDuracaoDoAudio(paginaDoPacote(flac))).toBeNull();
  });
});

describe("medirDuracaoDoAudio — WebM", () => {
  it("Opus com Segment e Cluster de tamanho desconhecido (MediaRecorder do Chrome)", () => {
    const blocos = Array.from({ length: 250 }, (_, i) => simpleBlock(1, i * 20, pacoteOpus20ms()));
    expect(medirDuracaoDoAudio(webm([trackEntry(1, 2, "A_OPUS")], blocos))).toBeCloseTo(5, 6);
  });

  it("carimbo de tempo forjado não encolhe o Opus: todos os blocos no instante zero ainda contam", () => {
    const blocos = Array.from({ length: 250 }, () => simpleBlock(1, 0, pacoteOpus20ms()));
    expect(medirDuracaoDoAudio(webm([trackEntry(1, 2, "A_OPUS")], blocos))).toBeCloseTo(5, 6);
  });

  it("bloco com laçamento Xiph (três pacotes num bloco)", () => {
    const tresPacotes = Buffer.concat([Buffer.from([2, 5, 5]), pacoteOpus20ms(), pacoteOpus20ms(), pacoteOpus20ms()]);
    const blocos = Array.from({ length: 50 }, (_, i) => simpleBlock(1, i * 60, tresPacotes, 0x80 | 0x02));
    expect(medirDuracaoDoAudio(webm([trackEntry(1, 2, "A_OPUS")], blocos))).toBeCloseTo(3, 6);
  });

  it("faixa de vídeo não conta como áudio", () => {
    const blocos = [
      ...Array.from({ length: 50 }, (_, i) => simpleBlock(1, i * 20, pacoteOpus20ms())),
      ...Array.from({ length: 500 }, (_, i) => simpleBlock(2, i * 20, pacoteOpus20ms())),
    ];
    expect(medirDuracaoDoAudio(webm([trackEntry(1, 2, "A_OPUS"), trackEntry(2, 1, "V_VP8")], blocos))).toBeCloseTo(1, 6);
  });

  it("codec de áudio sem contagem de amostras (Vorbis) cai nos carimbos de tempo", () => {
    const blocos = Array.from({ length: 101 }, (_, i) => simpleBlock(1, i * 40, Buffer.from([0, 1, 2])));
    expect(medirDuracaoDoAudio(webm([trackEntry(1, 2, "A_VORBIS")], blocos))).toBeCloseTo(4, 6);
  });
});

describe("medirDuracaoDoAudio — MP4 / M4A", () => {
  it("AAC: nº de quadros da tabela × 1024 ÷ a taxa do AudioSpecificConfig", () => {
    const moov = caixa("moov", trak({ id: 1, manipulador: "soun", escala: 44100, entrada: entradaMp4a(ASC_AAC_LC_44100), amostras: 431, delta: 1024 }));
    expect(medirDuracaoDoAudio(Buffer.concat([ftyp(), moov, caixa("mdat", Buffer.alloc(10))]))).toBeCloseTo((431 * 1024) / 44100, 6);
  });

  it("stts forjado (delta 1) não encolhe o AAC: conta quadros, não carimbos", () => {
    const moov = caixa("moov", trak({ id: 1, manipulador: "soun", escala: 44100, entrada: entradaMp4a(ASC_AAC_LC_44100), amostras: 431, delta: 1 }));
    expect(medirDuracaoDoAudio(Buffer.concat([ftyp(), moov]))).toBeCloseTo((431 * 1024) / 44100, 6);
  });

  it("HE-AAC: os quadros são do núcleo AAC (24 kHz), não da saída com SBR", () => {
    const moov = caixa("moov", trak({ id: 1, manipulador: "soun", escala: 48000, entrada: entradaMp4a(ASC_HE_AAC_24000), amostras: 240, delta: 2048 }));
    expect(medirDuracaoDoAudio(Buffer.concat([ftyp(), moov]))).toBeCloseTo((240 * 1024) / 24000, 6);
  });

  it("fragmentado (o que o Safari grava): soma as amostras de cada trun", () => {
    const moov = caixa("moov",
      trak({ id: 1, manipulador: "soun", escala: 44100, entrada: entradaMp4a(ASC_AAC_LC_44100), amostras: 0, delta: 0 }),
      caixa("mvex", caixaCheia("trex", 0, u32be(1), u32be(1), u32be(1024), u32be(0), u32be(0))));
    const fragmento = (amostras: number) => caixa("moof", caixa("traf",
      caixaCheia("tfhd", 0, u32be(1)),
      caixaCheia("trun", 0x1, u32be(amostras), u32be(0))));
    const arquivo = Buffer.concat([ftyp(), moov, fragmento(200), caixa("mdat", Buffer.alloc(8)), fragmento(231), caixa("mdat", Buffer.alloc(8))]);
    expect(medirDuracaoDoAudio(arquivo)).toBeCloseTo((431 * 1024) / 44100, 6);
  });

  it("MP4 com vídeo: só a faixa de som conta", () => {
    const moov = caixa("moov",
      trak({ id: 1, manipulador: "vide", escala: 1000, entrada: caixa("avc1", Buffer.alloc(78)), amostras: 9000, delta: 1000 }),
      trak({ id: 2, manipulador: "soun", escala: 44100, entrada: entradaMp4a(ASC_AAC_LC_44100), amostras: 431, delta: 1024 }));
    expect(medirDuracaoDoAudio(Buffer.concat([ftyp(), moov]))).toBeCloseTo((431 * 1024) / 44100, 6);
  });

  it("MP4 forjado com dezenas de milhares de trak e de tfhd não trava o servidor: desiste em menos de 500 ms e devolve null", () => {
    // Pior caso do laço: cada trak mínimo (8 bytes) vira uma faixa e cada tfhd
    // procura a faixa pelo id. Era O(trak × tfhd): 1,28 MB levou 34 s síncronos
    // (item 9 da revisão do Nicolas na PR #135), e o envio aceita 10 MB.
    const traks = Buffer.concat(Array.from({ length: 30_000 }, () => caixa("trak")));
    const fragmentos = Array.from({ length: 30_000 }, () => caixa("moof", caixa("traf", caixaCheia("tfhd", 0, u32be(999)))));
    const forjado = Buffer.concat([ftyp(), caixa("moov", traks), ...fragmentos]);
    const inicio = performance.now();
    const medida = medirDuracaoDoAudio(forjado);
    const decorrido = performance.now() - inicio;
    expect(medida).toBeNull();
    expect(decorrido).toBeLessThan(500);
  }, 2000);

  it("gravação fragmentada de 10 min (2.400 fragmentos, como o Safari fatiando a cada 250 ms) continua medida; o tfhd acha a faixa de som pelo id", () => {
    const moov = caixa("moov",
      trak({ id: 1, manipulador: "vide", escala: 1000, entrada: caixa("avc1", Buffer.alloc(78)), amostras: 0, delta: 0 }),
      trak({ id: 2, manipulador: "soun", escala: 44100, entrada: entradaMp4a(ASC_AAC_LC_44100), amostras: 0, delta: 0 }),
      caixa("mvex", caixaCheia("trex", 0, u32be(2), u32be(1), u32be(1024), u32be(0), u32be(0))));
    // 250 ms a 44,1 kHz são ~10,77 quadros: alterna 10 e 11 para fechar 25.840 quadros em 2.400 fragmentos.
    const fragmento = (quadros: number) => Buffer.concat([
      caixa("moof", caixaCheia("mfhd", 0, u32be(1)), caixa("traf", caixaCheia("tfhd", 0, u32be(2)), caixaCheia("tfdt", 0, u32be(0)), caixaCheia("trun", 0x1, u32be(quadros), u32be(0)))),
      caixa("mdat", Buffer.alloc(8)),
    ]);
    const quadrosPorFragmento = Array.from({ length: 2400 }, (_, i) => (i % 13 < 10 ? 11 : 10));
    const quadros = quadrosPorFragmento.reduce((soma, n) => soma + n, 0);
    const arquivo = Buffer.concat([ftyp(), moov, ...quadrosPorFragmento.map(fragmento)]);
    expect(medirDuracaoDoAudio(arquivo)).toBeCloseTo((quadros * 1024) / 44100, 6);
  });

  it("mais de 200 mil caixas no arquivo: a medição desiste (null), mesmo com uma faixa de som legítima", () => {
    const moov = caixa("moov", trak({ id: 1, manipulador: "soun", escala: 44100, entrada: entradaMp4a(ASC_AAC_LC_44100), amostras: 431, delta: 1024 }));
    const livres = Buffer.alloc(8 * 200_001);
    for (let i = 0; i < 200_001; i++) caixa("free").copy(livres, i * 8);
    expect(medirDuracaoDoAudio(Buffer.concat([ftyp(), moov, livres]))).toBeNull();
  });

  // A borda de TETO_DE_FAIXAS_MP4 (64), com a faixa de som legítima por ÚLTIMO para que seja ela a 64ª ou a 65ª.
  // O par protege o `>=` da guarda: com `>` o 65º trak ainda seria lido e o segundo caso mediria; com o teto um
  // abaixo, o 64º (a própria faixa de som) já não seria lido e o primeiro caso daria null.
  const faixaDeSomDepoisDe = (forjados: number) => Buffer.concat([ftyp(), caixa("moov",
    ...Array.from({ length: forjados }, () => caixa("trak")),
    trak({ id: 1, manipulador: "soun", escala: 44100, entrada: entradaMp4a(ASC_AAC_LC_44100), amostras: 431, delta: 1024 }))]);

  it("exatamente 64 faixas (63 trak forjados e a de som): ainda mede", () => {
    expect(medirDuracaoDoAudio(faixaDeSomDepoisDe(63))).toBeCloseTo((431 * 1024) / 44100, 6);
  });

  it("65 faixas: desiste (null) antes de ler a 65ª, mesmo sendo ela a de som", () => {
    expect(medirDuracaoDoAudio(faixaDeSomDepoisDe(64))).toBeNull();
  });
});

describe("medirDuracaoDoAudio — o que não se mede", () => {
  it("texto, vazio, FLAC e bytes que só parecem um quadro solto: null (quem chama recusa)", () => {
    expect(medirDuracaoDoAudio(Buffer.from("reuniao em mp4"))).toBeNull();
    expect(medirDuracaoDoAudio(Buffer.alloc(0))).toBeNull();
    expect(medirDuracaoDoAudio(Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(100)]))).toBeNull();
    expect(medirDuracaoDoAudio(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(40)]))).toBeNull();
  });

  it("contêiner que não reconhecemos com quadros de MP3 no meio não vira 'MP3 curto'", () => {
    const disfarce = Buffer.concat([Buffer.from("FORM....AIFFCOMM"), ...Array.from({ length: 10 }, quadroMp3)]);
    expect(medirDuracaoDoAudio(disfarce)).toBeNull();
  });

  it("WAV sem 'fmt ' e MP4 sem faixa de som: null", () => {
    const semFmt = Buffer.concat([Buffer.from("RIFF"), u32le(12), Buffer.from("WAVE"), Buffer.from("data"), u32le(4), Buffer.alloc(4)]);
    expect(medirDuracaoDoAudio(semFmt)).toBeNull();
    expect(medirDuracaoDoAudio(Buffer.concat([ftyp(), caixa("mdat", Buffer.alloc(100))]))).toBeNull();
  });
});
