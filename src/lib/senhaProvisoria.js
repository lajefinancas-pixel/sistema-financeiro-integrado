// Gerador de senhas provisórias usado tanto no cadastro de usuários (navegador)
// quanto na redefinição de senha (Netlify Function). Depende só da Web Crypto,
// disponível nos dois ambientes.

const GRUPOS = [
  "ABCDEFGHJKLMNPQRSTUVWXYZ", // sem I e O para não confundir com 1 e 0
  "abcdefghijkmnopqrstuvwxyz", // sem l
  "23456789",
  "!@#$%&*?",
];
const TODOS = GRUPOS.join("");

// Sorteio uniforme: descarta os valores da "sobra" para não enviesar o módulo.
function sortear(maximo) {
  const buffer = new Uint32Array(1);
  const limite = Math.floor(0x100000000 / maximo) * maximo;
  let valor;
  do {
    globalThis.crypto.getRandomValues(buffer);
    valor = buffer[0];
  } while (valor >= limite);
  return valor % maximo;
}

export function gerarSenhaProvisoria(tamanho = 14) {
  const total = Math.max(tamanho, GRUPOS.length);
  // Garante pelo menos um caractere de cada grupo antes de completar o restante.
  const caracteres = GRUPOS.map((grupo) => grupo[sortear(grupo.length)]);
  while (caracteres.length < total) caracteres.push(TODOS[sortear(TODOS.length)]);

  for (let i = caracteres.length - 1; i > 0; i -= 1) {
    const j = sortear(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return caracteres.join("");
}
