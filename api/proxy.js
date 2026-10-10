const dns = require("node:dns").promises;
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const zlib = require("node:zlib");
const {
  createPlaylistRewriteStream,
  decodeTarget,
  encodeTarget,
  isPublicIPv4,
  parseAllowedHosts,
  validateTarget
} = require("./proxy-utils");

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_REDIRECTS = 5;

function sendError(response, status, message) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(message);
}

function sameOriginRequest(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  const protocol = String(request.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  return Boolean(origin && host && origin === `${protocol}://${host}`);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error("A solicitação excede o limite permitido."));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("O corpo da solicitação não contém JSON válido."));
      }
    });
    request.on("error", reject);
  });
}

async function resolvePublicIPv4(hostname) {
  if (net.isIP(hostname) === 4) {
    if (!isPublicIPv4(hostname)) throw new Error("O proxy não pode acessar endereços de rede privada.");
    return [{ address: hostname, family: 4 }];
  }
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  const publicAddresses = addresses.filter((entry) => entry.family === 4 && isPublicIPv4(entry.address));
  if (publicAddresses.length === 0) throw new Error("O domínio não aponta para um endereço IPv4 público autorizado.");
  return publicAddresses;
}

function getRequestHeaders(request, target) {
  const headers = {
    "User-Agent": request.headers["user-agent"] || "Mozilla/5.0 PlayerM3U/1.0",
    Accept: request.headers.accept || "*/*",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: `${target.origin}/`
  };
  for (const name of ["range", "if-range"]) {
    if (request.headers[name]) headers[name] = request.headers[name];
  }
  if (target.username || target.password) {
    const credentials = `${decodeURIComponent(target.username)}:${decodeURIComponent(target.password)}`;
    headers.Authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;
  }
  return headers;
}

async function requestUpstream(target, incomingRequest, allowedHosts, redirectCount = 0) {
  const safeTarget = validateTarget(target.href, allowedHosts);
  const addresses = await resolvePublicIPv4(safeTarget.hostname);
  const transport = safeTarget.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const upstreamRequest = transport.request(safeTarget, {
      method: incomingRequest.method === "HEAD" ? "HEAD" : "GET",
      headers: getRequestHeaders(incomingRequest, safeTarget),
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, 4);
      }
    }, (upstreamResponse) => {
      const status = upstreamResponse.statusCode || 502;
      const location = upstreamResponse.headers.location;
      if (location && [301, 302, 303, 307, 308].includes(status)) {
        upstreamResponse.resume();
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error("O servidor da playlist redirecionou vezes demais."));
          return;
        }
        requestUpstream(new URL(location, safeTarget), incomingRequest, allowedHosts, redirectCount + 1)
          .then(resolve, reject);
        return;
      }
      resolve({ response: upstreamResponse, target: safeTarget });
    });
    upstreamRequest.on("error", reject);
    upstreamRequest.end();
  });
}

function copyResponseHeaders(upstreamResponse) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };
  for (const name of ["content-range", "accept-ranges", "etag", "last-modified", "expires"]) {
    if (upstreamResponse.headers[name]) headers[name] = upstreamResponse.headers[name];
  }
  if (upstreamResponse.headers["content-type"]) headers["Content-Type"] = upstreamResponse.headers["content-type"];
  if (upstreamResponse.headers["content-length"]) headers["Content-Length"] = upstreamResponse.headers["content-length"];
  if (upstreamResponse.headers["content-encoding"]) headers["Content-Encoding"] = upstreamResponse.headers["content-encoding"];
  if (upstreamResponse.statusCode === 206) headers["Content-Range"] = upstreamResponse.headers["content-range"];
  return headers;
}

function isPlaylistResponse(target, contentType) {
  return /\.m3u8?(?:$|[?#])/i.test(target.href) || /mpegurl/i.test(contentType || "");
}

function decodePlaylistStream(source, contentEncoding) {
  const encodings = String(contentEncoding || "")
    .split(",")
    .map((encoding) => encoding.trim().toLowerCase())
    .filter((encoding) => encoding && encoding !== "identity")
    .reverse();

  let stream = source;
  for (const encoding of encodings) {
    if (encoding === "gzip" || encoding === "x-gzip") stream = stream.pipe(zlib.createGunzip());
    else if (encoding === "deflate") stream = stream.pipe(zlib.createInflate());
    else if (encoding === "br") stream = stream.pipe(zlib.createBrotliDecompress());
    else throw new Error(`O proxy não consegue descompactar a playlist (${encoding}).`);
  }
  return stream;
}

function handleUpstreamResponse(response, upstream, request, secret, expectPlaylist = false, allowedHosts = new Set()) {
  const source = upstream.response;
  const target = upstream.target;
  if (request.method === "HEAD") {
    response.writeHead(source.statusCode || 502, copyResponseHeaders(source, target, secret));
    response.end();
    source.resume();
    return;
  }

  const contentType = source.headers["content-type"] || "";
  const rewriteExpected = expectPlaylist || isPlaylistResponse(target, contentType);
  let body;
  try {
    body = rewriteExpected
      ? decodePlaylistStream(source, source.headers["content-encoding"])
      : source;
  } catch (error) {
    console.error("Não foi possível descompactar a playlist IPTV.", error);
    source.destroy();
    sendError(response, 502, error.message);
    return;
  }

  body.once("data", (firstChunk) => {
    body.pause();
    const hasPlaylistHeader = /^\uFEFF?\s*#EXTM3U\b/i.test(firstChunk.toString("utf8").slice(0, 512));
    const rewrite = rewriteExpected || hasPlaylistHeader;
    if (expectPlaylist && !rewrite) {
      source.destroy();
      sendError(response, 415, "O endereço informado não retornou uma playlist M3U.");
      return;
    }
    const headers = copyResponseHeaders(source);

    if (rewrite) {
      delete headers["Content-Length"];
      delete headers["Content-Encoding"];
      delete headers["Content-Range"];
      delete headers["content-range"];
      delete headers["accept-ranges"];
      headers["Content-Type"] = "application/vnd.apple.mpegurl; charset=utf-8";
      response.writeHead(source.statusCode || 200, headers);
      const transformer = createPlaylistRewriteStream(
        target,
        secret,
        "/api/proxy",
        expectPlaylist,
        expectPlaylist ? { allowedHosts } : null
      );
      transformer.on("error", (error) => {
        console.error("Falha ao reescrever uma playlist IPTV.", error);
        response.destroy();
      });
      transformer.write(firstChunk);
      body.pipe(transformer).pipe(response);
      return;
    }

    response.writeHead(source.statusCode || 502, headers);
    response.write(firstChunk);
    body.pipe(response);
  });
  body.on("end", () => {
    if (!response.headersSent) {
      if (expectPlaylist) {
        sendError(response, 415, "O endereço informado não retornou uma playlist M3U.");
      } else {
        response.writeHead(source.statusCode || 502, copyResponseHeaders(source));
        response.end();
      }
    }
  });
  body.on("error", (error) => {
    console.error("Falha ao ler a playlist IPTV descompactada.", error);
    response.destroy();
  });
  source.on("error", (error) => {
    console.error("Falha ao receber dados do servidor IPTV.", error);
    response.destroy();
  });
  response.on("close", () => {
    if (!response.writableEnded) source.destroy();
  });
}

async function handler(request, response) {
  try {
    if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "POST") {
      response.setHeader("Allow", "GET, HEAD, POST");
      sendError(response, 405, "Método não permitido.");
      return;
    }

    const allowedHosts = parseAllowedHosts(process.env.IPTV_PROXY_ALLOWED_HOSTS);
    if (allowedHosts.size === 0) {
      sendError(response, 503, "O proxy ainda não foi configurado. Defina IPTV_PROXY_ALLOWED_HOSTS na Vercel.");
      return;
    }
    const secret = process.env.IPTV_PROXY_SECRET;
    if (!/^[\da-f]{64}$/i.test(String(secret || ""))) {
      sendError(response, 503, "O proxy ainda não foi configurado. Defina IPTV_PROXY_SECRET na Vercel.");
      return;
    }

    let target;
    if (request.method === "POST") {
      if (!sameOriginRequest(request)) {
        sendError(response, 403, "Apenas solicitações do mesmo site podem iniciar um proxy de playlist.");
        return;
      }
      const body = await readJsonBody(request);
      target = validateTarget(body.url, allowedHosts);
    } else {
      const requestUrl = new URL(request.url, "https://player.invalid");
      const pathToken = requestUrl.pathname.split("/").filter(Boolean).pop();
      const tokenWithExtension = requestUrl.searchParams.get("token") || (pathToken === "proxy" ? "" : pathToken);
      if (!tokenWithExtension || tokenWithExtension === "proxy") {
        sendError(response, 400, "Informe a playlist pelo formulário do aplicativo.");
        return;
      }
      const token = tokenWithExtension.replace(/\.[a-z\d]{1,8}$/i, "");
      target = validateTarget(decodeTarget(token, secret).href, allowedHosts);
    }

    const upstream = await requestUpstream(target, request, allowedHosts);
    handleUpstreamResponse(response, upstream, request, secret, request.method === "POST", allowedHosts);
  } catch (error) {
    console.error("Não foi possível encaminhar a solicitação IPTV.", error);
    const message = error.message || "Falha no proxy IPTV.";
    const status = /não está autorizado|endereços locais|rede privada|IPv4 público|somente origens/i.test(message) ? 403
      : /inválido|expirou|redirect|linha maior/i.test(message) ? 400
        : /ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|certificate|TLS/i.test(message) ? 502
          : 500;
    sendError(response, status, message);
  }
}

module.exports = handler;
module.exports.decodePlaylistStream = decodePlaylistStream;
module.exports.getRequestHeaders = getRequestHeaders;
