export function diasAteValidade(iso) {
  if (!iso) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Math.round((alvo - hoje) / 86400000);
}

export function situacaoContrato(item) {
  if (item?.encerrado) return "encerrado";
  const dias = diasAteValidade(item?.data_validade);
  if (dias === null) return "vigente";
  if (dias < 0) return "vencido";
  return dias <= 30 ? "vencendo" : "vigente";
}

function normalizarTexto(valor) {
  return String(valor ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function somenteDigitos(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

export function fornecedorContratoAtendeBusca(fornecedor, termo) {
  const busca = normalizarTexto(termo);
  if (!busca) return true;
  const documento = somenteDigitos(termo);
  if (documento.length >= 3 && somenteDigitos(fornecedor?.cpf_cnpj).includes(documento)) return true;
  return [fornecedor?.razao_social, fornecedor?.nome_fantasia, fornecedor?.nome]
    .some((valor) => normalizarTexto(valor).includes(busca));
}

export function secretariasDaLicitacao(item) {
  const vinculadas = (item?.licitacoes_contratos_secretarias ?? [])
    .map((vinculo) => vinculo?.secretarias ?? vinculo?.secretaria)
    .filter(Boolean);
  if (vinculadas.length > 0) return vinculadas;
  return item?.secretarias ? [item.secretarias] : [];
}

export function rotuloSecretariasDaLicitacao(item, totalSecretariasAtivas = 0) {
  const secretarias = secretariasDaLicitacao(item);
  if (item?.todas_secretarias || (totalSecretariasAtivas > 0 && secretarias.length === totalSecretariasAtivas)) return "Todas as secretarias";
  if (secretarias.length === 0) return "Sem secretaria";
  return secretarias.map((s) => s.nome).sort((a, b) => a.localeCompare(b, "pt-BR")).join(", ");
}

export function filtrarLicitacoesContratos(itens = [], filtros = {}) {
  const objeto = normalizarTexto(filtros.objeto);
  return (itens ?? []).filter((item) =>
    fornecedorContratoAtendeBusca(item.fornecedores, filtros.fornecedor) &&
    (!objeto || normalizarTexto(item.objeto).includes(objeto)) &&
    (!filtros.tipo || item.tipo_id === filtros.tipo) &&
    (!filtros.secretaria || item.todas_secretarias === true || secretariasDaLicitacao(item).some((s) => String(s.id) === String(filtros.secretaria)) || String(item.secretaria_id ?? "") === String(filtros.secretaria)) &&
    (!filtros.situacao || situacaoContrato(item) === filtros.situacao) &&
    (!filtros.assinaturaDe || item.data_inicio >= filtros.assinaturaDe) &&
    (!filtros.assinaturaAte || item.data_inicio <= filtros.assinaturaAte) &&
    (!filtros.validadeDe || item.data_validade >= filtros.validadeDe) &&
    (!filtros.validadeAte || item.data_validade <= filtros.validadeAte)
  );
}
