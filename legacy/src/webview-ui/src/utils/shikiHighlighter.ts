import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import githubDark from 'shiki/themes/github-dark-default.mjs';
import bash from 'shiki/langs/bash.mjs';
import css from 'shiki/langs/css.mjs';
import go from 'shiki/langs/go.mjs';
import html from 'shiki/langs/html.mjs';
import java from 'shiki/langs/java.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import json from 'shiki/langs/json.mjs';
import jsx from 'shiki/langs/jsx.mjs';
import markdown from 'shiki/langs/markdown.mjs';
import python from 'shiki/langs/python.mjs';
import rust from 'shiki/langs/rust.mjs';
import sql from 'shiki/langs/sql.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import typescript from 'shiki/langs/typescript.mjs';
import yaml from 'shiki/langs/yaml.mjs';

const SUPPORTED_LANGS = new Set([
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'python',
  'bash',
  'json',
  'markdown',
  'yaml',
  'html',
  'css',
  'sql',
  'go',
  'rust',
  'java',
]);

let highlighterPromise: Promise<HighlighterCore> | undefined;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubDark],
      langs: [
        typescript,
        tsx,
        javascript,
        jsx,
        python,
        bash,
        json,
        markdown,
        yaml,
        html,
        css,
        sql,
        go,
        rust,
        java,
      ],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    });
  }
  return highlighterPromise;
}

export async function highlightCode(code: string, language: string): Promise<string> {
  const highlighter = await getHighlighter();
  const lang = SUPPORTED_LANGS.has(language) ? language : 'markdown';
  return highlighter.codeToHtml(code, {
    lang,
    theme: 'github-dark-default',
    defaultColor: false,
  });
}
