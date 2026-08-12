import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 設計 §6 の「`core/` は他のどのモジュールにも依存しない」と、
 * §3.2 の「決定的（乱数なし）」を機械的に固定する。
 *
 * この2つが崩れると、ソルバー・自動生成・ゲーム本体の間で挙動が食い違い、
 * 「ソルバーは解けると言ったのに実機で解けない」という最も痛い種類のバグになる。
 * 発生してから気づくのは難しいので、最初から入口を塞いでおく。
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const coreDir = join(repoRoot, 'src', 'core');

/** `core/` からの import が許される外部モジュール。原則として空に保つ。 */
const ALLOWED_BARE_IMPORTS: readonly string[] = [];

/**
 * `core/` に現れてはいけない識別子。
 * 実行環境への依存（DOM・ストレージ・通信）と、非決定性の原因になるもの。
 */
const FORBIDDEN_IN_CORE: readonly RegExp[] = [
  /\bdocument\b/,
  /\bwindow\b/,
  /\bnavigator\b/,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bindexedDB\b/,
  /\bfetch\s*\(/,
  /\bMath\s*\.\s*random\b/,
  /\bDate\s*\.\s*now\b/,
  /\bperformance\s*\.\s*now\b/,
];

async function collectTsFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // core/ がまだ無い段階では何も検査しない
  }

  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(full)));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

/** import 文とダイナミック import から、指定子だけを取り出す。 */
function importSpecifiers(source: string): string[] {
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g, // import x from 'y' / export * from 'y'
    /\bimport\s*['"]([^'"]+)['"]/g, // import 'y'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // import('y')
  ];

  const found: string[] = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) found.push(specifier);
    }
  }
  return found;
}

/** 行コメントとブロックコメントを落とす。禁止識別子の検査で説明文に反応しないように。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('モジュール境界', () => {
  it('core/ は core/ の外を import しない', async () => {
    const files = await collectTsFiles(coreDir);

    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        const isRelative = specifier.startsWith('.');
        const escapesCore = isRelative && specifier.startsWith('..');
        const isDisallowedBare = !isRelative && !ALLOWED_BARE_IMPORTS.includes(specifier);

        if (escapesCore || isDisallowedBare) {
          violations.push(`${relative(repoRoot, file)} → ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('core/ は実行環境と非決定性に依存しない', async () => {
    const files = await collectTsFiles(coreDir);

    const violations: string[] = [];
    for (const file of files) {
      const source = stripComments(await readFile(file, 'utf8'));
      for (const pattern of FORBIDDEN_IN_CORE) {
        if (pattern.test(source)) {
          violations.push(`${relative(repoRoot, file)} → ${pattern.source}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
