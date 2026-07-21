{
  bun,
  pkgs,
  treefmtWrapper,
}:
pkgs.mkShell {
  packages = [
    bun
    treefmtWrapper
  ]
  ++ (with pkgs; [
    actionlint
    git
    glab
    nodejs_24
    oxfmt
    oxlint
    typescript
  ]);

  shellHook = ''
    export PATH="$PWD/node_modules/.bin:$PATH"
    echo "github-work-items dev shell"
    echo "  bun:  $(bun --version)"
    echo "  glab: $(glab --version | head -n 1)"
  '';
}
