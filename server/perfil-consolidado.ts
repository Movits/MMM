/**
 * Colunas duplicadas de user_profiles — etapa 1 da consolidação (13/09/2026).
 *
 * O schema herdou dois nomes para o mesmo dado: `jobTitle` e `currentRole`
 * (cargo), `company` e `currentCompany` (empresa). O Onboarding gravava nos
 * nomes antigos e a tela de Perfil nos novos, então cada tela mostrava metade.
 * Ficam `jobTitle` e `company`: são os que o Perfil edita, os que a análise do
 * distribuidor lê e os mesmos nomes das colunas dos contatos.
 *
 * Nesta etapa nenhuma coluna é apagada e nenhum dado é copiado por SQL. Toda
 * escrita vai para a coluna que fica; a leitura cai na antiga só quando a nova
 * está vazia. A etapa 2 (copiar o que restou e apagar as antigas) vem depois,
 * num deploy separado: as migrações rodam no boot, antes do código novo, e a
 * versão anterior ainda atende durante a troca.
 */

type CargoEEmpresa = {
  jobTitle?: string | null;
  currentRole?: string | null;
  company?: string | null;
  currentCompany?: string | null;
};

function preenchido(valor: string | null | undefined): valor is string {
  return typeof valor === "string" && valor.trim() !== "";
}

/** O perfil com cargo e empresa lidos da coluna que fica, caindo na antiga só se ela estiver vazia. */
export function consolidarPerfil<T extends CargoEEmpresa>(perfil: T): T {
  return {
    ...perfil,
    jobTitle: preenchido(perfil.jobTitle) ? perfil.jobTitle : preenchido(perfil.currentRole) ? perfil.currentRole : perfil.jobTitle,
    company: preenchido(perfil.company) ? perfil.company : preenchido(perfil.currentCompany) ? perfil.currentCompany : perfil.company,
  };
}

/**
 * O que gravar em `jobTitle`/`company` a partir do que chegou do formulário.
 * O nome novo vence; o antigo entra quando o novo veio vazio (Onboarding de
 * antes do deploy, ainda em cache no navegador). `undefined` = não mexer.
 */
export function cargoEEmpresaParaGravar(entrada: CargoEEmpresa): { jobTitle?: string; company?: string } {
  const escolher = (novo?: string | null, antigo?: string | null) =>
    preenchido(novo) ? novo : preenchido(antigo) ? antigo : undefined;
  return {
    jobTitle: escolher(entrada.jobTitle, entrada.currentRole),
    company: escolher(entrada.company, entrada.currentCompany),
  };
}
