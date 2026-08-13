/**
 * マップの共有。設計 §10「圧縮埋め込みの実装」。
 *
 * サーバーが無いので、マップそのものをURLに埋める。
 * `CompressionStream` がブラウザ標準で使えるため外部ライブラリは要らない。
 *
 * パスではなくハッシュに置くのは、GitHub Pages がパスのフォールバックを
 * 設定できず、`/play?m=...` のような形で直接開かれると 404 になるため。
 */

import { parseMapDef } from '../core/index.ts';
import type { MapDef } from '../core/index.ts';

/**
 * URLに載せる上限。実用上 8KB を超えると通らない経路が出てくる。
 * 超えたものは共有せず、ファイルとして書き出す側へ回す。
 */
export const MAX_SHARE_LENGTH = 8_000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const source = new Blob([bytes as BlobPart]).stream();
  // 圧縮ストリームの型は BufferSource を受ける形で宣言されており、
  // Uint8Array の流れとは直接つながらない。実際の受け渡しは問題ないので橋渡しする。
  const piped = source.pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

/** マップをURLに載せられる文字列にする。 */
export async function encodeMap(def: MapDef): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(def));
  const compressed = await pipe(json, new CompressionStream('deflate-raw'));
  return toBase64Url(compressed);
}

/** 共有文字列からマップを復元する。壊れていれば例外を投げる。 */
export async function decodeMap(text: string): Promise<MapDef> {
  const compressed = fromBase64Url(text);
  const json = await pipe(compressed, new DecompressionStream('deflate-raw'));
  // 他人が作った文字列を読むので、必ず検証を通す。
  return parseMapDef(JSON.parse(new TextDecoder().decode(json)));
}

export interface Route {
  /** '#/play' や '#/edit'。 */
  readonly path: string;
  readonly params: URLSearchParams;
}

export function parseRoute(hash: string): Route {
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const separator = withoutHash.indexOf('?');

  return separator < 0
    ? { path: withoutHash, params: new URLSearchParams() }
    : {
        path: withoutHash.slice(0, separator),
        params: new URLSearchParams(withoutHash.slice(separator + 1)),
      };
}

/** 共有用のURLを組み立てる。長すぎる場合は `null`。 */
export async function shareUrl(def: MapDef, base = window.location.href): Promise<string | null> {
  const encoded = await encodeMap(def);
  const url = new URL(base);
  url.hash = `/play?m=${encoded}`;

  return url.toString().length > MAX_SHARE_LENGTH ? null : url.toString();
}
