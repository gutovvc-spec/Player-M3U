const { app, BrowserWindow, ipcMain, net, session } = require("electron");
const path = require("node:path");
const Playlist = require("./playlist");

function configurePlaylistLoading() {
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ["http://*/*", "https://*/*"] },
    (details, callback) => {
      const headers = details.responseHeaders || {};
      if (details.resourceType !== "xhr" || !details.initiator?.startsWith("file://")) {
        callback({ responseHeaders: headers });
        return;
      }

      const filteredHeaders = Object.fromEntries(
        Object.entries(headers).filter(([name]) => !name.toLowerCase().startsWith("access-control-"))
      );
      callback({
        responseHeaders: {
          ...filteredHeaders,
          "Access-Control-Allow-Origin": ["*"],
          "Access-Control-Allow-Methods": ["GET, HEAD, OPTIONS"],
          "Access-Control-Allow-Headers": ["accept, content-type, range"],
          "Access-Control-Expose-Headers": ["accept-ranges, content-length, content-range"]
        }
      });
    }
  );

  ipcMain.handle("playlist:load", async (_event, value) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Informe um link de playlist válido.");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("O link da playlist precisa começar com http://");
    }

    let response;
    try {
      response = await net.fetch(url.href, {
        signal: AbortSignal.timeout(120_000),
        headers: {
          Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, audio/mpegurl, */*"
        }
      });
    } catch (error) {
      const networkCode = error.cause?.code || error.code || error.message.match(/ERR_[A-Z0-9_]+/)?.[0];
      console.error(`Falha de rede ao carregar playlist do host ${url.hostname}.`, error);

      if (!net.isOnline()) {
        throw new Error("O computador está sem conexão com a internet.");
      }
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        throw new Error("O servidor demorou demais para responder. Tente novamente.");
      }
      if (networkCode === "ERR_NAME_NOT_RESOLVED") {
        throw new Error("Não foi possível localizar o servidor. Confira o endereço e o domínio do link.");
      }
      if (networkCode === "ERR_CONNECTION_REFUSED" || networkCode === "ERR_CONNECTION_TIMED_OUT") {
        throw new Error("O servidor recusou a conexão ou está indisponível. Confira o serviço e a porta do link.");
      }
      if (networkCode === "ERR_CERT_AUTHORITY_INVALID" || networkCode === "ERR_CERT_COMMON_NAME_INVALID") {
        throw new Error("O certificado de segurança do servidor é inválido. Confirme se o endereço HTTPS está correto com seu provedor.");
      }
      throw new Error("Não foi possível conectar ao servidor. Confira o link, sua conexão e se o serviço está disponível.");
    }

    if (!response.ok) throw new Error(`O servidor retornou o erro HTTP ${response.status}. Confira o link e o acesso à playlist.`);

    return Playlist.decodeText(await response.arrayBuffer(), response.headers.get("content-type") || "");
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    fullscreen: true,
    backgroundColor: "#090b10",
    icon: path.join(__dirname, "icon.png"),
    title: "Player M3U",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    } else if (input.key === "Escape" && window.isFullScreen()) {
      window.setFullScreen(false);
    }
  });

  window.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  configurePlaylistLoading();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
