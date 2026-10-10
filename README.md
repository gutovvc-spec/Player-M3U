# Player M3U

Player IPTV para Windows, com catálogo de TV ao vivo, filmes e séries, favoritos e retomada de reprodução.

## Como usar

1. Abra `Player M3U.exe`.
2. Na primeira abertura, informe seu nome. Depois, clique em **Adicionar playlist** e informe um nome e o link M3U fornecido pelo seu serviço.
3. Use a navegação da barra lateral para escolher TV ao vivo, filmes, séries ou favoritos. A busca da barra lateral procura em toda a playlist; a busca junto ao catálogo filtra o grupo ou seção atual.
4. Marque o coração para salvar favoritos. Filmes e séries retomam do ponto salvo neste dispositivo.
5. Para apagar uma lista, use **Remover lista** e confirme. Isso remove os dados locais dos itens carregados, favoritos e progresso associados à playlist ativa, sem apagar as outras listas.

Seu nome, o link e o nome da playlist, os favoritos e o progresso ficam armazenados localmente. No PWA, a playlist M3U processada é guardada no IndexedDB por até 20 horas para que as próximas visitas não precisem baixar novamente dezenas de megabytes; a primeira carga ainda depende da velocidade do provedor. Use **Baixar a playlist novamente do provedor** no formulário para ignorar a cópia local e buscar alterações. Ao remover a playlist, a cópia local também é apagada. No aplicativo desktop, playlists grandes continuam sendo carregadas pela internet quando o aplicativo abre. O catálogo é processado em blocos e exibido em páginas para manter o aplicativo responsivo. O dispositivo precisa de conexão para carregar playlists remotas e reproduzir conteúdo online.

Se a imagem da playlist não carregar, confira a conexão com a internet, o endereço e se o serviço IPTV está disponível. Alguns serviços podem exigir que a playlist seja acessada com credenciais válidas ou bloquear conexões de aplicativos; nesse caso, consulte seu provedor.

## PWA e proxy de IPTV na Vercel

O projeto também pode ser publicado como PWA. Hospede os arquivos do projeto em um endereço **HTTPS** e abra-o no navegador do celular. No Android, use **Instalar app** ou a opção de instalação do navegador; no iPhone/iPad, abra no Safari, toque em **Compartilhar** e escolha **Adicionar à Tela de Início**. O service worker mantém os arquivos da interface disponíveis para abrir offline; playlists e transmissões continuam dependendo de conexão.

Na versão web, playlists e transmissões passam pela função `/api/proxy` da Vercel. Para ativá-la, configure estas variáveis nas configurações do projeto Vercel e faça um novo deploy:

- `IPTV_PROXY_ALLOWED_HOSTS`: lista separada por vírgulas de nomes de host exatos autorizados, incluindo o host da playlist e os hosts/CDNs usados pelos streams e logos (por exemplo, `iptv.exemplo.com,cdn.exemplo.com`). Não use `*`.
- `IPTV_PROXY_SECRET`: segredo aleatório de 32 bytes em hexadecimal. Gere um com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` e guarde-o apenas nas variáveis de ambiente da Vercel.

O proxy só permite hosts explicitamente autorizados, resolve-os para IPv4 público, valida também os redirecionamentos e cifra os endereços de mídia nos links do navegador. Os recursos usam a rota fixa `/api/proxy?token=...`, compatível com o roteamento de funções da Vercel. O proxy não acessa redes privadas. Para listar de uma vez os domínios da playlist, clique em **Ver domínios necessários** no formulário e copie a lista exibida para `IPTV_PROXY_ALLOWED_HOSTS`; o diagnóstico mostra apenas hostnames, nunca credenciais ou caminhos. Inclua também domínios diferentes usados em redirecionamentos. Quando um host não estiver autorizado, a mensagem de erro informa apenas o hostname (sem credenciais ou caminho) para facilitar a configuração. Proteja a API com limites de uso/firewall do projeto Vercel e monitore o tráfego: mesmo limitada aos hosts configurados, uma API pública pode consumir a banda e as cotas do seu projeto. A reprodução web também está sujeita aos limites de tempo e tráfego do plano Vercel; streams longos podem não ser adequados a uma função serverless. Se o proxy retornar domínio não autorizado, adicione o hostname indicado no endereço fornecido pelo seu serviço às variáveis e faça novo deploy.

## Categorias e reprodução

As categorias e grupos são identificados pelas informações da playlist (`group-title`), exibidos em uma coluna lateral para separar provedores como Netflix e HBO Max e grupos de canais como Globo e Record. Episódios com nomes como `S01E01`, `1x02` ou temporada/episódio são agrupados por série, com filtros por temporada. Os nomes, grupos e legendas preservam caracteres portugueses como `ç`, `ã`, `õ` e letras acentuadas. A playlist é decodificada pelo charset declarado pelo servidor, incluindo UTF-8 e Windows-1252/ISO-8859-1. A reprodução identifica HLS/M3U8 e MPEG-TS/TS tanto pela extensão quanto pelos parâmetros comuns `type`, `format`, `output`, `extension` e `container` dos links IPTV. O buffer não tenta acelerar até o sinal atual para evitar saltos na reprodução. Tags HTML de formatação em legendas são removidas para que não apareçam como texto. Codecs e acesso ainda dependem do servidor de origem e dos recursos do navegador.

Use somente playlists e serviços aos quais você tem direito de acesso.

## Desenvolver e gerar o instalador do Windows

Com Node.js instalado, execute `npm install` e `npm start` para abrir o aplicativo. Para gerar ou substituir o instalador para Windows x64 na raiz do projeto, feche o player e execute `npm run build:exe`. O arquivo `Player M3U.exe` abre o assistente de instalação, usa o ícone Streambox e cria atalhos no menu Iniciar e na área de trabalho. Para reinstalar, execute o mesmo instalador; o atalho da área de trabalho é recriado. A instalação desktop não altera os arquivos do PWA, que continua sendo hospedado separadamente em HTTPS. Os testes podem ser executados com `npm test`.
