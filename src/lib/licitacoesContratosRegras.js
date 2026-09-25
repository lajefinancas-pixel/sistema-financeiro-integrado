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
