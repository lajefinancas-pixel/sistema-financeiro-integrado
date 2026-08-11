import React from "react";
import { Building2 } from "lucide-react";
import { Alerta, Campo, CLASSE_ENTRADA } from "../equipe/comuns";
import { Cartao, RodapeFormulario, SeletorLogomarca } from "./comuns";
import {
  enviarLogomarca,
  formatarCNPJ,
  formatarTelefone,
  LIMITE_LOGO_MB,
  salvarGeral,
  textoUltimaAlteracao,
} from "../../lib/configuracoesSistema";
import { mensagemAmigavel } from "../../lib/erros";
import { registrarEvento } from "../../lib/auditoria";

/**
 * Categoria GERAL: identificação da instituição e do sistema.
 *
 * O que é salvo aqui alimentará os cabeçalhos de relatórios e impressões nas
 * próximas etapas — por isso a tela já grava nome, CNPJ, contato, endereço e a
 * logomarca no Storage.
 */
export default function CategoriaGeral({ valores, autoria, podeEditar, onSalvo }) {
  const [form, setForm] = React.useState(valores);
  const [logo, setLogo] = React.useState(null); // arquivo novo, ainda não enviado
  const [logoRemovida, setLogoRemovida] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [sucesso, setSucesso] = React.useState(null);

  // Quando a página recarrega os valores (após salvar), o formulário acompanha.
  React.useEffect(() => {
    setForm(valores);
    setLogo(null);
    setLogoRemovida(false);
  }, [valores]);

  function alterar(campo, valor) {
    setSucesso(null);
    setForm((atual) => ({ ...atual, [campo]: valor }));
  }

  const logoAtual = logoRemovida ? null : form.logo_url ?? null;
  const alterado =
    logo !== null ||
    logoRemovida ||
    ["nome_instituicao", "nome_sistema", "cnpj", "telefone", "email", "endereco"].some(
      (campo) => (form[campo] ?? "") !== (valores[campo] ?? "")
    );

  async function salvar(evento) {
    evento.preventDefault();
    if (salvando || !podeEditar) return;

    setSalvando(true);
    setErro(null);
    setSucesso(null);
    try {
      // A imagem sobe primeiro: se o envio falhar, nada é gravado na tabela.
      const logoUrl = logo ? await enviarLogomarca(logo) : logoAtual;
      const gravado = await salvarGeral({ ...form, logo_url: logoUrl });

      await registrarEvento({
        modulo: "administracao",
        acao: "alterou",
        registroAfetado: "Configurações do sistema — Geral",
        valorAnterior: valores,
        valorNovo: gravado,
        nivel: "atencao",
      });

      setSucesso("Configurações gerais salvas.");
      onSalvo(gravado);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar as configurações gerais."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} className="space-y-5">
      <Cartao
        titulo="Identificação da instituição"
        descricao="Estes dados identificam o sistema na tela e serão usados nos cabeçalhos de relatórios e impressões."
        icone={Building2}
        rodape={
          <RodapeFormulario
            ultimaAlteracao={textoUltimaAlteracao(autoria)}
            podeEditar={podeEditar}
            salvando={salvando}
            alterado={alterado}
          />
        }
      >
        <div className="space-y-5">
          {erro && <Alerta tipo="erro">{erro}</Alerta>}
          {sucesso && <Alerta tipo="sucesso">{sucesso}</Alerta>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Campo label="Nome da instituição" obrigatorio dica="Ex.: Secretaria Municipal de Finanças.">
              <input
                type="text"
                value={form.nome_instituicao ?? ""}
                onChange={(e) => alterar("nome_instituicao", e.target.value)}
                disabled={!podeEditar}
                maxLength={120}
                className={CLASSE_ENTRADA}
              />
            </Campo>

            <Campo label="Nome do sistema" obrigatorio dica="Como o sistema é chamado nos documentos.">
              <input
                type="text"
                value={form.nome_sistema ?? ""}
                onChange={(e) => alterar("nome_sistema", e.target.value)}
                disabled={!podeEditar}
                maxLength={120}
                className={CLASSE_ENTRADA}
              />
            </Campo>

            <Campo label="CNPJ">
              <input
                type="text"
                inputMode="numeric"
                value={form.cnpj ?? ""}
                onChange={(e) => alterar("cnpj", formatarCNPJ(e.target.value))}
                disabled={!podeEditar}
                placeholder="00.000.000/0000-00"
                className={CLASSE_ENTRADA}
              />
            </Campo>

            <Campo label="Telefone">
              <input
                type="text"
                inputMode="tel"
                value={form.telefone ?? ""}
                onChange={(e) => alterar("telefone", formatarTelefone(e.target.value))}
                disabled={!podeEditar}
                placeholder="(00) 00000-0000"
                className={CLASSE_ENTRADA}
              />
            </Campo>

            <Campo label="E-mail institucional">
              <input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => alterar("email", e.target.value)}
                disabled={!podeEditar}
                placeholder="financas@instituicao.gov.br"
                className={CLASSE_ENTRADA}
              />
            </Campo>

            <Campo label="Endereço" dica="Logradouro, número, bairro, cidade e UF.">
              <input
                type="text"
                value={form.endereco ?? ""}
                onChange={(e) => alterar("endereco", e.target.value)}
                disabled={!podeEditar}
                maxLength={240}
                className={CLASSE_ENTRADA}
              />
            </Campo>
          </div>

          <div className="pt-4 border-t border-black/5">
            <span className="text-xs font-medium text-[#0F2A44]/70">Logomarca</span>
            <div className="mt-3">
              <SeletorLogomarca
                urlAtual={logoAtual}
                arquivo={logo}
                limiteMb={LIMITE_LOGO_MB}
                desabilitado={!podeEditar || salvando}
                onSelecionar={(arquivo) => {
                  setSucesso(null);
                  setErro(null);
                  setLogoRemovida(false);
                  setLogo(arquivo);
                }}
                onRemover={() => {
                  setSucesso(null);
                  setLogo(null);
                  setLogoRemovida(true);
                }}
              />
            </div>
          </div>
        </div>
      </Cartao>
    </form>
  );
}
