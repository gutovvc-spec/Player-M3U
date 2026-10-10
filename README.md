# Player M3U

Player IPTV para Windows, com catálogo de TV ao vivo, filmes e séries, favoritos e retomada de reprodução.

## Como usar

1. Abra `Player M3U.exe`.
2. Na primeira abertura, informe seu nome. Depois, clique em **Adicionar playlist** e informe um nome e o link M3U fornecido pelo seu serviço.
3. Use a navegação da barra lateral para escolher TV ao vivo, filmes, séries ou favoritos. A busca da barra lateral procura em toda a playlist; a busca junto ao catálogo filtra o grupo ou seção atual.
4. Marque o coração para salvar favoritos. Filmes e séries retomam do ponto salvo neste dispositivo.
5. Para apagar uma lista, use **Remover lista** e confirme. Isso remove os dados locais dos itens carregados, favoritos e progresso associados à playlist ativa, sem apagar as outras listas.

Seu nome, o link e o nome da playlist, os favoritos e o progresso ficam armazenados localmente no aplicativo. Para suportar playlists grandes sem o limite de espaço do `localStorage`, a playlist é carregada novamente pela internet quando o aplicativo abre. O carregamento pode levar até 2 minutos, dependendo da velocidade da internet, do servidor e do tamanho da playlist; listas muito grandes podem levar mais tempo para serem organizadas. O catálogo é processado em blocos e exibido em páginas para manter o aplicativo responsivo. O computador precisa de conexão para carregar playlists remotas e reproduzir conteúdo online.

Se a imagem da playlist não carregar, confira a conexão com a internet, o endereço e se o serviço IPTV está disponível. Alguns serviços podem exigir que a playlist seja acessada com credenciais válidas ou bloquear conexões de aplicativos; nesse caso, consulte seu provedor.

## Instalação como PWA no celular

O projeto também pode ser publicado como PWA. Hospede os arquivos do projeto em um endereço **HTTPS** e abra-o no navegador do celular. No Android, use **Instalar app** ou a opção de instalação do navegador; no iPhone/iPad, abra no Safari, toque em **Compartilhar** e escolha **Adicionar à Tela de Início**. O service worker mantém os arquivos da interface disponíveis para abrir offline; playlists e transmissões continuam dependendo de conexão.

No PWA, o navegador pode bloquear o carregamento da playlist por CORS. Além disso, páginas HTTPS não podem buscar links HTTP por causa da política de conteúdo misto. Como este player aceita somente links M3U começados por `http://`, uma playlist HTTP pode funcionar no executável Electron, mas não necessariamente no PWA hospedado em HTTPS. O acesso pelo PWA depende de uma origem e de um provedor compatíveis com as políticas do navegador.

## Categorias e reprodução

As categorias e grupos são identificados pelas informações da playlist (`group-title`), exibidos em uma coluna lateral para separar provedores como Netflix e HBO Max e grupos de canais como Globo e Record. Episódios com nomes como `S01E01`, `1x01` ou temporada/episódio são agrupados por série, com filtros por temporada. A reprodução usa HLS para links M3U8 e suporte MPEG-TS para transmissões IPTV ao vivo; o buffer não tenta acelerar até o sinal atual para evitar saltos na reprodução. Formatos, codecs, CORS e acesso continuam dependendo do servidor de origem.

Use somente playlists e serviços aos quais você tem direito de acesso.

## Desenvolver e gerar o executável

Com Node.js instalado, execute `npm install` e `npm start` para abrir o aplicativo. Para gerar ou substituir a versão portátil para Windows x64 na raiz do projeto, feche o player e execute `npm run build:exe`. O executável gerado tem sempre o nome `Player M3U.exe`. Os testes do leitor M3U podem ser executados com `npm test`.
