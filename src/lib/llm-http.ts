/**
 * Minimal HTTP/JSON client pinned to a specific IP family (IPv4 by default).
 *
 * Node's global fetch (undici) is NOT used for LLM traffic: its connect path
 * (family 0 + happy-eyeballs) has been observed to hang with ETIMEDOUT on
 * hosts that publish AAAA records when the machine has no working IPv6 route,
 * even though a plain TCP/TLS connection to the IPv4 address succeeds. This
 * client forces an explicit family and a hard overall timeout so gateway
 * errors are fast and deterministic.
 */
import * as http from "http";
import * as https from "https";

export interface HttpJsonResult {
  status: number;
  text: string;
}

export function httpJsonRequest(opts: {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  family?: 4 | 6;
}): Promise<HttpJsonResult> {
  const { timeoutMs = 30_000, family = 4 } = opts;
  const parsed = new URL(opts.url);
  const lib = parsed.protocol === "https:" ? https : http;
  const options: https.RequestOptions = {
    hostname: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80,
    path: `${parsed.pathname}${parsed.search}`,
    method: opts.method ?? "GET",
    headers: opts.headers,
    family,
    servername: parsed.protocol === "https:" ? parsed.hostname : undefined,
  };
  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") })
      );
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timed out after ${timeoutMs / 1000}s`));
    });
    req.on("error", (err) => reject(err));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
