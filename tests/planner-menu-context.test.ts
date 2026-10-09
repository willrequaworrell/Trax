import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("planner menu items stay inside their matching menu content and root", () => {
  const source = ts.createSourceFile(
    "planner-client.tsx",
    readFileSync(new URL("../src/features/planner/components/planner-client.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const violations: string[] = [];

  function visit(node: ts.Node, ancestors: string[]) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText(source);
      for (const family of ["DropdownMenu", "ContextMenu"]) {
        if (tag === `${family}Item`) {
          if (!ancestors.includes(`${family}Root`) || !ancestors.includes(`${family}Content`)) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            violations.push(`${tag} at line ${line + 1} is outside ${family}Root/Content`);
          }
        }
      }
      ts.forEachChild(node, (child) => visit(child, [...ancestors, tag]));
      return;
    }
    ts.forEachChild(node, (child) => visit(child, ancestors));
  }

  visit(source, []);
  assert.deepEqual(violations, [], "Menu primitives require their matching React context");
});
