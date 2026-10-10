const crypto = require("node:crypto");
const net = require("node:net");
const { Transform } = require("node:stream");
const { StringDecoder } = require("node:string_decoder");

const TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;

function parseAllowedHosts(value) {
  return new Set(
    String(value || "")
      .split(/[,\r\n]/)
      .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
      .filter(Boolean)
  );
}

function isPublicIPv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function validateTarget(value, allowedHosts) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error("O endereço da origem é inválido.");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("O proxy aceita somente origens HTTP ou HTTPS.");
  }

  const hostname = target.hostname.toLowerCase().replace(/\.$/, "");
  if (!allowedHosts.has(hostname)) {
    throw new Error(`O domínio ${hostname} não está autorizado no proxy da Vercel.`);
  }
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
  ) {
    throw new Error("O proxy não pode acessar endereços locais.");
  }
  if (net.isIP(hostname) === 4 && !isPublicIPv4(hostname)) {
    throw new Error("O proxy não pode acessar endereços de rede privada.");
  }
  if (net.isIP(hostname) === 6) {
    throw new Error("O proxy aceita apenas origens com endereço IPv4 público.");
  }
  return target;
}

function getEncryptionKey(value) {
  if (!/^[\da-f]{64}$/i.test(String(value || ""))) {
    throw new Error("Configure IPTV_PROXY_SECRET na Vercel com uma chave hexadecimal de 64 caracteres.");
  }
  return Buffer.from(value, "hex");
}

function encodeTarget(target, secret) {
  const key = getEncryptionKey(secret);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(target.href, "utf8"), cipher.final()]);
  const issuedAt = Buffer.alloc(4);
  issuedAt.writeUInt32BE(Math.floor(Date.now() / 1000));
  const tag = cipher.getAuthTag();
  return Buffer.concat([issuedAt, nonce, tag, ciphertext]).toString("base64url");
}

function decodeTarget(token, secret) {
  const payload = Buffer.from(token, "base64url");
  if (payload.length < 33 || payload.toString("base64url") !== token) {
    throw new Error("O endereço de mídia do proxy é inválido.");
  }
  const issuedAt = payload.readUInt32BE(0);
  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now + 60 || now - issuedAt > TOKEN_LIFETIME_SECONDS) {
    throw new Error("O endereço de mídia expirou. Recarregue a playlist.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(secret), payload.subarray(4, 16));
  decipher.setAuthTag(payload.subarray(16, 32));
  const target = Buffer.concat([decipher.update(payload.subarray(32)), decipher.final()]).toString("utf8");
  return new URL(target);
}

function proxiedTarget(reference, baseUrl, secret, proxyPath = "/api/proxy") {
  let target;
  try {
    target = new URL(reference, baseUrl);
  } catch {
    return reference;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return reference;
  const pathExtension = target.pathname.match(/\.[a-z\d]{1,8}$/i)?.[0];
  const formatHint = ["type", "format", "output", "extension", "container"]
    .map((name) => (target.searchParams.get(name) || "").toLowerCase().replace(/[^a-z\d]/g, ""))
    .find((value) => /^(?:m3u8?|hls|ts|mpegts)$/.test(value));
  const pathIsGenericEndpoint = /^\.(?:php|asp|aspx|cgi|do)$/i.test(pathExtension || "");
  const effectiveExtension = formatHint && (!pathExtension || pathIsGenericEndpoint)
    ? `.${formatHint}`
    : pathExtension || "";
  const query = new URLSearchParams({ token: encodeTarget(target, secret) });
  if (effectiveExtension) query.set("ext", effectiveExtension);
  return `${proxyPath.replace(/\/+$/, "")}?${query}`;
}

function rewritePlaylistLine(line, baseUrl, secret, proxyPath) {
  if (!line || line.trimStart().startsWith("#")) {
    return line.replace(/(\b(?:URI|tvg-logo)\s*=\s*)(["'])(.*?)\2/gi, (match, prefix, quote, uri) => {
      const proxied = proxiedTarget(uri, baseUrl, secret, proxyPath);
      return `${prefix}${quote}${proxied}${quote}`;
    });
  }
  return proxiedTarget(line.trim(), baseUrl, secret, proxyPath);
}

function rewritePlaylist(content, baseUrl, secret, proxyPath, addStableIds = true) {
  return rewritePlaylistLines(String(content).split(/\r?\n/), baseUrl, secret, proxyPath, addStableIds).join("\n");
}

function addStableItemId(lines, baseUrl, secret) {
  const header = lines[0];
  if (!/^#EXTINF:/i.test(header) || /\btvg-id\s*=\s*["'][^"']+["']/i.test(header)) return;
  const comma = header.indexOf(",");
  const name = comma < 0 ? header : header.slice(comma + 1).trim();
  const sourceUrl = lines.find((line) => line.trim() && !line.trimStart().startsWith("#"));
  if (!sourceUrl) return;

  let absoluteUrl = sourceUrl.trim();
  try {
    absoluteUrl = new URL(absoluteUrl, baseUrl).href;
  } catch {
    return;
  }
  const id = crypto.createHmac("sha256", getEncryptionKey(secret)).update(`${name}\0${absoluteUrl}`).digest("hex").slice(0, 32);
  lines[0] = comma < 0
    ? `${header} tvg-id="proxy-${id}"`
    : `${header.slice(0, comma)} tvg-id="proxy-${id}"${header.slice(comma)}`;
}

function rewritePlaylistLines(lines, baseUrl, secret, proxyPath, addStableIds) {
  const output = [];
  let pendingEntry = [];

  const flushEntry = (isComplete) => {
    if (isComplete && addStableIds) addStableItemId(pendingEntry, baseUrl, secret);
    output.push(...pendingEntry.map((line) => rewritePlaylistLine(line, baseUrl, secret, proxyPath)));
    pendingEntry = [];
  };

  for (const line of lines) {
    if (/^#EXTINF:/i.test(line)) {
      if (pendingEntry.length) flushEntry(false);
      pendingEntry.push(line);
    } else if (pendingEntry.length) {
      pendingEntry.push(line);
      if (line.trim() && !line.trimStart().startsWith("#")) flushEntry(true);
      else if (pendingEntry.length > 128) flushEntry(false);
    } else {
      output.push(rewritePlaylistLine(line, baseUrl, secret, proxyPath));
    }
  }
  if (pendingEntry.length) flushEntry(false);
  return output;
}

function createPlaylistRewriteStream(baseUrl, secret, proxyPath, addStableIds = false) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let pendingEntry = [];
  const processLine = (line, stream) => {
    if (/^#EXTINF:/i.test(line)) {
      if (pendingEntry.length) {
        for (const entryLine of pendingEntry) stream.push(`${rewritePlaylistLine(entryLine, baseUrl, secret, proxyPath)}\n`);
      }
      pendingEntry = [line];
      return;
    }
    if (pendingEntry.length) {
      pendingEntry.push(line);
      if (line.trim() && !line.trimStart().startsWith("#")) {
        if (addStableIds) addStableItemId(pendingEntry, baseUrl, secret);
        for (const entryLine of pendingEntry) stream.push(`${rewritePlaylistLine(entryLine, baseUrl, secret, proxyPath)}\n`);
        pendingEntry = [];
      } else if (pendingEntry.length > 128) {
        for (const entryLine of pendingEntry) stream.push(`${rewritePlaylistLine(entryLine, baseUrl, secret, proxyPath)}\n`);
        pendingEntry = [];
      }
      return;
    }
    stream.push(`${rewritePlaylistLine(line, baseUrl, secret, proxyPath)}\n`);
  };
  return new Transform({
    transform(chunk, _encoding, callback) {
      pending += decoder.write(chunk);
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) processLine(line.replace(/\r$/, ""), this);
      if (pending.length > 1024 * 1024) {
        callback(new Error("A playlist contém uma linha maior que o limite do proxy."));
        return;
      }
      callback();
    },
    flush(callback) {
      pending += decoder.end();
      if (pending) processLine(pending.replace(/\r$/, ""), this);
      if (pendingEntry.length) {
        for (const line of pendingEntry) this.push(rewritePlaylistLine(line, baseUrl, secret, proxyPath));
      }
      callback();
    }
  });
}

module.exports = {
  createPlaylistRewriteStream,
  decodeTarget,
  encodeTarget,
  isPublicIPv4,
  parseAllowedHosts,
  proxiedTarget,
  rewritePlaylist,
  rewritePlaylistLines,
  validateTarget
};
