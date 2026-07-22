{
  bun,
  nodeModules,
  package,
  pkgs,
  source,
  treefmtCheck,
}:
let
  workspaceCheck =
    name: command:
    pkgs.stdenvNoCC.mkDerivation {
      pname = "gitlab-work-items-${name}";
      inherit (package) version;
      src = source;
      nativeBuildInputs = [
        bun
        pkgs.nodejs_24
      ];
      dontConfigure = true;
      buildPhase = ''
        cp -R ${nodeModules}/node_modules .
        cp -R ${nodeModules}/apps/. apps/
        cp -R ${nodeModules}/packages/. packages/
        for executable in node_modules/.bin/*; do
          target="$(readlink -f "$executable")"
          if [ -f "$target" ]; then
            patchShebangs "$target"
          fi
        done
        ${command}
      '';
      installPhase = ''
        touch "$out"
      '';
    };
in
{
  inherit package;
  actions =
    pkgs.runCommand "gitlab-work-items-actions" { nativeBuildInputs = [ pkgs.actionlint ]; }
      ''
        actionlint ${source}/.github/workflows/*.yml
        touch "$out"
      '';
  formatting = treefmtCheck;
  lint = workspaceCheck "lint" "bun run lint";
  test = workspaceCheck "test" "bun run test";
  typecheck = workspaceCheck "typecheck" "bun run typecheck";
}
