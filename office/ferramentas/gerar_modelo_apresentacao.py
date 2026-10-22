"""
LUBE OFFICE - gera o modelo "Apresentação Lube" a partir da apresentação padrão da Lube.

A apresentação padrão é a "Inovação nos BIs da Lube" (Júlio, 2026-10-22: "quero que essa
apresentação possa ser a padrão da Lube"). O modelo leva os mesmos 19 tipos de slide, com o
mesmo desenho, mas com texto de exemplo no lugar dos dados (a original tem números internos e
NÃO vai para o repositório: o portal é público). Também troca as fontes (Plus Jakarta Sans,
Inter e JetBrains Mono, que o motor não tem) por Arial, compacta as imagens (8,7 MB viram ~1 MB)
e põe nas anotações de cada slide o tipo dele e como reaproveitar.

Saída: office/modelos/apresentacao-lube.pptx e, para os slides que a IA e a aba Lube Fácil
desenham (office/ia/executor.js), office/ia/modelo/capa.jpg, fundo.jpg e logo-escura.png.

Rodar (na pasta do portal):
  python office/ferramentas/gerar_modelo_apresentacao.py ["caminho da apresentação padrão.pptx"]
Sem caminho, procura em Downloads\\Inovação nos BIs da Lube.pptx.
Precisa de: python-pptx 1.0, Pillow.
"""
import io
import re
import sys
import zipfile
from pathlib import Path

from PIL import Image
from pptx import Presentation

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gerar_modelos import finalizar  # noqa: E402  (mesmo acabamento dos outros modelos)

RAIZ = Path(__file__).resolve().parents[1]
SAIDA = RAIZ / "modelos" / "apresentacao-lube.pptx"
ASSETS = RAIZ / "ia" / "modelo"
PADRAO = Path.home() / "Downloads" / "Inovação nos BIs da Lube.pptx"

RODAPE = "Lube Distribuidora · Nome da apresentação"
DICA = ("Troque os textos de exemplo. Para usar este tipo de slide de novo, clique com o botão direito na "
        "miniatura e escolha Duplicar slide; o que não for usar, apague.")

# texto de exemplo de cada forma com texto, na ordem em que aparecem no slide. None = mantém.
# "\n" separa parágrafos; [a, b] preenche runs em sequência (negrito e normal, por exemplo).
TEXTOS = {
    1: ("Capa", ["TEMA DA APRESENTAÇÃO · MÊS DE AAAA", "Título da\napresentação",
                 "Uma frase que diz do que se trata e o que quem assiste leva desta apresentação."]),
    2: ("Contexto com quatro cartões (fundo claro)", [
        "CONTEXTO", "Título do slide em uma linha",
        "Uma ou duas frases de apoio que explicam o título e preparam os cartões abaixo.",
        "Primeiro ponto", "Explique o ponto em uma ou duas linhas curtas.",
        "Segundo ponto", "Explique o ponto em uma ou duas linhas curtas.",
        "Terceiro ponto", "Explique o ponto em uma ou duas linhas curtas.",
        "Quarto ponto", "Explique o ponto em uma ou duas linhas curtas.",
        RODAPE, None]),
    3: ("Números em destaque (fundo claro)", [
        "NÚMEROS EM DESTAQUE · PERÍODO", "Os números que contam a história",
        "R$ 0.000,00", "o que este número mostra",
        "R$ 0.000,00", "o que este número mostra",
        "R$ 0.000,00", "o que este número mostra",
        ["A conclusão em destaque: ", "o número que mais importa", " e o que ele quer dizer."],
        RODAPE, None]),
    4: ("Tabela (fundo claro)", [
        "EM TABELA", "Título da tabela em uma linha",
        "Fonte: de onde vêm os dados e a data da consulta.", RODAPE, None]),
    5: ("Divisor de seção (vermelho e azul)", [
        "SEÇÃO 02", "Uma frase forte que abre uma nova parte da apresentação.",
        "Uma linha de apoio para a seção: o que vem a seguir e por quê.", RODAPE, None]),
    6: ("Etapas numeradas (fundo escuro)", [
        "O MÉTODO", "Passo a passo em quatro etapas", "Uma linha que resume o caminho inteiro.",
        "01", "Primeira etapa", "O que acontece nesta etapa, em uma ou duas linhas.",
        "02", "Segunda etapa", "O que acontece nesta etapa, em uma ou duas linhas.",
        "03", "Terceira etapa", "O que acontece nesta etapa, em uma ou duas linhas.",
        "04", "Quarta etapa", "O que acontece nesta etapa, em uma ou duas linhas.",
        RODAPE, None]),
    7: ("Fluxo em cinco caixas (fundo escuro)", [
        "O CAMINHO", "Do começo ao fim, em cinco passos",
        "Origem", "De onde tudo começa.",
        "Passo 2", "O que acontece aqui.",
        "Passo 3", "O que acontece aqui.",
        "Passo 4", "O que acontece aqui.",
        "Resultado", "Onde o caminho chega.",
        "Uma regra do caminho", "Outra regra do caminho",
        "Mais uma regra do caminho",
        RODAPE, None]),
    8: ("Número grande com três cartões (fundo escuro)", [
        "RESULTADO", "O resultado em um número",
        "CONTEXTO · PERÍODO", "+00%", "o que este número significa, em uma linha",
        "Antes · R$ 0,00", "Depois · R$ 0,00",
        "Destaque um", "Uma frase que reforça o resultado.",
        "Destaque dois", "Uma frase que reforça o resultado.",
        "Destaque três", "Uma frase que reforça o resultado.",
        RODAPE, None]),
    9: ("Tabela com antes e hoje (fundo escuro)", [
        "EM NÚMEROS", "Tabela no fundo escuro",
        ["Antes: ", "como era antes desta mudança."], ["Hoje: ", "como ficou depois dela."],
        RODAPE, None]),
    10: ("Três passos com setas (fundo escuro)", [
        "COMO FUNCIONA", "Três passos, um depois do outro",
        "Uma linha de apoio que explica o ciclo.",
        "Primeiro", "O que acontece no primeiro passo.",
        "Depois", "O que acontece no segundo passo.",
        "Por fim", "O que acontece no terceiro passo.",
        ["Regra da casa: ", "uma frase que não pode ser esquecida."],
        "Uma observação curta de apoio.",
        RODAPE, None]),
    11: ("Lista com marcas e cartão de destaque (fundo escuro)", [
        "DESTAQUES", "Seis pontos em lista",
        "Primeiro ponto, em uma linha", "Segundo ponto, em uma linha", "Terceiro ponto, em uma linha",
        "Quarto ponto, em uma linha", "Quinto ponto, em uma linha", "Sexto ponto, em uma linha",
        "endereço, link ou referência", "Destaque do cartão", "Uma frase curta de apoio ao destaque.",
        RODAPE, None]),
    12: ("Quatro pilares com ícones (fundo escuro)", [
        "PILARES", "Quatro pilares do tema", "Uma linha que resume o que os quatro têm em comum.",
        "Primeiro pilar", "Explique o pilar em uma ou duas linhas.",
        "Segundo pilar", "Explique o pilar em uma ou duas linhas.",
        "Terceiro pilar", "Explique o pilar em uma ou duas linhas.",
        "Quarto pilar", "Explique o pilar em uma ou duas linhas.",
        RODAPE, None]),
    13: ("Mapa por área (fundo escuro)", [
        RODAPE, None, "VISÃO GERAL", "Tudo num só mapa, por área",
        "Área 1", "Item", "Descrição curta", "Item", "Descrição curta", "Item", "Descrição curta",
        "Área 2", "Item", "Descrição curta", "Item", "Descrição curta", "Item", "Descrição curta",
        "Área 3", "Item", "Descrição curta", "Item", "Descrição curta", "Item", "Descrição curta",
        "Área 4", "Item", "Descrição curta", "Item", "Descrição curta",
        "Área 5", "Item", "Descrição curta", "Item", "Descrição curta", "Item em destaque", "Descrição curta"]),
    14: ("Seis cartões (fundo claro)", [
        "NO DIA A DIA", "Seis vantagens para quem usa",
        "Vantagem 1", "Uma ou duas linhas sobre o que muda.",
        "Vantagem 2", "Uma ou duas linhas sobre o que muda.",
        "Vantagem 3", "Uma ou duas linhas sobre o que muda.",
        "Vantagem 4", "Uma ou duas linhas sobre o que muda.",
        "Vantagem 5", "Uma ou duas linhas sobre o que muda.",
        "Vantagem 6", "Uma ou duas linhas sobre o que muda.",
        RODAPE, None]),
    15: ("Quatro cartões grandes, um em destaque (fundo escuro)", [
        "ONDE ATUA", "Quatro frentes, uma em destaque",
        "Em destaque", "Explique a frente principal em duas ou três linhas.",
        "Frente 2", "Explique esta frente em duas ou três linhas.",
        "Frente 3", "Explique esta frente em duas ou três linhas.",
        "Frente 4", "Explique esta frente em duas ou três linhas.",
        RODAPE, None]),
    16: ("Linha do tempo (fundo claro)", [
        "LINHA DO TEMPO", "Do primeiro passo até hoje", "Um período, uma entrega atrás da outra.",
        "JAN", "Marco do mês", "FEV", "Marco do mês", "MAR", "Marco do mês", "ABR", "Marco do mês",
        "MAI", "Marco do mês", "JUN", "Marco do mês", "JUL", "Marco do mês", "AGO", "Marco do mês",
        "SET", "Marco do mês", "OUT", "Marco do mês\nsegunda linha", "NOV", "Marco do mês", "DEZ", "Marco em destaque",
        RODAPE, None]),
    17: ("Antes e depois em tabela (fundo claro)", ["BALANÇO", "Antes e depois", RODAPE, None]),
    18: ("Próximos passos (fundo escuro)", [
        "O QUE VEM AGORA", "Próximos passos",
        "Passo um", "O que será feito e quando.",
        "Passo dois", "O que será feito e quando.",
        "Passo três", "O que será feito e quando.",
        "Passo quatro", "O que será feito e quando.",
        RODAPE, None]),
    19: ("Encerramento", ["A mensagem final, em uma ou duas linhas, para ficar na cabeça.",
                          "Lube Distribuidora · desde 1959 · Cariacica-ES"]),
}

# tabelas: cabeçalho e linhas de exemplo (mesmo tamanho das originais, 7 x 3)
TABELAS = {
    4: [["Item", "Situação", "Resultado"]] + [[f"Item {i}", "Descreva a situação em uma linha", "O efeito ou o número"] for i in range(1, 7)],
    9: [["Item", "Quantidade", "Detalhe"]] + [[f"Item {i}", "0", "Descreva em uma linha"] for i in range(1, 7)],
    17: [["", "Antes", "Depois"]] + [[t, "Como era", "Como ficou"] for t in ("Tema 1", "Tema 2", "Tema 3", "Tema 4", "Tema 5", "Tema 6")],
}


def por_texto(shape, novo):
    """troca o texto mantendo a formatação de cada run"""
    pars = shape.text_frame.paragraphs
    if isinstance(novo, list):          # runs em sequência, num parágrafo só
        runs = pars[0].runs
        for i, r in enumerate(runs):
            r.text = novo[i] if i < len(novo) else ""
        return
    linhas = novo.split("\n")
    for i, par in enumerate(pars):
        runs = par.runs
        if not runs:
            continue
        runs[0].text = linhas[i] if i < len(linhas) else ""
        for r in runs[1:]:
            r.text = ""


def celula(c, texto):
    runs = [r for p in c.text_frame.paragraphs for r in p.runs]
    if runs:
        runs[0].text = texto
        for r in runs[1:]:
            r.text = ""
    elif texto:
        c.text = texto


def textos(p):
    for i, s in enumerate(p.slides, 1):
        tipo, lista = TEXTOS[i]
        formas = [sh for sh in s.shapes if sh.has_text_frame and sh.text_frame.text.strip()]
        if len(formas) != len(lista):
            raise SystemExit(f"slide {i}: {len(formas)} textos no arquivo e {len(lista)} no gerador")
        for sh, novo in zip(formas, lista):
            if novo is not None:
                por_texto(sh, novo)
        for sh in s.shapes:
            if sh.has_table and i in TABELAS:
                for r, linha in enumerate(TABELAS[i]):
                    for c, t in enumerate(linha):
                        celula(sh.table.cell(r, c), t)
        if s.has_notes_slide:
            s.notes_slide.notes_text_frame.text = f"Tipo de slide: {tipo}. {DICA}"


def compactar(caminho):
    """fontes em Arial e imagens leves: fundo opaco vira JPEG, imagem com transparência fica PNG menor"""
    with zipfile.ZipFile(caminho) as z:
        itens = {i.filename: z.read(i.filename) for i in z.infolist()}
    novos, renomear = {}, {}
    for nome, dados in itens.items():
        if nome.startswith("ppt/media/") and nome.endswith(".png") and len(dados) > 150_000:
            im = Image.open(io.BytesIO(dados))
            if im.mode == "RGBA" and im.getchannel("A").getextrema()[0] < 255:
                # transparente (a logo): metade do tamanho, que ainda é o dobro do que aparece no slide
                im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
                b = io.BytesIO()
                im.save(b, "PNG", optimize=True)
                novos[nome] = b.getvalue()
            else:
                b = io.BytesIO()
                im.convert("RGB").save(b, "JPEG", quality=86, optimize=True, progressive=True)
                novo = nome[:-4] + ".jpg"
                renomear[nome.split("/")[-1]] = novo.split("/")[-1]
                novos[novo] = b.getvalue()
                novos[nome] = None
        elif nome.endswith(".xml") or nome.endswith(".rels"):
            txt = dados.decode("utf-8")
            txt = re.sub(r'typeface="(Plus Jakarta Sans|Inter|JetBrains Mono)"', 'typeface="Arial"', txt)
            novos[nome] = txt.encode("utf-8")
    for nome, dados in list(novos.items()):
        if dados is not None and (nome.endswith(".rels") or nome == "[Content_Types].xml"):
            txt = dados.decode("utf-8")
            for de, para in renomear.items():
                txt = txt.replace("media/" + de, "media/" + para)
            if nome == "[Content_Types].xml" and renomear and 'Extension="jpg"' not in txt:
                txt = txt.replace("<Default ", '<Default Extension="jpg" ContentType="image/jpeg"/><Default ', 1)
            novos[nome] = txt.encode("utf-8")
    tmp = caminho.with_name(caminho.name + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for nome, dados in itens.items():
            if nome in novos and novos[nome] is None:
                continue
            z.writestr(nome, novos.get(nome, dados))
        for nome, dados in novos.items():
            if nome not in itens and dados is not None:
                z.writestr(nome, dados)
    tmp.replace(caminho)


def assets(p):
    """imagens que o executor.js usa para desenhar os slides da IA no mesmo estilo"""
    ASSETS.mkdir(parents=True, exist_ok=True)
    capa = p.slides[0].shapes[0].image   # fundo da capa (feixe azul e bloco vermelho)
    Image.open(io.BytesIO(capa.blob)).convert("RGB").resize((1920, 1080), Image.LANCZOS).save(
        ASSETS / "capa.jpg", "JPEG", quality=84, optimize=True, progressive=True)
    logo = p.slides[0].shapes[1].image   # logo com contorno branco, para fundo escuro
    im = Image.open(io.BytesIO(logo.blob)).convert("RGBA")
    # vai embutida em cada slide da IA: 960 px de largura e paleta de 256 cores bastam (no slide ela ocupa 1/3 da largura)
    im = im.resize((960, round(im.height * 960 / im.width)), Image.LANCZOS)
    im.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(ASSETS / "logo-escura.png", "PNG", optimize=True)
    # o fundo dos slides escuros o executor.js desenha em degradê; a imagem antiga sai da pasta
    (ASSETS / "fundo.jpg").unlink(missing_ok=True)


def main():
    fonte = Path(sys.argv[1]) if len(sys.argv) > 1 else PADRAO
    if not fonte.exists():
        raise SystemExit(f"Não achei a apresentação padrão em {fonte}")
    p = Presentation(str(fonte))
    assets(p)
    textos(p)
    p.save(str(SAIDA))
    compactar(SAIDA)
    finalizar(SAIDA, "Apresentação Lube")
    for f in [SAIDA] + sorted(ASSETS.iterdir()):
        print(f"{f.relative_to(RAIZ)}  {f.stat().st_size / 1024:7.1f} KB")


if __name__ == "__main__":
    main()
