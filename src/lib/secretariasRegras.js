export function somenteFinanceiras(secretarias = []) {
  return (secretarias ?? []).filter((item) => item?.ativo !== false && item?.possui_financeiro === true);
}

export function secretariasAtivas(secretarias = []) {
  return (secretarias ?? []).filter((item) => item?.ativo !== false);
}
