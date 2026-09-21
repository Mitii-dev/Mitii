import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import lua from 'highlight.js/lib/languages/lua';
import markdown from 'highlight.js/lib/languages/markdown';
import objectivec from 'highlight.js/lib/languages/objectivec';
import perl from 'highlight.js/lib/languages/perl';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scala from 'highlight.js/lib/languages/scala';
import scss from 'highlight.js/lib/languages/scss';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

let registered = false;

function ensureLanguages(): void {
  if (registered) return;
  registered = true;
  const langs: Array<[string, typeof javascript]> = [
    ['bash', bash],
    ['c', c],
    ['cpp', cpp],
    ['csharp', csharp],
    ['css', css],
    ['diff', diff],
    ['dockerfile', dockerfile],
    ['go', go],
    ['graphql', graphql],
    ['ini', ini],
    ['java', java],
    ['javascript', javascript],
    ['json', json],
    ['kotlin', kotlin],
    ['less', less],
    ['lua', lua],
    ['markdown', markdown],
    ['objectivec', objectivec],
    ['perl', perl],
    ['php', php],
    ['plaintext', plaintext],
    ['python', python],
    ['r', r],
    ['ruby', ruby],
    ['rust', rust],
    ['scala', scala],
    ['scss', scss],
    ['shell', shell],
    ['sql', sql],
    ['swift', swift],
    ['typescript', typescript],
    ['xml', xml],
    ['yaml', yaml],
  ];
  for (const [name, def] of langs) {
    hljs.registerLanguage(name, def);
  }
  // Common aliases used by highlight.js auto / VS Code-ish paths
  hljs.registerAliases(['js', 'jsx', 'mjs', 'cjs'], { languageName: 'javascript' });
  hljs.registerAliases(['ts', 'tsx', 'mts', 'cts'], { languageName: 'typescript' });
  hljs.registerAliases(['htm', 'html', 'xhtml', 'svg', 'vue', 'svelte'], {
    languageName: 'xml',
  });
  hljs.registerAliases(['yml'], { languageName: 'yaml' });
  hljs.registerAliases(['md', 'mdx'], { languageName: 'markdown' });
  hljs.registerAliases(['py'], { languageName: 'python' });
  hljs.registerAliases(['rs'], { languageName: 'rust' });
  hljs.registerAliases(['sh', 'zsh', 'fish'], { languageName: 'bash' });
  hljs.registerAliases(['dockerfile'], { languageName: 'dockerfile' });
  hljs.registerAliases(['toml', 'cfg', 'conf', 'env'], { languageName: 'ini' });
  hljs.registerAliases(['cs'], { languageName: 'csharp' });
  hljs.registerAliases(['kt'], { languageName: 'kotlin' });
  hljs.registerAliases(['rb'], { languageName: 'ruby' });
  hljs.registerAliases(['pl'], { languageName: 'perl' });
  hljs.registerAliases(['cc', 'cxx', 'h', 'hpp', 'hh'], { languageName: 'cpp' });
  hljs.registerAliases(['m', 'mm'], { languageName: 'objectivec' });
}

const EXT_LANG: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  htm: 'xml',
  xhtml: 'xml',
  svg: 'xml',
  vue: 'xml',
  svelte: 'xml',
  xml: 'xml',
  md: 'markdown',
  mdx: 'markdown',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  cs: 'csharp',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  m: 'objectivec',
  mm: 'objectivec',
  swift: 'swift',
  php: 'php',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  env: 'ini',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  lua: 'lua',
  r: 'r',
  scala: 'scala',
  pl: 'perl',
  diff: 'diff',
  patch: 'diff',
};

const NAME_LANG: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'bash',
  gemfile: 'ruby',
  rakefile: 'ruby',
  brewfile: 'ruby',
  'cmakelists.txt': 'plaintext',
  '.gitignore': 'ini',
  '.dockerignore': 'ini',
  '.env': 'ini',
  '.env.local': 'ini',
  '.env.example': 'ini',
  'package.json': 'json',
  'tsconfig.json': 'json',
  'cargo.toml': 'ini',
  'pyproject.toml': 'ini',
};

export function languageFromPath(path: string): string {
  ensureLanguages();
  const base = path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  if (NAME_LANG[base]) return NAME_LANG[base];
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return 'plaintext';
  const ext = base.slice(dot + 1);
  return EXT_LANG[ext] ?? 'plaintext';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Highlight source for overlay editor. Always returns safe HTML. */
export function highlightCode(source: string, path: string): string {
  ensureLanguages();
  const lang = languageFromPath(path);
  // Cap work for huge buffers — still escape so overlay stays aligned.
  if (source.length > 400_000) {
    return escapeHtml(source);
  }
  try {
    if (lang === 'plaintext' || !hljs.getLanguage(lang)) {
      return escapeHtml(source);
    }
    return hljs.highlight(source, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(source);
  }
}
