export const meta = {
  purpose: "Which checks and scripts this project defines and how each is run: its tests, typecheck, lint, build and format commands, found in package.json scripts, Cargo.toml, go.mod, pyproject.toml, a Makefile or a justfile, each with the command it runs and whether it is run as a check (scripts that never end or that change things are not). For a package.json project also the package manager (from the lockfile and the packageManager field, with a note when they disagree) and the Node version the package expects against the one running. Runs nothing.",
  params: { dir: "another folder to look in (a package of a monorepo), optional" },
  returns: "{root, package?:{name, manager, lockfile, packageManagerField, managerNotes?, node:{expected:[{from, version}], running}, installed, typescript}, checks:[{name, kind, command, from, runnable, why?, script?}], note?}",
  example: 'await scripts.run("commands")',
};

export default async function ({ checks }, { dir } = {}) {
  const c = dir ? checks.at(dir) : checks;
  const list = c.commands();
  const pkg = c.package();
  return {
    root: c.project().root,
    ...(pkg ? { package: pkg } : {}),
    checks: list.map(({ cmd, ...r }) => ({ ...r, command: cmd.join(" ") })),
    ...(list.length ? {} : { note: "no package.json scripts, Cargo.toml, go.mod, pyproject.toml, Makefile or justfile check found here; name the folder with `dir`" }),
  };
}
