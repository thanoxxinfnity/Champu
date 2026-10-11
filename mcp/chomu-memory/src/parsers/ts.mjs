// TypeScript / JavaScript through the real compiler's syntax tree (the `typescript` package, looked up in the project and then beside this server).
// If it cannot be found the generic parser is used instead, so the server still works.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseGeneric } from './generic.mjs';

let TS;
export function loadTypeScript(root) {
  if (TS !== undefined) return TS;
  for (const base of [join(root, 'package.json'), import.meta.url]) {
    try { TS = createRequire(base)('typescript'); return TS; } catch { /* try the next place */ }
  }
  TS = null;
  return TS;
}

const kindOfScript = (file) => (file.endsWith('x') ? 'tsx' : 'ts');

export function parseTs(text, file, root) {
  const ts = loadTypeScript(root);
  if (!ts) return parseGeneric(text, 'java');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.(jsx|tsx)$/.test(file) ? ts.ScriptKind.TSX : /\.(js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const symbols = [];
  const edges = [];
  const imports = [];
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const stack = []; // enclosing symbols (qname)
  const hasExport = (n) => !!(n.modifiers && n.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword));
  const docOf = (n) => {
    const ranges = ts.getLeadingCommentRanges(text, n.getFullStart()) ?? [];
    if (!ranges.length) return '';
    return text.slice(ranges[ranges.length - 1].pos, ranges[ranges.length - 1].end).replace(/^\/\*+|\*+\/$/g, '').replace(/^\s*\*\s?/gm, '').replace(/^\/\/\s?/gm, '').replace(/\s+/g, ' ').trim().slice(0, 300);
  };
  const nameOf = (n) => (n.name ? (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) || ts.isPrivateIdentifier(n.name) ? n.name.text : n.name.getText(sf)) : null);
  const paramNames = (n) => (n.parameters ?? []).map((p) => p.name.getText(sf).replace(/[{}\s]/g, '').slice(0, 30));
  const sig = (n) => {
    const start = n.getStart(sf);
    const body = n.body ?? (n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) ? n.initializer.body : null);
    const end = body ? body.getStart(sf) : n.getEnd();
    return text.slice(start, Math.min(end, start + 240)).replace(/\s+/g, ' ').trim();
  };
  const add = (n, name, kind, extra = {}) => {
    const parent = stack[stack.length - 1];
    const qname = parent && (kind === 'method' || kind === 'property') ? `${parent}.${name}` : name;
    symbols.push({
      name, qname, kind, line: lineOf(n.getStart(sf)), endLine: lineOf(n.getEnd()), signature: sig(n), params: paramNames(extra.fn ?? n),
      doc: docOf(n), exported: extra.exported ?? hasExport(n),
    });
    return qname;
  };
  const callName = (expr) => {
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
    if (ts.isElementAccessExpression(expr) && ts.isStringLiteral(expr.argumentExpression)) return expr.argumentExpression.text;
    return null;
  };
  // how a call is written decides how it may be matched: f() is a plain call, this.f() is the same class, a.b.f() is a member of something unknown
  const recvOf = (expr) => {
    if (ts.isPropertyAccessExpression(expr)) {
      const r = expr.expression;
      return r.kind === ts.SyntaxKind.ThisKeyword || r.kind === ts.SyntaxKind.SuperKeyword ? 'self' : 'member';
    }
    return ts.isElementAccessExpression(expr) ? 'member' : 'plain';
  };
  const argText = (n) => (n.arguments ?? []).map((a) => a.getText(sf).slice(0, 40)).join(', ').slice(0, 160);

  function visit(n) {
    let pushed = false;
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const names = [];
      if (c?.name) names.push(c.name.text);
      if (c?.namedBindings) {
        if (ts.isNamedImports(c.namedBindings)) c.namedBindings.elements.forEach((e) => names.push((e.propertyName ?? e.name).text));
        else names.push('*');
      }
      imports.push({ spec: n.moduleSpecifier.text, names: names.join(',') });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      imports.push({ spec: n.moduleSpecifier.text, names: '*' });
    } else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require' && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      imports.push({ spec: n.arguments[0].text, names: '' });
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      imports.push({ spec: n.arguments[0].text, names: '' });
    }

    if (ts.isFunctionDeclaration(n) && n.name) { stack.push(add(n, n.name.text, 'function')); pushed = true; }
    else if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) {
      if (n.name) {
        stack.push(add(n, n.name.text, 'class')); pushed = true;
        for (const h of n.heritageClauses ?? []) for (const t of h.types) {
          const nm = callName(t.expression);
          if (nm) edges.push({ from: n.name.text, to: nm, kind: h.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements', line: lineOf(t.getStart(sf)), args: '' });
        }
      }
    } else if (ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n)) {
      const nm = nameOf(n);
      if (nm) { stack.push(add(n, nm, 'method')); pushed = true; }
    } else if (ts.isConstructorDeclaration(n)) { stack.push(add(n, 'constructor', 'method')); pushed = true; }
    else if (ts.isInterfaceDeclaration(n)) { stack.push(add(n, n.name.text, 'interface')); pushed = true; }
    else if (ts.isTypeAliasDeclaration(n)) { add(n, n.name.text, 'type'); }
    else if (ts.isEnumDeclaration(n)) { add(n, n.name.text, 'enum'); }
    else if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const init = d.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          stack.push(add(d, d.name.text, 'function', { fn: init, exported: hasExport(n) })); pushed = true;
          visit(init.body);
          stack.pop(); pushed = false;
        } else if (hasExport(n) || /^[A-Z][A-Z0-9_]+$/.test(d.name.text)) {
          add(d, d.name.text, 'const', { exported: hasExport(n) });
        }
      }
      if (!pushed) { ts.forEachChild(n, (c) => { if (!(ts.isVariableDeclarationList(c))) visit(c); else c.declarations.forEach((d) => d.initializer && !(ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) && visit(d.initializer)); }); }
      return;
    } else if (ts.isPropertyDeclaration(n) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) && n.name) {
      const nm = nameOf(n);
      if (nm) { stack.push(add(n, nm, 'method', { fn: n.initializer })); pushed = true; visit(n.initializer.body); stack.pop(); return; }
    } else if (ts.isExportAssignment(n) && ts.isIdentifier(n.expression)) {
      edges.push({ from: null, to: n.expression.text, kind: 'ref', line: lineOf(n.getStart(sf)), args: '' });
    }

    const owner = stack[stack.length - 1] ?? null;
    if (ts.isCallExpression(n)) {
      const nm = callName(n.expression);
      if (nm && nm !== 'require') edges.push({ from: owner, to: nm, kind: 'call', line: lineOf(n.getStart(sf)), args: argText(n), recv: recvOf(n.expression) });
    } else if (ts.isNewExpression(n)) {
      const nm = callName(n.expression);
      if (nm) edges.push({ from: owner, to: nm, kind: 'call', line: lineOf(n.getStart(sf)), args: argText(n) });
    } else if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && ts.isIdentifier(n.tagName) && /^[A-Z]/.test(n.tagName.text)) {
      edges.push({ from: owner, to: n.tagName.text, kind: 'call', line: lineOf(n.getStart(sf)), args: '' });
    } else if (ts.isIdentifier(n) && owner && n.parent && !ts.isCallExpression(n.parent) && !ts.isPropertyAccessExpression(n.parent)) {
      // a function passed by name (callbacks, handlers, array.map(fn)): a reference, so it does not look unused
      if (n.parent && (ts.isCallExpression(n.parent.parent ?? n.parent) || ts.isArrayLiteralExpression(n.parent) || ts.isPropertyAssignment(n.parent) || ts.isShorthandPropertyAssignment(n.parent) || ts.isJsxExpression(n.parent) || ts.isReturnStatement(n.parent) || ts.isBinaryExpression(n.parent)))
        edges.push({ from: owner, to: n.text, kind: 'ref', line: lineOf(n.getStart(sf)), args: '' });
    }
    ts.forEachChild(n, visit);
    if (pushed) stack.pop();
  }
  visit(sf);
  return { symbols, edges, imports };
}
