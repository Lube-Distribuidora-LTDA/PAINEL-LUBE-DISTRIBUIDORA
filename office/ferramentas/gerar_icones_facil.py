"""
LUBE OFFICE - gera os icones da aba "Lube Facil" (office/ia/facil.js).

Saida: office/ia/facil/light/*.svg e office/ia/facil/dark/*.svg, 28x28 (tamanho
dos botoes grandes do ONLYOFFICE). O editor escolhe a pasta pelo tipo do tema:
light nos temas claros, dark nos escuros (Lube Escuro incluido).

Rodar (na pasta do portal):  python office/ferramentas/gerar_icones_facil.py
Cores da marca: nota "Identidade visual da Lube" no cerebro.
"""
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
SAIDA = RAIZ / "ia" / "facil"

CORES = {
    "light": {"i": "#1A2142", "r": "#E5101F", "b": "#2C3FC4"},
    "dark": {"i": "#E9ECF6", "r": "#FF4B55", "b": "#8FA0FF"},
}
TXT = 'font-family="Arial, Helvetica, sans-serif" font-weight="700"'

ICONES = {
    # documento
    "titulo": '<path d="M6 7h16M14 7v12" stroke="{i}" stroke-width="2.4" stroke-linecap="round"/>'
              '<rect x="6" y="21.5" width="10" height="2.4" rx="1.2" fill="{r}"/>',
    "secao": '<rect x="4.5" y="7" width="5.5" height="5.5" rx=".8" fill="{r}"/>'
             '<path d="M13 9.75h10.5" stroke="{i}" stroke-width="2.2" stroke-linecap="round"/>'
             '<path d="M5 17h18.5M5 21.5h13" stroke="{i}" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>',
    "lista": '<circle cx="7" cy="8" r="1.8" fill="{r}"/><circle cx="7" cy="14" r="1.8" fill="{r}"/><circle cx="7" cy="20" r="1.8" fill="{r}"/>'
             '<path d="M11.5 8h11M11.5 14h11M11.5 20h8" stroke="{i}" stroke-width="1.8" stroke-linecap="round"/>',
    "numerada": '<text x="4.5" y="10.5" ' + TXT + ' font-size="7.5" fill="{r}">1</text>'
                '<text x="4.5" y="17" ' + TXT + ' font-size="7.5" fill="{r}">2</text>'
                '<text x="4.5" y="23.5" ' + TXT + ' font-size="7.5" fill="{r}">3</text>'
                '<path d="M11.5 8h11M11.5 14.5h11M11.5 21h8" stroke="{i}" stroke-width="1.8" stroke-linecap="round"/>',
    "tabela": '<path d="M4 7.5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3H4z" fill="{b}"/>'
              '<rect x="4" y="5.5" width="20" height="17" rx="2" stroke="{i}" stroke-width="1.6" fill="none"/>'
              '<path d="M4 16.5h20M11 10.5v12M17.5 10.5v12" stroke="{i}" stroke-width="1.3"/>',
    "destaque": '<rect x="4" y="7" width="20" height="14" rx="2" fill="{r}" fill-opacity=".16"/>'
                '<rect x="4" y="7" width="3" height="14" rx="1" fill="{r}"/>'
                '<path d="M10.5 12h10M10.5 16h7" stroke="{i}" stroke-width="1.8" stroke-linecap="round"/>',
    "citacao": '<text x="4" y="24" font-family="Georgia, serif" font-weight="700" font-size="24" fill="{b}">“</text>'
               '<path d="M16.5 19.5h7" stroke="{r}" stroke-width="2" stroke-linecap="round"/>'
               '<path d="M16.5 15h7" stroke="{i}" stroke-width="1.5" stroke-linecap="round" opacity=".5"/>',
    "data": '<rect x="5" y="7" width="18" height="16" rx="2.5" stroke="{i}" stroke-width="1.6" fill="none"/>'
            '<path d="M5 12h18" stroke="{i}" stroke-width="1.6"/>'
            '<path d="M10 5v4M18 5v4" stroke="{i}" stroke-width="1.8" stroke-linecap="round"/>'
            '<rect x="9" y="15" width="4" height="4" rx="1" fill="{r}"/>',
    "assinatura": '<path d="M4.5 18c2.5-5 4.5-8 6-8s-1 7 1 7 2.5-4 4-4 1 3 2.5 3 2-1 3.5-2" stroke="{b}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
                  '<path d="M4.5 22.5h19" stroke="{i}" stroke-width="1.6" stroke-linecap="round"/>'
                  '<path d="M20 22.5h3.5" stroke="{r}" stroke-width="1.6" stroke-linecap="round"/>',
    "timbrado": '<rect x="6" y="4" width="16" height="20" rx="2" stroke="{i}" stroke-width="1.6" fill="none"/>'
                '<rect x="8.5" y="6.5" width="7" height="2.6" rx=".8" fill="{b}"/>'
                '<path d="M8.5 11.2h11" stroke="{r}" stroke-width="1.6"/>'
                '<path d="M8.5 15h11M8.5 18.3h8" stroke="{i}" stroke-width="1.4" stroke-linecap="round" opacity=".5"/>'
                '<path d="M11 21.5h6" stroke="{i}" stroke-width="1.2" stroke-linecap="round" opacity=".5"/>',
    # planilha
    "cabecalho": '<rect x="4" y="5.5" width="20" height="5.5" rx="1.5" fill="{b}"/>'
                 '<path d="M7.5 8.25h4M16.5 8.25h4" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round"/>'
                 '<path d="M4 15h20M4 19.5h20M4 24h20M14 13v11" stroke="{i}" stroke-width="1.3" opacity=".5"/>',
    "moeda": '<text x="14" y="19" text-anchor="middle" ' + TXT + ' font-size="12" fill="{i}">R$</text>'
             '<rect x="7" y="21.5" width="14" height="2.2" rx="1.1" fill="{r}"/>',
    "porcentagem": '<text x="14" y="19.5" text-anchor="middle" ' + TXT + ' font-size="15" fill="{i}">%</text>'
                   '<rect x="8" y="21.5" width="12" height="2.2" rx="1.1" fill="{r}"/>',
    "somar": '<text x="14" y="20" text-anchor="middle" ' + TXT + ' font-size="17" fill="{i}">Σ</text>'
             '<rect x="8" y="22" width="12" height="2.2" rx="1.1" fill="{r}"/>',
    "fixar": '<rect x="4" y="5" width="20" height="18" rx="2" stroke="{i}" stroke-width="1.5" fill="none"/>'
             '<path d="M4 10.5h20" stroke="{r}" stroke-width="2.4"/>'
             '<path d="M4 15.5h20M4 19.5h20M11 10.5v12.5" stroke="{i}" stroke-width="1.2" opacity=".45"/>',
    "ajustar": '<path d="M10 5v18M18 5v18" stroke="{i}" stroke-width="1.7" stroke-linecap="round"/>'
               '<path d="M12.2 14h3.6" stroke="{i}" stroke-width="1.4" stroke-linecap="round" opacity=".5"/>'
               '<path d="M2.5 14h5M5 11.5 2.5 14 5 16.5M25.5 14h-5M23 11.5l2.5 2.5-2.5 2.5" stroke="{r}" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    "grafico": '<path d="M4.5 23.5h19" stroke="{i}" stroke-width="1.6" stroke-linecap="round"/>'
               '<rect x="6.5" y="14" width="4" height="8" rx="1" fill="{b}"/>'
               '<rect x="12" y="7.5" width="4" height="14.5" rx="1" fill="{r}"/>'
               '<rect x="17.5" y="11" width="4" height="11" rx="1" fill="{b}"/>',
    # apresentacao
    "novo-slide": '<rect x="3.5" y="5.5" width="17" height="12.5" rx="1.8" stroke="{i}" stroke-width="1.6" fill="none"/>'
                  '<path d="M6.5 9.5h7" stroke="{b}" stroke-width="2" stroke-linecap="round"/>'
                  '<path d="M6.5 13h5" stroke="{i}" stroke-width="1.4" stroke-linecap="round" opacity=".5"/>'
                  '<circle cx="21" cy="20" r="5" fill="{r}"/>'
                  '<path d="M21 17.5v5M18.5 20h5" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round"/>',
    "logo": '<rect x="5" y="4.5" width="18" height="18" rx="4" fill="{b}"/>'
            '<path d="M11 9v9h6.5" stroke="#FFFFFF" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
            '<path d="M8.5 25h9.5l1.5-2.2H10z" fill="{r}"/>',
    "animar": '<rect x="9" y="6.5" width="15" height="11.5" rx="1.8" stroke="{i}" stroke-width="1.6" fill="none"/>'
              '<path d="M3 9.5h4M4.5 13.5h3M3 17.5h4" stroke="{r}" stroke-width="1.7" stroke-linecap="round"/>'
              '<path d="M16.5 8.8l.95 2.3 2.3.95-2.3.95-.95 2.3-.95-2.3-2.3-.95 2.3-.95z" fill="{b}"/>'
              '<path d="M12 22.5h9" stroke="{i}" stroke-width="1.4" stroke-linecap="round" opacity=".5"/>',
    "transicao": '<rect x="3.5" y="6.5" width="12" height="9" rx="1.5" stroke="{i}" stroke-width="1.5" fill="none" opacity=".55"/>'
                 '<rect x="12.5" y="10" width="12" height="9" rx="1.5" fill="{b}"/>'
                 '<path d="M5.5 21.5c3 2 8 2 11 0M14.6 20.4l2 1.1-1.3 1.9" stroke="{r}" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    # todos
    "ia": '<path d="M12.5 4l2.3 6.2 6.2 2.3-6.2 2.3-2.3 6.2-2.3-6.2-6.2-2.3 6.2-2.3z" fill="{r}"/>'
          '<path d="M21.5 17l1.1 2.8 2.8 1.1-2.8 1.1-1.1 2.8-1.1-2.8-2.8-1.1 2.8-1.1z" fill="{b}"/>',
}


def main():
    for tema, cores in CORES.items():
        pasta = SAIDA / tema
        pasta.mkdir(parents=True, exist_ok=True)
        for nome, corpo in ICONES.items():
            svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">'
                   + corpo.format(**cores) + "</svg>\n")
            (pasta / (nome + ".svg")).write_text(svg, encoding="utf-8")
    print("ok", len(ICONES), "icones x", len(CORES), "temas em", SAIDA.relative_to(RAIZ.parent))


if __name__ == "__main__":
    main()
