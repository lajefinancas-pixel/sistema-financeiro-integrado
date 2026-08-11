import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Carimbo do build, usado apenas na categoria Sistema das Configurações para
// mostrar "última atualização". A data é o instante em que esta versão foi
// compilada (na prática, quando o commit mais recente foi publicado) e o commit
// vem da esteira da Netlify, que expõe COMMIT_REF durante o build — em
// desenvolvimento ele fica vazio.
//
// Vai por variável de ambiente com prefixo VITE_ porque é assim que o Vite
// entrega o valor tanto no servidor de desenvolvimento quanto no build. Nenhum
// dado sensível entra aqui: é uma data e a referência pública do commit.
process.env.VITE_SISTEMA_PUBLICACAO = new Date().toISOString();
process.env.VITE_SISTEMA_COMMIT = process.env.COMMIT_REF ?? "";

export default defineConfig({
  plugins: [react()],
});
