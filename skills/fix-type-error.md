Fix a TypeScript type error without hiding it

1. `const r = await scripts.run("run", { check: "typecheck" })`. `r.byFile` counts the errors per
   file, most first. Start with the file with the most: one wrong type often causes the rest.
2. Read the first error's whole `message`: its indented lines ("Types of parameters 'a' and 'a' are
   incompatible.") name the part that disagrees. Read its `file:line` with
   `repo.read(file, { from: line - 10, to: line + 10 })`.
3. "Type X is not assignable to type Y" names two types. Find where each comes from
   (`repo.rg("interface Y|type Y")`) and fix the one that is wrong.
4. The usual causes, in order: a value that can be `undefined` and is not checked (narrow it); a
   function whose return type was widened; a dependency that changed its types (`ask.kit("deps",
   "which version of <name> is installed, and what does <symbol> return there?")`); a missing
   `@types/` package; a tsconfig `strict` or `moduleResolution` setting (`repo.read("tsconfig.json")`).
   `TS2307 Cannot find module` is a wrong import path or a package that is not installed.
5. Only when the caller asked for a fix: fix the cause with `repo.edit`. Do not add `any`,
   `as unknown as X`, `// @ts-ignore` or `// @ts-expect-error`, and do not loosen tsconfig, unless
   the request says to. If a cast is the honest fix (a value from `JSON.parse`), say why.
6. Run the typecheck again and report `failed` before and after. An error that moved to another
   file is the same error: follow it.
7. Run the tests once at the end (`scripts.run("run", { check: "test" })`): a type fix that changes
   a signature can break callers the tests cover.
