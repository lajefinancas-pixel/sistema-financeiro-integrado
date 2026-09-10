/**
 * Resolvedor de importação sem extensão, para os testes.
 *
 * Vários módulos de src/lib importam vizinhos sem o ".js" (o Vite resolve isso
 * no navegador; o Node, não). Este hook só acrescenta a extensão quando a
 * resolução normal falha -- nada mais é alterado, e nenhum módulo do sistema
 * precisa mudar por causa do teste.
 */
export async function resolve(especificador, contexto, proximo) {
  try {
    return await proximo(especificador, contexto);
  } catch (falha) {
    if (especificador.startsWith(".") && !especificador.endsWith(".js")) {
      return proximo(`${especificador}.js`, contexto);
    }
    throw falha;
  }
}
